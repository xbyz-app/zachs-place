# Guest Arrival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a friend flies into ATL, send a pre-arrival email and, at landing, a text plus an email with exact directions from their concourse. A private arrival page carries the same directions, and Zach gets ntfy alerts.

**Architecture:**
- Everything lives in `zachs-place` (static Astro + Netlify Functions v2).
- The routing rules are one pure function (`buildRoute`). Copy is templates with placeholders; real private values come from env and are filled only on the server.
- Guest records live in Netlify Blobs (strong consistency).
- A scheduled function (`guest-tick`, every 5 min) polls AeroDataBox and sends through Resend, Twilio (behind a flag), and ntfy.
- Muse and Claude Code create guests through a bearer-key JSON API.

**Tech Stack:** Astro 4 (static), Netlify Functions v2 (`export default` + `export const config`), `@netlify/blobs`, TypeScript, Vitest, Node 22. There's no Twilio or Resend SDK; both are called with `fetch`.

**Spec:** `docs/superpowers/specs/2026-09-12-guest-arrival-design.md`

## Global Constraints

- **The repo `xbyz-app/zachs-place` is PUBLIC.** Never commit, hardcode, or bundle: the home street address, coordinates, unit, floor, cross street, Zach's phone, or any guest's name, email, phone, or flight. Tests use the fake values in `tests/helpers/env.ts`. Copy templates use `{address}` `{street}` `{crossStreet}` `{unit}` `{unitLetter}` `{floor}`.
- **Placeholders are filled only on the server** (`src/server/**`, `netlify/functions/**`). Nothing under `src/lib/arrival/` or `src/scripts/` may read `process.env`.
- **Unknown is never a value.** `checkedBag: null` is not `false`. `concourse: null` and `airline: null` get their own branches. `international: null` routes as domestic, and the landed ntfy says it couldn't tell.
- **Nothing is sent to a guest based on a guess.** Flight errors, cancellations, diversions, missing data, and a landing older than 6h all mean no guest send, and an ntfy to Zach instead.
- **Senders never throw.** `sendEmail`, `sendSms`, and `sendNtfy` return a result object. Never wrap them in try/catch expecting it to fire.
- **ntfy `Title` and `Click` are ASCII only** (a non-Latin1 header makes `fetch` throw before sending). Human text goes in the body.
- **Time zone is `America/New_York` for every schedule rule.**
- **Copy voice:** the Shiner text, lowercase and casual, first person from Zach. American spelling.
- **SMS text is printable ASCII only** (GSM-safe): no emoji, no curly quotes, no em dashes.
- **Cost gate:** before any live AeroDataBox, Resend, or Twilio call during development, tell Zach how many calls it will make. Unit tests stub `fetch` and make zero live calls.
- **Branch:** `feat/guest-arrival` in `~/zachs-place`. Don't push or open a PR until Task 10, and don't merge without Zach's go-ahead.
- **Tests:** `npm test` (vitest, `tests/**`). Test files import code by relative path, following `tests/functions/light.test.ts`.

## File map

| File | Responsibility | Task |
|---|---|---|
| `src/lib/arrival/types.ts` | Shared types (Guest, Tracking, RouteInput, PageModel, HomeVars) | 1 |
| `src/lib/arrival/time.ts` | ET wall-clock helpers | 1 |
| `src/server/guests/store.ts` | Blobs + in-memory stores for guests and counters | 1 |
| `tests/helpers/guest.ts`, `tests/helpers/env.ts` | Fixture builder, fake env | 1 |
| `src/lib/arrival/route.ts` | `buildRoute`: the routing rules | 2 |
| `src/lib/arrival/copy.ts` | Step copy + SMS copy templates, `fillTemplate` | 3 |
| `src/lib/arrival/deeplinks.ts` | Lyft/Uber/Apple Maps URLs from HomeVars | 3 |
| `src/lib/arrival/render.ts` | `groupSteps`, `renderSms`, `renderLandedEmail`, `renderPreArrivalEmail` | 3 |
| `src/server/guests/flight.ts` | AeroDataBox fetch + normalize → `FlightSnapshot` | 4 |
| `src/server/guests/home.ts` | `homeFromEnv()` | 5 |
| `src/server/guests/{email,sms,ntfy}.ts` | Senders | 5 |
| `src/server/guests/validate.ts` | Intake validation, `newGuest`, `applyPatch` | 6 |
| `src/server/guests/view.ts` | `siteUrl`, `pageUrl`, `routeInputFor`, `isExpired`, `pageModel` | 6, 7, 8 |
| `netlify/functions/guests.ts` | `/api/guests` intake API | 6 |
| `src/server/guests/tick.ts` | Timeline engine (`shouldPoll`, `applySnapshot`, `dueSends`, `timelineAlerts`, `runTick`) | 7 |
| `netlify/functions/guest-tick.ts` | Scheduled wrapper | 7 |
| `netlify/functions/arrive.ts` | `/api/arrive?token=` | 8 |
| `src/pages/arrive/index.astro`, `src/scripts/arrive.ts` | Arrival page | 8 |
| `netlify.toml`, `public/sw.js`, `src/layouts/BaseLayout.astro` | Routing, SW bypass, noindex | 8 |
| `tools/archive-guests.mjs`, `README.md` | Archive + ops docs | 9 |

---

### Task 1: Foundations (types, ET time, stores, test helpers)

**Files:**
- Modify: `package.json` (add `@netlify/blobs`)
- Create: `src/lib/arrival/types.ts`, `src/lib/arrival/time.ts`, `src/server/guests/store.ts`
- Create: `tests/helpers/guest.ts`, `tests/helpers/env.ts`
- Test: `tests/lib/arrival/time.test.ts`, `tests/server/store.test.ts`

**Interfaces:**
- Produces: every type in `types.ts`; `etParts`, `etDateTime`, `addDays`, `etHour`, `etClock` from `time.ts`; `GuestStore`, `CounterStore`, `blobGuestStore`, `blobCounterStore`, `memoryGuestStore`, `memoryCounterStore`, `findByToken` from `store.ts`; `makeGuest(overrides)` and `FAKE_ENV`/`applyFakeEnv()` test helpers.

- [ ] **Step 1: Record the baseline and install the dependency**

Run: `cd ~/zachs-place && git status -sb && npm test 2>&1 | tail -5`
Expected: on `feat/guest-arrival`, all existing tests pass. Note the count.

Run: `npm install @netlify/blobs@^11`
Expected: `package.json` dependencies now include `"@netlify/blobs"`.

- [ ] **Step 2: Write `src/lib/arrival/types.ts`**

```ts
// Shared by server and browser. Must never read process.env (public repo; see plan constraints).

export type Concourse = "T" | "A" | "B" | "C" | "D" | "E" | "F";
export const CONCOURSES: readonly Concourse[] = ["T", "A", "B", "C", "D", "E", "F"];

export type Pickup = "rideshare" | "zach";

export type TrackingState =
  | "idle"       // never checked
  | "scheduled"
  | "departed"   // includes en route / approaching
  | "landed"
  | "cancelled"
  | "diverted"
  | "unknown";   // AeroDataBox answered but status is Unknown

export type SendKind = "preArrival" | "landedSms" | "landedEmail";
export const SEND_KINDS: readonly SendKind[] = ["preArrival", "landedEmail", "landedSms"];

export interface SendRecord {
  status: "sending" | "sent" | "failed" | "skipped";
  at: string;        // ISO
  attempts: number;
  detail?: string;   // provider id, error, or skip reason
}

export interface Tracking {
  state: TrackingState;
  airline: string | null;          // IATA
  international: boolean | null;
  concourse: Concourse | null;
  gate: string | null;
  scheduledDeparture: string | null; // ISO UTC
  scheduledArrival: string | null;
  estimatedArrival: string | null;
  landedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  consecutiveErrors: number;
}

export interface Guest {
  id: string;
  token: string;                  // page URL secret
  name: string;
  firstName: string;              // what Zach calls them, e.g. "Shiner"
  email: string | null;
  phone: string | null;           // E.164
  arriveDate: string;             // YYYY-MM-DD (ET)
  departDate: string;
  flight: { number: string; date: string } | null; // "DL1234", departure date on the ticket
  checkedBag: boolean | null;     // null = unknown, never false
  pickup: Pickup;
  doorInvited: boolean;
  buildingRegistered: boolean;
  tracking: Tracking;
  sends: Partial<Record<SendKind, SendRecord>>;
  alertsSent: string[];
  createdAt: string;
}

export interface RouteInput {
  airline: string | null;
  checkedBag: boolean | null;
  concourse: Concourse | null;
  international: boolean | null;
  pickup: Pickup;
  arrivalHourET: number | null;   // 0-23
}

/** Private values. Server-only; comes from env. */
export interface HomeVars {
  address: string;
  lat: number;
  lng: number;
  street: string;
  crossStreet: string;
  unit: string;
  unitLetter: string;
  floor: string;
}

export interface RideLinks { lyft: string; uber: string; appleMaps: string }

/** What /api/arrive returns to a valid token holder. */
export interface PageModel {
  firstName: string;
  arriveDate: string;
  flight: null | {
    number: string;
    state: TrackingState;
    gate: string | null;
    scheduledArrival: string | null;
    estimatedArrival: string | null;
    landedAt: string | null;
  };
  route: RouteInput;
  copy: Record<string, string>;   // STEP_COPY with placeholders already filled
  links: RideLinks;
  address: string;
  zachPhone: string | null;
}

export function emptyTracking(): Tracking {
  return {
    state: "idle", airline: null, international: null, concourse: null, gate: null,
    scheduledDeparture: null, scheduledArrival: null, estimatedArrival: null, landedAt: null,
    lastCheckedAt: null, lastError: null, consecutiveErrors: 0,
  };
}
```

- [ ] **Step 3: Write the failing time tests**

`tests/lib/arrival/time.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { etParts, etDateTime, addDays, etHour, etClock } from "../../../src/lib/arrival/time";

describe("ET time helpers", () => {
  it("etDateTime converts ET wall time to the right UTC instant in EDT and EST", () => {
    expect(etDateTime("2026-09-20", 10).toISOString()).toBe("2026-09-20T14:00:00.000Z");
    expect(etDateTime("2026-12-20", 10).toISOString()).toBe("2026-12-20T15:00:00.000Z");
    expect(etDateTime("2026-09-20", 20, 30).toISOString()).toBe("2026-09-21T00:30:00.000Z");
  });
  it("etParts reads ET date/hour, including across UTC midnight", () => {
    expect(etParts(new Date("2026-09-21T02:15:00Z"))).toEqual({ date: "2026-09-20", hour: 22, minute: 15 });
    expect(etParts(new Date("2026-09-20T04:00:00Z")).hour).toBe(0); // h23, never 24
  });
  it("addDays handles month boundaries", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("etHour returns null for null or garbage", () => {
    expect(etHour(null)).toBeNull();
    expect(etHour("not a date")).toBeNull();
    expect(etHour("2026-09-20T10:25:00Z")).toBe(6);
  });
  it("etClock formats lowercase 12h", () => {
    expect(etClock("2026-09-20T12:25:00Z")).toBe("8:25am");
    expect(etClock("2026-09-20T22:05:00Z")).toBe("6:05pm");
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npx vitest run tests/lib/arrival/time.test.ts`
Expected: FAIL, cannot resolve `src/lib/arrival/time`.

- [ ] **Step 5: Write `src/lib/arrival/time.ts`**

```ts
const TZ = "America/New_York";

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function etParts(d: Date): { date: string; hour: number; minute: number } {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The UTC instant at which the ET wall clock reads `date hour:minute`. */
export function etDateTime(date: string, hour: number, minute = 0): Date {
  const [y, m, d] = date.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d, hour, minute);
  let t = target;
  for (let i = 0; i < 3; i++) {
    const p = etParts(new Date(t));
    const [py, pm, pd] = p.date.split("-").map(Number);
    const seen = Date.UTC(py, pm - 1, pd, p.hour, p.minute);
    if (seen === target) break;
    t += target - seen;
  }
  return new Date(t);
}

export function etHour(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : etParts(d).hour;
}

export function etClock(iso: string): string {
  const { hour, minute } = etParts(new Date(iso));
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")}${hour < 12 ? "am" : "pm"}`;
}
```

- [ ] **Step 6: Run the time tests and confirm they pass**

Run: `npx vitest run tests/lib/arrival/time.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Write the test helpers**

`tests/helpers/env.ts`:
```ts
// FAKE values only. This repo is public; real home details live in Netlify env.
export const FAKE_ENV: Record<string, string> = {
  HOME_ADDRESS: "100 Test Ave NW, Atlanta, GA 30300",
  HOME_LAT: "33.7000000",
  HOME_LNG: "-84.3000000",
  HOME_STREET: "test",
  HOME_CROSS_STREET: "99th",
  HOME_UNIT: "7Q",
  HOME_UNIT_LETTER: "Q",
  HOME_FLOOR: "7",
  ZACH_PHONE: "+15555550100",
  SITE_URL: "https://guest.example.test",
};
export function applyFakeEnv(): void { Object.assign(process.env, FAKE_ENV); }
```

`tests/helpers/guest.ts`:
```ts
import { emptyTracking, type Guest } from "../../src/lib/arrival/types";

export function makeGuest(overrides: Partial<Guest> = {}): Guest {
  return {
    id: "testy-abc123",
    token: "tok_" + "x".repeat(40),
    name: "Testy McTest",
    firstName: "Testy",
    email: "testy@example.test",
    phone: "+15555550111",
    arriveDate: "2026-09-20",
    departDate: "2026-09-23",
    flight: { number: "DL1234", date: "2026-09-20" },
    checkedBag: false,
    pickup: "rideshare",
    doorInvited: true,
    buildingRegistered: false,
    tracking: emptyTracking(),
    sends: {},
    alertsSent: [],
    createdAt: "2026-09-10T15:00:00.000Z",
    ...overrides,
  };
}
```

- [ ] **Step 8: Write the failing store tests**

`tests/server/store.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { memoryGuestStore, memoryCounterStore, findByToken } from "../../src/server/guests/store";
import { makeGuest } from "../helpers/guest";

describe("memoryGuestStore", () => {
  it("round-trips and lists guests", async () => {
    const s = memoryGuestStore();
    await s.put(makeGuest({ id: "a" }));
    await s.put(makeGuest({ id: "b" }));
    expect((await s.list()).map((g) => g.id).sort()).toEqual(["a", "b"]);
    expect((await s.get("a"))?.id).toBe("a");
    await s.remove("a");
    expect(await s.get("a")).toBeNull();
  });
  it("returns copies, so mutating a read does not change the store", async () => {
    const s = memoryGuestStore([makeGuest({ id: "a" })]);
    const g = await s.get("a");
    g!.alertsSent.push("mutated");
    expect((await s.get("a"))!.alertsSent).toEqual([]);
  });
});

describe("findByToken", () => {
  it("finds the exact token only", async () => {
    const s = memoryGuestStore([makeGuest({ id: "a", token: "A".repeat(43) }), makeGuest({ id: "b", token: "B".repeat(43) })]);
    expect((await findByToken(s, "B".repeat(43)))?.id).toBe("b");
    expect(await findByToken(s, "B".repeat(42))).toBeNull();
    expect(await findByToken(s, "")).toBeNull();
  });
});

describe("memoryCounterStore", () => {
  it("starts at 0 and increments", async () => {
    const c = memoryCounterStore();
    expect(await c.get("k")).toBe(0);
    expect(await c.increment("k")).toBe(1);
    expect(await c.increment("k")).toBe(2);
    expect(await c.get("k")).toBe(2);
  });
});
```

- [ ] **Step 9: Run them and confirm they fail**

Run: `npx vitest run tests/server/store.test.ts`
Expected: FAIL, cannot resolve `src/server/guests/store`.

- [ ] **Step 10: Write `src/server/guests/store.ts`**

```ts
import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import type { Guest } from "../../lib/arrival/types";

export interface GuestStore {
  get(id: string): Promise<Guest | null>;
  put(guest: Guest): Promise<void>;
  list(): Promise<Guest[]>;
  remove(id: string): Promise<void>;
}

export interface CounterStore {
  get(key: string): Promise<number>;
  increment(key: string): Promise<number>;
}

export function blobGuestStore(): GuestStore {
  const store = getStore({ name: "guests", consistency: "strong" });
  return {
    async get(id) { return ((await store.get(id, { type: "json" })) as Guest | null) ?? null; },
    async put(g) { await store.setJSON(g.id, g); },
    async list() {
      const { blobs } = await store.list();
      const out: Guest[] = [];
      for (const b of blobs) {
        const g = (await store.get(b.key, { type: "json" })) as Guest | null;
        if (g) out.push(g);
      }
      return out;
    },
    async remove(id) { await store.delete(id); },
  };
}

export function blobCounterStore(): CounterStore {
  const store = getStore({ name: "counters", consistency: "strong" });
  const get = async (key: string) => {
    const v = await store.get(key, { type: "json" });
    return typeof v === "number" ? v : 0;
  };
  return {
    get,
    async increment(key) { const n = (await get(key)) + 1; await store.setJSON(key, n); return n; },
  };
}

export function memoryGuestStore(seed: Guest[] = []): GuestStore {
  const m = new Map(seed.map((g) => [g.id, structuredClone(g)]));
  return {
    async get(id) { const g = m.get(id); return g ? structuredClone(g) : null; },
    async put(g) { m.set(g.id, structuredClone(g)); },
    async list() { return [...m.values()].map((g) => structuredClone(g)); },
    async remove(id) { m.delete(id); },
  };
}

export function memoryCounterStore(): CounterStore {
  const m = new Map<string, number>();
  return {
    async get(k) { return m.get(k) ?? 0; },
    async increment(k) { const n = (m.get(k) ?? 0) + 1; m.set(k, n); return n; },
  };
}

export async function findByToken(store: GuestStore, token: string): Promise<Guest | null> {
  if (!token || token.length < 20) return null;
  const want = Buffer.from(token);
  for (const g of await store.list()) {
    const have = Buffer.from(g.token);
    if (have.length === want.length && timingSafeEqual(have, want)) return g;
  }
  return null;
}
```

(The token lookup lists every guest. That's fine at a handful of guests a year.)

- [ ] **Step 11: Run the full suite**

Run: `npm test`
Expected: PASS, the baseline count plus 9 new tests.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json src/lib/arrival/types.ts src/lib/arrival/time.ts src/server/guests/store.ts tests/helpers tests/lib/arrival/time.test.ts tests/server/store.test.ts
git commit -m "feat(arrival): shared types, ET time helpers, guest store"
```

### Task 2: Routing rules (`buildRoute`)

**Files:**
- Create: `src/lib/arrival/route.ts`
- Test: `tests/lib/arrival/route.test.ts`

**Interfaces:**
- Consumes: `RouteInput`, `Concourse` from `types.ts`.
- Produces: `STEP_IDS` (const array), `type StepId`, `type Branch = "no-bag" | "bag"`, `interface Step { id: StepId; group: 1|2|3|4; branch?: Branch }`, `buildRoute(input: RouteInput): Step[]`, `DELTA = "DL"`, `NORTH_AIRLINES: ReadonlySet<string>`.

**Where the facts come from** (spec, "Sourced facts"):
- All domestic rideshare pickup is North.
- Delta is the only airline on the South side.
- Alaska, American, Frontier, JetBlue, Southwest, Spirit, and United are North.
- North is to the RIGHT at the top of the Plane Train escalators.
- T is walkable to baggage claim.
- E/F take the train like everyone else (no International Terminal shortcut).
- International arrivals clear customs in F and exit through the International Terminal.

- [ ] **Step 1: Write the failing tests**

`tests/lib/arrival/route.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildRoute, type Step } from "../../../src/lib/arrival/route";
import { CONCOURSES, type RouteInput, type Concourse } from "../../../src/lib/arrival/types";

const base: RouteInput = { airline: "DL", checkedBag: false, concourse: "T", international: false, pickup: "rideshare", arrivalHourET: 6 };
const ids = (s: Step[]) => s.map((x) => (x.branch ? `${x.id}#${x.branch}` : x.id));

describe("buildRoute: exact routes for canonical cases", () => {
  it("Shiner: Delta, no bag, T, 6am, rideshare", () => {
    expect(ids(buildRoute(base))).toEqual([
      "concourse.walk-t", "escalator.north",
      "ride.north-deck", "ride.call", "ride.time-quiet",
      "building.dropoff", "building.door", "building.elevator", "building.hall", "building.room", "close.asleep",
    ]);
  });
  it("Delta with a checked bag in B at 2pm: LEFT to south claim, then over to north", () => {
    expect(ids(buildRoute({ ...base, checkedBag: true, concourse: "B", arrivalHourET: 14 }))).toEqual([
      "concourse.train", "escalator.south-claim", "escalator.to-north",
      "ride.north-deck", "ride.call", "ride.time-normal",
      "building.dropoff", "building.door", "building.elevator", "building.hall", "building.room", "close.awake",
    ]);
  });
  it("Southwest with a bag: claim is already on the north side, no crossing step", () => {
    expect(ids(buildRoute({ ...base, airline: "WN", checkedBag: true, concourse: "C" })).slice(0, 3))
      .toEqual(["concourse.train", "escalator.north-claim", "ride.north-deck"]);
  });
  it("unknown bag: both branches, labeled, no-bag first", () => {
    expect(ids(buildRoute({ ...base, checkedBag: null, concourse: "A" })).slice(0, 4))
      .toEqual(["concourse.train", "escalator.north#no-bag", "escalator.south-claim#bag", "escalator.to-north#bag"]);
  });
  it("international: customs in F, no escalator group, international curb and call", () => {
    expect(ids(buildRoute({ ...base, international: true, concourse: "F", checkedBag: true })).slice(0, 4))
      .toEqual(["concourse.international", "ride.international-curb", "ride.call-international", "ride.time-quiet"]);
  });
  it("Zach picking up a Delta guest: south side, curb, no building steps", () => {
    expect(ids(buildRoute({ ...base, pickup: "zach", concourse: "D" })))
      .toEqual(["concourse.train", "escalator.south-side", "meet.curb", "close.see-you"]);
  });
});

describe("buildRoute: invariants over every combination", () => {
  const airlines = ["DL", "AA", "WN", "XP", null];
  const bags = [true, false, null];
  const concourses: (Concourse | null)[] = [...CONCOURSES, null];
  const intls = [true, false, null];
  const pickups = ["rideshare", "zach"] as const;
  const hours = [0, 6, 7, 14, 20, 23, null];
  const all: RouteInput[] = [];
  for (const airline of airlines) for (const checkedBag of bags) for (const concourse of concourses)
    for (const international of intls) for (const pickup of pickups) for (const arrivalHourET of hours)
      all.push({ airline, checkedBag, concourse, international, pickup, arrivalHourET });

  it("exactly one group-1 step, groups never go backwards, ends with a close step", () => {
    for (const input of all) {
      const r = buildRoute(input);
      expect(r.filter((s) => s.group === 1)).toHaveLength(1);
      for (let i = 1; i < r.length; i++) expect(r[i].group).toBeGreaterThanOrEqual(r[i - 1].group);
      expect(r[r.length - 1].id.startsWith("close.")).toBe(true);
    }
  });
  it("group 1 is decided by international, then concourse", () => {
    for (const input of all) {
      const first = buildRoute(input)[0].id;
      if (input.international === true) expect(first).toBe("concourse.international");
      else if (input.concourse === "T") expect(first).toBe("concourse.walk-t");
      else if (input.concourse === null) expect(first).toBe("concourse.unknown");
      else expect(first).toBe("concourse.train");
    }
  });
  it("international routes have no escalator steps; domestic routes always do", () => {
    for (const input of all) {
      const esc = buildRoute(input).filter((s) => s.id.startsWith("escalator."));
      if (input.international === true) expect(esc).toHaveLength(0);
      else expect(esc.length).toBeGreaterThan(0);
    }
  });
  it("a known bag answer never produces branches; unknown bag + rideshare + domestic always does", () => {
    for (const input of all) {
      const r = buildRoute(input);
      const branched = r.some((s) => s.branch);
      if (input.checkedBag !== null || input.pickup === "zach" || input.international === true) expect(branched).toBe(false);
      else {
        expect(r.some((s) => s.branch === "no-bag")).toBe(true);
        expect(r.some((s) => s.branch === "bag")).toBe(true);
      }
    }
  });
  it("rideshare with checkedBag === false never visits a claim; with true never uses the no-bag step", () => {
    for (const input of all) {
      if (input.pickup !== "rideshare" || input.international === true) continue;
      const r = ids(buildRoute(input));
      if (input.checkedBag === false) expect(r.filter((x) => x.includes("claim"))).toEqual([]);
      if (input.checkedBag === true) expect(r).not.toContain("escalator.north");
    }
  });
  it("Delta + bag (rideshare, domestic) always goes south then crosses north; nobody else goes south", () => {
    for (const input of all) {
      if (input.pickup !== "rideshare" || input.international === true) continue;
      const r = ids(buildRoute(input));
      const south = r.some((x) => x.startsWith("escalator.south"));
      const delta = input.airline === "DL";
      if (delta && input.checkedBag === true) {
        expect(r.indexOf("escalator.south-claim")).toBeLessThan(r.indexOf("escalator.to-north"));
      }
      if (!delta) expect(south).toBe(false);
    }
  });
  it("zach pickup never includes rideshare or building steps", () => {
    for (const input of all.filter((i) => i.pickup === "zach")) {
      const r = ids(buildRoute(input));
      expect(r.some((x) => x.startsWith("ride.") || x.startsWith("building."))).toBe(false);
      expect(r[r.length - 1]).toBe("close.see-you");
    }
  });
  it("quiet drive time is before 7am or from 8pm; unknown hour is normal; asleep is 11pm-8am; unknown hour is 'either'", () => {
    const at = (h: number | null) => ids(buildRoute({ ...base, arrivalHourET: h }));
    expect(at(6)).toContain("ride.time-quiet");
    expect(at(7)).toContain("ride.time-normal");
    expect(at(20)).toContain("ride.time-quiet");
    expect(at(null)).toContain("ride.time-normal");
    expect(at(23)).toContain("close.asleep");
    expect(at(7)).toContain("close.asleep");
    expect(at(8)).toContain("close.awake");
    expect(at(null)).toContain("close.either");
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run tests/lib/arrival/route.test.ts`
Expected: FAIL, cannot resolve `route`.

- [ ] **Step 3: Write `src/lib/arrival/route.ts`**

```ts
import type { RouteInput } from "./types";

export const STEP_IDS = [
  "concourse.international", "concourse.walk-t", "concourse.train", "concourse.unknown",
  // rideshare, domestic
  "escalator.north", "escalator.north-claim", "escalator.south-claim", "escalator.unlisted-claim", "escalator.to-north",
  // zach pickup, domestic: go to your airline's side
  "escalator.north-side", "escalator.south-side", "escalator.unlisted-side",
  "ride.north-deck", "ride.international-curb", "ride.call", "ride.call-international", "ride.time-quiet", "ride.time-normal",
  "meet.curb", "meet.international-curb",
  "building.dropoff", "building.door", "building.elevator", "building.hall", "building.room",
  "close.asleep", "close.awake", "close.either", "close.see-you",
] as const;
export type StepId = (typeof STEP_IDS)[number];
export type Branch = "no-bag" | "bag";
export interface Step { id: StepId; group: 1 | 2 | 3 | 4; branch?: Branch }

export const DELTA = "DL";
// Domestic Terminal North, official ATL terminal map (Jan 2022): Alaska, American, Frontier,
// JetBlue, Southwest, Spirit, United. Anything else (Avelo, Sun Country, unknown) gets
// "follow signs for your airline's baggage claim" rather than a guessed side.
export const NORTH_AIRLINES: ReadonlySet<string> = new Set(["AS", "AA", "F9", "B6", "WN", "NK", "UA"]);

type Side = "north" | "south" | "unlisted";
function sideOf(airline: string | null): Side {
  if (airline === DELTA) return "south";
  if (airline && NORTH_AIRLINES.has(airline)) return "north";
  return "unlisted";
}

function bagRideshareSteps(airline: string | null): StepId[] {
  const side = sideOf(airline);
  if (side === "north") return ["escalator.north-claim"];
  return [side === "south" ? "escalator.south-claim" : "escalator.unlisted-claim", "escalator.to-north"];
}

const quiet = (h: number | null) => h !== null && (h < 7 || h >= 20);

function closeFor(h: number | null): StepId {
  if (h === null) return "close.either";
  return h >= 23 || h < 8 ? "close.asleep" : "close.awake";
}

export function buildRoute(input: RouteInput): Step[] {
  const steps: Step[] = [];
  const add = (id: StepId, group: Step["group"], branch?: Branch) =>
    steps.push(branch ? { id, group, branch } : { id, group });
  const intl = input.international === true;

  // 1: off the concourse
  if (intl) add("concourse.international", 1);
  else if (input.concourse === "T") add("concourse.walk-t", 1);
  else if (input.concourse === null) add("concourse.unknown", 1);
  else add("concourse.train", 1);

  // 2: top of the escalators (domestic only)
  if (!intl) {
    if (input.pickup === "zach") {
      const side = sideOf(input.airline);
      add(side === "north" ? "escalator.north-side" : side === "south" ? "escalator.south-side" : "escalator.unlisted-side", 2);
    } else if (input.checkedBag === false) {
      add("escalator.north", 2);
    } else if (input.checkedBag === true) {
      for (const id of bagRideshareSteps(input.airline)) add(id, 2);
    } else {
      add("escalator.north", 2, "no-bag");
      for (const id of bagRideshareSteps(input.airline)) add(id, 2, "bag");
    }
  }

  // 3: the ride
  if (input.pickup === "zach") {
    add(intl ? "meet.international-curb" : "meet.curb", 3);
  } else {
    add(intl ? "ride.international-curb" : "ride.north-deck", 3);
    add(intl ? "ride.call-international" : "ride.call", 3);
    add(quiet(input.arrivalHourET) ? "ride.time-quiet" : "ride.time-normal", 3);
  }

  // 4: the building
  if (input.pickup === "zach") {
    add("close.see-you", 4);
  } else {
    for (const id of ["building.dropoff", "building.door", "building.elevator", "building.hall", "building.room"] as const) add(id, 4);
    add(closeFor(input.arrivalHourET), 4);
  }
  return steps;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/lib/arrival/route.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5: Mutation-check the two rules that matter most**

Each of these temporary edits must make at least one test FAIL. Run `npx vitest run tests/lib/arrival/route.test.ts` after each edit, then undo the edit by hand (the file isn't committed yet, so don't use `git checkout`):
1. Change `} else if (input.checkedBag === false) {` to `} else if (!input.checkedBag) {`. This treats unknown as no bag.
2. In `sideOf`, change `if (airline === DELTA) return "south";` to `if (airline === DELTA) return "north";`.

Expected: both edits produce failures. If either passes, add a test that catches it before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/arrival/route.ts tests/lib/arrival/route.test.ts
git commit -m "feat(arrival): buildRoute routing rules with exhaustive invariants"
```

### Task 3: Copy, deep links, and renderers

**Files:**
- Create: `src/lib/arrival/copy.ts`, `src/lib/arrival/deeplinks.ts`, `src/lib/arrival/render.ts`
- Modify: `tests/helpers/env.ts` (add `FAKE_HOME`)
- Test: `tests/lib/arrival/copy.test.ts`, `tests/lib/arrival/deeplinks.test.ts`, `tests/lib/arrival/render.test.ts`

**Interfaces:**
- Consumes: `Step`, `StepId`, `Branch`, `STEP_IDS`, `buildRoute` (Task 2); `HomeVars`, `RideLinks`, `RouteInput`, `Pickup`, `Concourse` (Task 1).
- Produces:
  - `STEP_COPY: Record<StepId, string>`, `SMS_COPY: Partial<Record<StepId, string>>`, `SMS_STEP_IDS: readonly StepId[]`
  - `GROUP_TITLES`, `BRANCH_LABEL`, `fillTemplate(text, vars)`, `filledCopy(home: HomeVars): Record<StepId, string>`
  - `lyftUrl(h)`, `uberUrl(h)`, `appleMapsUrl(h)`, `rideLinks(h): RideLinks`
  - `interface StepGroup`, `groupSteps(steps, pickup, concourse, copy)`, `renderSms(steps, pickup, concourse, pageUrl)`
  - `renderLandedEmail(args: LandedEmailArgs): EmailMessage`, `renderPreArrivalEmail(args: PreArrivalArgs): EmailMessage`, `interface EmailMessage { subject; html; text }`

**Voice:** copy comes from the Shiner text in the spec. Lowercase, casual, first person. Private values are placeholders only. `{concourse}` is filled at render time.

- [ ] **Step 1: Add `FAKE_HOME` to `tests/helpers/env.ts`**

Append:
```ts
import type { HomeVars } from "../../src/lib/arrival/types";
export const FAKE_HOME: HomeVars = {
  address: FAKE_ENV.HOME_ADDRESS, lat: 33.7, lng: -84.3,
  street: "test", crossStreet: "99th", unit: "7Q", unitLetter: "Q", floor: "7",
};
```
(Move the `import` to the top of the file.)

- [ ] **Step 2: Write the failing copy tests**

`tests/lib/arrival/copy.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { STEP_COPY, SMS_COPY, SMS_STEP_IDS, fillTemplate, filledCopy } from "../../../src/lib/arrival/copy";
import { STEP_IDS } from "../../../src/lib/arrival/route";
import { FAKE_HOME } from "../../helpers/env";

describe("copy", () => {
  it("every step id has non-empty page copy", () => {
    for (const id of STEP_IDS) expect(STEP_COPY[id]?.trim().length, id).toBeGreaterThan(20);
  });
  it("every group-1, group-2 and meet step has SMS copy, printable ASCII only", () => {
    for (const id of SMS_STEP_IDS) {
      expect(SMS_COPY[id], id).toBeTruthy();
      expect(SMS_COPY[id]!, id).toMatch(/^[\x20-\x7E]+$/);
    }
    expect(SMS_STEP_IDS).toEqual(STEP_IDS.filter((id) => /^(concourse|escalator|meet)\./.test(id)));
  });
  it("directions are true: north steps say RIGHT + NORTH, south steps say LEFT + SOUTH, unlisted name neither side", () => {
    for (const table of [STEP_COPY, SMS_COPY]) {
      for (const id of ["escalator.north", "escalator.north-claim", "escalator.north-side"] as const) {
        expect(table[id], id).toContain("RIGHT"); expect(table[id], id).toContain("NORTH"); expect(table[id], id).not.toContain("LEFT");
      }
      for (const id of ["escalator.south-claim", "escalator.south-side"] as const) {
        expect(table[id], id).toContain("LEFT"); expect(table[id], id).toContain("SOUTH"); expect(table[id], id).not.toContain("RIGHT");
      }
      for (const id of ["escalator.unlisted-claim", "escalator.unlisted-side"] as const) {
        expect(table[id], id).not.toMatch(/LEFT|RIGHT|NORTH|SOUTH/);
      }
      expect(table["escalator.to-north"]).toContain("NORTH");
    }
  });
  it("building copy is templated, never hardcoded", () => {
    const building = Object.entries(STEP_COPY).filter(([id]) => id.startsWith("building.")).map(([, t]) => t).join(" ");
    for (const ph of ["{street}", "{crossStreet}", "{unit}", "{unitLetter}", "{floor}"]) expect(building).toContain(ph);
    for (const t of Object.values(SMS_COPY)) expect(t).not.toMatch(/\{(street|crossStreet|unit|unitLetter|floor|address)\}/);
  });
  it("fillTemplate fills known vars and leaves unknown placeholders alone", () => {
    expect(fillTemplate("in {unit} on {concourse}", { unit: "7Q" })).toBe("in 7Q on {concourse}");
  });
  it("filledCopy substitutes every home placeholder", () => {
    const c = filledCopy(FAKE_HOME);
    const all = Object.values(c).join(" ");
    expect(all).not.toMatch(/\{(street|crossStreet|unit|unitLetter|floor|address)\}/);
    expect(c["building.door"]).toContain("7Q");
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run tests/lib/arrival/copy.test.ts`
Expected: FAIL, cannot resolve `copy`.

- [ ] **Step 4: Write `src/lib/arrival/copy.ts`**

```ts
import type { Branch, StepId } from "./route";
import type { HomeVars, Pickup } from "./types";

// Templates only. This file is public and ships in the page bundle. Private values are
// {placeholders} filled on the server from env (see plan Global Constraints).
export const STEP_COPY: Record<StepId, string> = {
  "concourse.international": "you're landing international, so you'll clear customs and grab your bags in concourse F, then walk out through the International Terminal. no plane train for you.",
  "concourse.walk-t": "your gate is in T, which is truly best case scenario!! you don't need the train at all, just follow the signs and walk straight to baggage claim.",
  "concourse.train": "you're in {concourse}. follow signs to the plane train and take it to the final stop (domestic baggage claim). don't hop off early, ride it all the way.",
  "concourse.unknown": "check the letter on your gate. if it starts with T, skip the train and walk straight to baggage claim. anything else, take the plane train to the final stop (domestic baggage claim).",

  "escalator.north": "at the top of the escalators turn RIGHT toward the NORTH side. uber/lyft pickup is on the north, and with no checked bag you don't need the other side at all.",
  "escalator.north-claim": "at the top of the escalators turn RIGHT toward the NORTH side and grab your bag at your airline's baggage claim. uber/lyft pickup is on the north too, so you're already on the right side.",
  "escalator.south-claim": "at the top of the escalators turn LEFT toward the SOUTH side, that's delta baggage claim. grab your bag there.",
  "escalator.unlisted-claim": "at the top of the escalators follow the signs for your airline's baggage claim and grab your bag.",
  "escalator.to-north": "bag in hand, follow the Rideshare signs over to the NORTH side. every uber/lyft picks up from there.",
  "escalator.north-side": "at the top of the escalators turn RIGHT toward the NORTH side, and grab your bag at baggage claim if you checked one.",
  "escalator.south-side": "at the top of the escalators turn LEFT toward the SOUTH side (delta), and grab your bag at baggage claim if you checked one.",
  "escalator.unlisted-side": "at the top of the escalators follow the signs for your airline's baggage claim, and grab your bag if you checked one.",

  "ride.north-deck": "go thru north baggage claim to the escalators between doors N2 and N3. go down, out door LN1, and across the street at the crosswalk to the parking deck. there will be orange signs for uber/lyft, follow them to the pickup zones.",
  "ride.international-curb": "once you're through customs, follow the Rideshare signs out the arrivals doors to the pickup curb.",
  "ride.call": "call your ride while you're going down the escalator, takes them like 3-4 min. i'd do lyft, it's usually way cheaper.",
  "ride.call-international": "call your ride as you head for the doors, takes them like 3-4 min. i'd do lyft, it's usually way cheaper.",
  "ride.time-quiet": "15-20 min to me, not much traffic at this hour.",
  "ride.time-normal": "20ish min to me, longer if you hit rush hour.",

  "meet.curb": "head out the doors to the arrivals curb right there and text me which door number you're at. i'll pull up.",
  "meet.international-curb": "once you're through customs, go out to the International Terminal arrivals curb and text me which door you're at. i'll pull up.",

  "building.dropoff": "for the drop off: i live on a one way street. GPS will have them loop around the block and pull into the little delivery garage on {street} (not the resident garage on {crossStreet}). way easier to get your bag out in there.",
  "building.door": "main door is on {street}. it'll be locked but there's a screen to buzz the concierge. buzz them, not me. tell them you're here for zach in {unit}, you're on the guest list!",
  "building.elevator": "they'll call the elevator and send you up to {floor}.",
  "building.hall": "off the elevator look for the double door opening, go through it, then follow the little {unitLetter} signs to the right. all the way down the hall, last door on the left.",
  "building.room": "the Door app unlocks it. bed's made, towels out.",

  "close.asleep": "i'll probably be asleep lol. wake me up or just crash, either is fine!!",
  "close.awake": "text me when you're downstairs!",
  "close.either": "text me when you're downstairs. if it's late and i don't answer, just crash!",
  "close.see-you": "see you at the curb!!",
};

export const SMS_STEP_IDS = [
  "concourse.international", "concourse.walk-t", "concourse.train", "concourse.unknown",
  "escalator.north", "escalator.north-claim", "escalator.south-claim", "escalator.unlisted-claim", "escalator.to-north",
  "escalator.north-side", "escalator.south-side", "escalator.unlisted-side",
  "meet.curb", "meet.international-curb",
] as const satisfies readonly StepId[];

export const SMS_COPY: Partial<Record<StepId, string>> = {
  "concourse.international": "customs + bags in F, then out the International Terminal.",
  "concourse.walk-t": "you're in T, no train, walk straight to baggage claim.",
  "concourse.train": "you're in {concourse}, plane train to the last stop (baggage claim).",
  "concourse.unknown": "gate starts with T? walk to bag claim. else train to the last stop.",
  "escalator.north": "top of escalators go RIGHT (NORTH) for uber/lyft.",
  "escalator.north-claim": "top of escalators go RIGHT (NORTH), bag claim + uber/lyft both there.",
  "escalator.south-claim": "top of escalators go LEFT (SOUTH) to delta bag claim,",
  "escalator.unlisted-claim": "follow signs to your airline's bag claim,",
  "escalator.to-north": "then Rideshare signs to the NORTH side.",
  "escalator.north-side": "top of escalators go RIGHT (NORTH), grab your bag if you checked one.",
  "escalator.south-side": "top of escalators go LEFT (SOUTH), grab your bag if you checked one.",
  "escalator.unlisted-side": "follow signs to your airline's bag claim.",
  "meet.curb": "then out to the arrivals curb, text me your door number.",
  "meet.international-curb": "then out to the International Terminal arrivals curb, text me your door number.",
};

export const GROUP_TITLES: Record<Pickup, Record<1 | 2 | 3 | 4, string>> = {
  rideshare: { 1: "off the plane", 2: "top of the escalators", 3: "your ride", 4: "getting in" },
  zach: { 1: "off the plane", 2: "top of the escalators", 3: "finding me", 4: "see you soon" },
};

export const BRANCH_LABEL: Record<Branch, string> = {
  "no-bag": "if you didn't check a bag",
  bag: "if you checked a bag",
};

export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? vars[k] : m));
}

export function filledCopy(home: HomeVars): Record<StepId, string> {
  const vars = {
    address: home.address, street: home.street, crossStreet: home.crossStreet,
    unit: home.unit, unitLetter: home.unitLetter, floor: home.floor,
  };
  return Object.fromEntries(Object.entries(STEP_COPY).map(([id, t]) => [id, fillTemplate(t, vars)])) as Record<StepId, string>;
}
```

- [ ] **Step 5: Run the copy tests and confirm they pass**

Run: `npx vitest run tests/lib/arrival/copy.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Write the failing deep-link tests**

`tests/lib/arrival/deeplinks.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { lyftUrl, uberUrl, appleMapsUrl } from "../../../src/lib/arrival/deeplinks";
import { FAKE_HOME } from "../../helpers/env";

describe("ride deep links", () => {
  it("lyft carries destination coordinates and address", () => {
    const u = new URL(lyftUrl(FAKE_HOME));
    expect(u.origin + u.pathname).toBe("https://lyft.com/ride");
    expect(u.searchParams.get("id")).toBe("lyft");
    expect(Number(u.searchParams.get("destination[latitude]"))).toBe(33.7);
    expect(Number(u.searchParams.get("destination[longitude]"))).toBe(-84.3);
    expect(u.searchParams.get("destination[address]")).toBe(FAKE_HOME.address);
  });
  it("uber uses the documented /looking?drop[0]=<json> format with coordinates", () => {
    const u = new URL(uberUrl(FAKE_HOME));
    expect(u.origin + u.pathname).toBe("https://m.uber.com/looking");
    const drop = JSON.parse(u.searchParams.get("drop[0]")!);
    expect(drop).toMatchObject({ latitude: 33.7, longitude: -84.3, addressLine2: FAKE_HOME.address });
  });
  it("apple maps gets the address as destination", () => {
    expect(new URL(appleMapsUrl(FAKE_HOME)).searchParams.get("daddr")).toBe(FAKE_HOME.address);
  });
});
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `npx vitest run tests/lib/arrival/deeplinks.test.ts`
Expected: FAIL, cannot resolve `deeplinks`.

- [ ] **Step 8: Write `src/lib/arrival/deeplinks.ts`**

```ts
import type { HomeVars, RideLinks } from "./types";

// Uber: developer.uber.com deep-links doc (checked 2026-09-12); coordinates win over the address label.
// Lyft: public docs are offline. Format taken from Lyft's SDKs; Task 10 verifies it on a real phone.
export function lyftUrl(h: HomeVars): string {
  const p = new URLSearchParams({
    id: "lyft",
    "destination[latitude]": String(h.lat),
    "destination[longitude]": String(h.lng),
    "destination[address]": h.address,
  });
  return `https://lyft.com/ride?${p.toString()}`;
}

export function uberUrl(h: HomeVars): string {
  const drop = JSON.stringify({ latitude: h.lat, longitude: h.lng, addressLine1: "Zach's place", addressLine2: h.address });
  return `https://m.uber.com/looking?drop[0]=${encodeURIComponent(drop)}`;
}

export function appleMapsUrl(h: HomeVars): string {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(h.address)}&dirflg=d`;
}

export function rideLinks(h: HomeVars): RideLinks {
  return { lyft: lyftUrl(h), uber: uberUrl(h), appleMaps: appleMapsUrl(h) };
}
```

- [ ] **Step 9: Run the deep-link tests and confirm they pass**

Run: `npx vitest run tests/lib/arrival/deeplinks.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 10: Write the failing render tests**

`tests/lib/arrival/render.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildRoute } from "../../../src/lib/arrival/route";
import { filledCopy } from "../../../src/lib/arrival/copy";
import { rideLinks } from "../../../src/lib/arrival/deeplinks";
import { groupSteps, renderSms, renderLandedEmail, renderPreArrivalEmail } from "../../../src/lib/arrival/render";
import { CONCOURSES, type RouteInput, type Concourse } from "../../../src/lib/arrival/types";
import { FAKE_HOME } from "../../helpers/env";

const copy = filledCopy(FAKE_HOME);
const links = rideLinks(FAKE_HOME);
const url = "https://guest.example.test/arrive/" + "x".repeat(43); // realistic length
const base: RouteInput = { airline: "DL", checkedBag: false, concourse: "B", international: false, pickup: "rideshare", arrivalHourET: 6 };

describe("groupSteps", () => {
  it("groups consecutive steps, fills {concourse}, keeps branch labels", () => {
    const input = { ...base, checkedBag: null };
    const g = groupSteps(buildRoute(input), input.pickup, input.concourse, copy);
    expect(g.map((x) => x.group)).toEqual([1, 2, 3, 4]);
    expect(g[0].items[0].text).toContain("you're in B");
    expect(g[1].items.map((i) => i.branch)).toEqual(["no-bag", "bag", "bag"]);
  });
  it("throws loudly if a step has no copy", () => {
    expect(() => groupSteps(buildRoute(base), "rideshare", "B", {})).toThrow(/no copy/);
  });
});

describe("renderSms", () => {
  it("stays short and ASCII for every combination", () => {
    for (const airline of ["DL", "WN", null]) for (const checkedBag of [true, false, null])
      for (const concourse of [...CONCOURSES, null] as (Concourse | null)[]) for (const international of [true, false])
        for (const pickup of ["rideshare", "zach"] as const) {
          const input: RouteInput = { airline, checkedBag, concourse, international, pickup, arrivalHourET: 6 };
          const s = renderSms(buildRoute(input), pickup, concourse, url);
          expect(s.length, s).toBeLessThanOrEqual(360);
          expect(s, s).toMatch(/^[\x20-\x7E]+$/);
          expect(s.endsWith(url)).toBe(true);
        }
  });
  it("Delta + bag: LEFT comes before the crossing to NORTH", () => {
    const s = renderSms(buildRoute({ ...base, checkedBag: true }), "rideshare", "B", url);
    expect(s.indexOf("LEFT")).toBeGreaterThan(-1);
    expect(s.indexOf("LEFT")).toBeLessThan(s.indexOf("NORTH side"));
  });
  it("unknown bag says both, never picks one", () => {
    const s = renderSms(buildRoute({ ...base, checkedBag: null }), "rideshare", "B", url);
    expect(s).toContain("no bag:");
    expect(s).toContain("checked bag:");
  });
  it("mentions the lyft button only for rideshare", () => {
    expect(renderSms(buildRoute(base), "rideshare", "B", url)).toContain("lyft button");
    expect(renderSms(buildRoute({ ...base, pickup: "zach" }), "zach", "B", url)).not.toContain("lyft");
  });
});

describe("renderLandedEmail", () => {
  const args = { firstName: "<b>Testy</b>", steps: buildRoute(base), input: base, copy, pageUrl: url, links, zachPhone: "+15555550100" };
  it("escapes the name and fills private values from copy", () => {
    const m = renderLandedEmail(args);
    expect(m.html).toContain("&lt;b&gt;Testy&lt;/b&gt;");
    expect(m.html).toContain("7Q");
    expect(m.html).not.toMatch(/\{(unit|street|floor|concourse)\}/);
    expect(m.text).toContain("7Q");
  });
  it("rideshare has lyft + uber buttons with escaped hrefs; zach pickup has none", () => {
    const m = renderLandedEmail(args);
    expect(m.html).toContain("open lyft");
    expect(m.html).toContain(links.lyft.replaceAll("&", "&amp;"));
    const input = { ...base, pickup: "zach" as const };
    const z = renderLandedEmail({ ...args, input, steps: buildRoute(input) });
    expect(z.html).not.toContain("open lyft");
  });
  it("text and html carry every step, in order", () => {
    const m = renderLandedEmail(args);
    const groups = groupSteps(args.steps, "rideshare", "B", copy);
    let last = -1;
    for (const item of groups.flatMap((g) => g.items)) {
      const i = m.text.indexOf(item.text);
      expect(i, item.text).toBeGreaterThan(last);
      last = i;
    }
  });
});

describe("renderPreArrivalEmail", () => {
  const args = { firstName: "Testy", arriveDate: "2026-09-20", flightNumber: "DL1234", checkedBag: false as boolean | null, pickup: "rideshare" as const, pageUrl: url, address: FAKE_HOME.address, zachPhone: "+15555550100" };
  it("rideshare: address, lyft, Door, page link, the date", () => {
    const m = renderPreArrivalEmail(args);
    for (const s of [FAKE_HOME.address, "lyft", "Door", url, "sep 20", "DL1234"]) expect(m.text).toContain(s);
  });
  it("zach pickup: no lyft pitch", () => {
    const m = renderPreArrivalEmail({ ...args, pickup: "zach" });
    expect(m.text).toContain("picking you up");
    expect(m.text).not.toContain("lyft");
  });
  it("asks about the bag only when unknown", () => {
    expect(renderPreArrivalEmail({ ...args, checkedBag: null }).text).toContain("checking a bag");
    expect(renderPreArrivalEmail(args).text).not.toContain("checking a bag");
  });
});
```

- [ ] **Step 11: Run it and confirm it fails**

Run: `npx vitest run tests/lib/arrival/render.test.ts`
Expected: FAIL, cannot resolve `render`.

- [ ] **Step 12: Write `src/lib/arrival/render.ts`**

```ts
import type { Branch, Step } from "./route";
import type { Concourse, Pickup, RideLinks, RouteInput } from "./types";
import { BRANCH_LABEL, GROUP_TITLES, SMS_COPY, fillTemplate } from "./copy";

export interface StepItem { branch?: Branch; text: string }
export interface StepGroup { group: 1 | 2 | 3 | 4; title: string; items: StepItem[] }
export interface EmailMessage { subject: string; html: string; text: string }

const concourseVars = (c: Concourse | null) => ({ concourse: c ?? "your concourse" });

export function groupSteps(steps: Step[], pickup: Pickup, concourse: Concourse | null, copy: Record<string, string>): StepGroup[] {
  const groups: StepGroup[] = [];
  for (const s of steps) {
    const template = copy[s.id];
    if (template === undefined) throw new Error(`no copy for step ${s.id}`);
    let g = groups[groups.length - 1];
    if (!g || g.group !== s.group) {
      g = { group: s.group, title: GROUP_TITLES[pickup][s.group], items: [] };
      groups.push(g);
    }
    const text = fillTemplate(template, concourseVars(concourse));
    g.items.push(s.branch ? { branch: s.branch, text } : { text });
  }
  return groups;
}

export function renderSms(steps: Step[], pickup: Pickup, concourse: Concourse | null, pageUrl: string): string {
  const withCopy = steps.filter((s) => SMS_COPY[s.id] !== undefined);
  const line = (xs: Step[]) => xs.map((s) => fillTemplate(SMS_COPY[s.id]!, concourseVars(concourse))).join(" ");
  const parts = [line(withCopy.filter((s) => !s.branch))];
  const noBag = withCopy.filter((s) => s.branch === "no-bag");
  const bag = withCopy.filter((s) => s.branch === "bag");
  if (noBag.length) parts.push(`no bag: ${line(noBag)}`);
  if (bag.length) parts.push(`checked bag: ${line(bag)}`);
  const tail = pickup === "rideshare" ? "the rest + the lyft button:" : "the rest:";
  return `you landed!! ${parts.filter(Boolean).join(" ")} ${tail} ${pageUrl}`;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

const wrap = (inner: string) =>
  `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:16px;color:#1a1410;font-size:16px;line-height:1.5">${inner}</div>`;
const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;margin:8px 8px 0 0;padding:12px 18px;border-radius:999px;background:#1a1410;color:#f5e6d3;text-decoration:none;font-weight:600">${esc(label)}</a>`;

function groupsHtml(groups: StepGroup[]): string {
  return groups.map((g) => {
    let html = `<h3 style="margin:24px 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#8a6a4a">${esc(g.title)}</h3><ul style="margin:0;padding-left:20px">`;
    let last: Branch | undefined;
    for (const it of g.items) {
      if (it.branch && it.branch !== last) html += `<li style="list-style:none;margin:12px 0 4px -20px;font-weight:600">${esc(BRANCH_LABEL[it.branch])}:</li>`;
      last = it.branch;
      html += `<li style="margin:6px 0">${esc(it.text)}</li>`;
    }
    return html + "</ul>";
  }).join("");
}

function groupsText(groups: StepGroup[]): string {
  return groups.map((g) => {
    const lines = [g.title.toUpperCase()];
    let last: Branch | undefined;
    for (const it of g.items) {
      if (it.branch && it.branch !== last) lines.push(`${BRANCH_LABEL[it.branch]}:`);
      last = it.branch;
      lines.push(`- ${it.text}`);
    }
    return lines.join("\n");
  }).join("\n\n");
}

const callLine = (phone: string | null) =>
  phone ? `call me if anything goes sideways, ringer's on: ${phone}` : "call me if anything goes sideways, ringer's on.";

export interface LandedEmailArgs {
  firstName: string; steps: Step[]; input: RouteInput; copy: Record<string, string>;
  pageUrl: string; links: RideLinks; zachPhone: string | null;
}

export function renderLandedEmail(a: LandedEmailArgs): EmailMessage {
  const groups = groupSteps(a.steps, a.input.pickup, a.input.concourse, a.copy);
  const where = a.input.international === true ? "you landed, welcome in!!"
    : a.input.concourse ? `you landed in ${a.input.concourse}!!` : "you landed!!";
  const intro = `${where} here's exactly what to do, one step at a time. it's all on your page too:`;
  const ride = a.input.pickup === "rideshare";
  const html = wrap(
    `<p>hi ${esc(a.firstName)}!</p><p>${esc(intro)} <a href="${esc(a.pageUrl)}">${esc(a.pageUrl)}</a></p>` +
    (ride ? `<p>${button(a.links.lyft, "open lyft")}${button(a.links.uber, "open uber")}</p>` : "") +
    groupsHtml(groups) +
    `<p style="margin-top:24px">${esc(callLine(a.zachPhone))}</p><p>zach</p>`,
  );
  const text = [
    `hi ${a.firstName}!`, `${intro} ${a.pageUrl}`,
    ...(ride ? [`lyft: ${a.links.lyft}\nuber: ${a.links.uber}`] : []),
    groupsText(groups), callLine(a.zachPhone), "zach",
  ].join("\n\n");
  return { subject: "you landed!! here's how to get to me", html, text };
}

export interface PreArrivalArgs {
  firstName: string; arriveDate: string; flightNumber: string | null; checkedBag: boolean | null;
  pickup: Pickup; pageUrl: string; address: string; zachPhone: string | null;
}

export function renderPreArrivalEmail(a: PreArrivalArgs): EmailMessage {
  const day = new Date(`${a.arriveDate}T12:00:00Z`)
    .toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })
    .toLowerCase();
  const paras: string[] = [
    `hi ${a.firstName}! ok so you don't have to think when you land on ${day}, here's how it goes.`,
    `the second ${a.flightNumber ? a.flightNumber : "your flight"} lands i'll text + email you exact steps from your gate: where to go, which way to turn, where to get your ride. it's all on your page too, and it updates live: ${a.pageUrl}`,
    a.pickup === "rideshare"
      ? `plan on a lyft to my place (${a.address}), it's usually way cheaper than uber from the airport. your page has a button that opens lyft with my address already in.`
      : "i'm picking you up!! once you're off the plane just head for the arrivals curb and text me your door number.",
    ...(a.checkedBag === null ? ["let me know if you're checking a bag, it changes which way you turn at the top of the escalators."] : []),
    "you'll get an invite from an app called Door. download it and make an account before you fly, it's what unlocks my door. when you get to the building the concierge will send you up in the elevator.",
    callLine(a.zachPhone),
    "zach",
  ];
  const html = wrap(paras.map((p) => {
    const linked = esc(p).replace(esc(a.pageUrl), `<a href="${esc(a.pageUrl)}">${esc(a.pageUrl)}</a>`);
    return `<p>${linked}</p>`;
  }).join(""));
  return { subject: "your atlanta landing plan (so you don't have to think)", html, text: paras.join("\n\n") };
}
```

- [ ] **Step 13: Run the full suite**

Run: `npm test`
Expected: PASS. If the SMS length test fails, shorten the offending `SMS_COPY` entry (the failure message prints the text). Don't raise the 360 cap.

- [ ] **Step 14: Commit**

```bash
git add src/lib/arrival/copy.ts src/lib/arrival/deeplinks.ts src/lib/arrival/render.ts tests/helpers/env.ts tests/lib/arrival/copy.test.ts tests/lib/arrival/deeplinks.test.ts tests/lib/arrival/render.test.ts
git commit -m "feat(arrival): voice copy templates, ride deep links, SMS/email renderers"
```

### Task 4: AeroDataBox flight client

**Files:**
- Create: `src/server/guests/flight.ts`
- Test: `tests/server/flight.test.ts`

**Interfaces:**
- Consumes: `Concourse`, `CONCOURSES`, `TrackingState` (Task 1).
- Produces:
  - `interface FlightSnapshot`
  - `type FlightResult = { ok: true; snapshot: FlightSnapshot | null } | { ok: false; error: string }`
  - `normalizeAeroDataBox(raw: unknown, flightDate: string): FlightSnapshot | null`
  - `fetchFlight(number: string, date: string): Promise<FlightResult>`
  - `concourseFrom(gate, terminal): Concourse | null`
  - `airlineFromFlightNumber(n: string | null): string | null`

**Background, ported from `~/xbyz-platform/xbyz-app/netlify/functions/flight-status.js`:**
- **Endpoint:** `GET https://prod.api.market/api/v1/aedbx/aerodatabox/flights/number/{DL1234}/{YYYY-MM-DD}` with header `x-api-market-key: $AERODATABOX_API_KEY`.
- **Empty responses:** 204/404 or an empty body means not found.
- **Response shape:** an array, or `{ data: [...] }`. Each item has `status`, `airline.iata`, `departure.airport.{iata,countryCode}`, `departure.scheduledTime`, `arrival.airport.iata`, `arrival.{scheduledTime,revisedTime,predictedTime,runwayTime}`, `arrival.gate`, and `arrival.terminal`.
- **Time values:** either `{ utc: "2026-09-20 12:25Z", local: "2026-09-20 08:25-04:00" }` or a plain string.
- **Status values (AeroDataBox enum):** Unknown, Expected, EnRoute, CheckIn, Boarding, GateClosed, Departed, Delayed, Approaching, Arrived, Canceled, CanceledUncertain, Diverted.

- [ ] **Step 1: Write the failing tests**

`tests/server/flight.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizeAeroDataBox, fetchFlight, concourseFrom, airlineFromFlightNumber } from "../../src/server/guests/flight";

const ORIGINAL_FETCH = global.fetch;
afterEach(() => { global.fetch = ORIGINAL_FETCH; delete process.env.AERODATABOX_API_KEY; });

function adbx(o: { status?: string; gate?: string; terminal?: string; from?: string; country?: string; to?: string; revised?: string; runway?: string; airline?: string } = {}) {
  return {
    number: "DL 1234",
    status: o.status ?? "Expected",
    airline: { iata: o.airline ?? "DL", name: "Delta Air Lines" },
    departure: {
      airport: { iata: o.from ?? "LGA", countryCode: o.country ?? "US" },
      scheduledTime: { utc: "2026-09-20 10:00Z", local: "2026-09-20 06:00-04:00" },
    },
    arrival: {
      airport: { iata: o.to ?? "ATL", countryCode: "US" },
      scheduledTime: { utc: "2026-09-20 12:25Z", local: "2026-09-20 08:25-04:00" },
      ...(o.revised ? { revisedTime: { utc: o.revised } } : {}),
      ...(o.runway ? { runwayTime: { utc: o.runway } } : {}),
      ...(o.gate ? { gate: o.gate } : {}),
      ...(o.terminal ? { terminal: o.terminal } : {}),
    },
  };
}

describe("concourseFrom", () => {
  it("uses the gate letter first, then a single-letter terminal", () => {
    expect(concourseFrom("B12", "S")).toBe("B");
    expect(concourseFrom(" t5 ", null)).toBe("T");
    expect(concourseFrom(null, "E")).toBe("E");
    expect(concourseFrom(null, "I")).toBe("F");
    expect(concourseFrom("12", "S")).toBeNull();
    expect(concourseFrom(null, null)).toBeNull();
  });
});

describe("airlineFromFlightNumber", () => {
  it("takes the two-character prefix", () => {
    expect(airlineFromFlightNumber("DL1234")).toBe("DL");
    expect(airlineFromFlightNumber("B6123")).toBe("B6");
    expect(airlineFromFlightNumber(null)).toBeNull();
  });
});

describe("normalizeAeroDataBox", () => {
  it("scheduled domestic flight, no gate yet", () => {
    expect(normalizeAeroDataBox([adbx()], "2026-09-20")).toEqual({
      state: "scheduled", airline: "DL", arrivalAirport: "ATL", international: false,
      gate: null, terminal: null, concourse: null,
      scheduledDeparture: "2026-09-20T10:00:00.000Z", scheduledArrival: "2026-09-20T12:25:00.000Z",
      estimatedArrival: null, landedAt: null,
    });
  });
  it("en route with a gate and a revised time", () => {
    const s = normalizeAeroDataBox({ data: [adbx({ status: "EnRoute", gate: "B12", revised: "2026-09-20 13:10Z" })] }, "2026-09-20")!;
    expect(s.state).toBe("departed");
    expect(s.concourse).toBe("B");
    expect(s.estimatedArrival).toBe("2026-09-20T13:10:00.000Z");
  });
  it("arrived: landedAt prefers runway time", () => {
    const s = normalizeAeroDataBox([adbx({ status: "Arrived", gate: "T5", runway: "2026-09-20 12:19Z", revised: "2026-09-20 12:30Z" })], "2026-09-20")!;
    expect(s.state).toBe("landed");
    expect(s.landedAt).toBe("2026-09-20T12:19:00.000Z");
  });
  it("maps cancel/divert/unknown statuses; Approaching is NOT landed", () => {
    const st = (status: string) => normalizeAeroDataBox([adbx({ status })], "2026-09-20")!.state;
    expect(st("Canceled")).toBe("cancelled");
    expect(st("CanceledUncertain")).toBe("cancelled");
    expect(st("Diverted")).toBe("diverted");
    expect(st("Approaching")).toBe("departed");
    expect(st("Unknown")).toBe("unknown");
    expect(st("Boarding")).toBe("scheduled");
  });
  it("international vs preclearance vs missing country", () => {
    const intl = (from: string, country: string) => normalizeAeroDataBox([adbx({ from, country })], "2026-09-20")!.international;
    expect(intl("CDG", "FR")).toBe(true);
    expect(intl("YYZ", "CA")).toBe(false); // US preclearance: arrives as domestic
    expect(intl("SJU", "PR")).toBe(false);
    expect(intl("LGA", "")).toBeNull();
  });
  it("only returns a leg arriving ATL", () => {
    expect(normalizeAeroDataBox([adbx({ to: "MCO" })], "2026-09-20")).toBeNull();
    expect(normalizeAeroDataBox([], "2026-09-20")).toBeNull();
    expect(normalizeAeroDataBox("garbage", "2026-09-20")).toBeNull();
  });
});

describe("fetchFlight", () => {
  it("calls api.market with the key and normalizes", async () => {
    process.env.AERODATABOX_API_KEY = "k";
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify([adbx({ gate: "C3" })]) });
    global.fetch = f as unknown as typeof fetch;
    const r = await fetchFlight("DL1234", "2026-09-20");
    expect(f).toHaveBeenCalledWith(
      "https://prod.api.market/api/v1/aedbx/aerodatabox/flights/number/DL1234/2026-09-20",
      expect.objectContaining({ headers: { "x-api-market-key": "k" } }),
    );
    expect(r).toMatchObject({ ok: true, snapshot: { concourse: "C" } });
  });
  it("204/404/empty body are not-found, not errors", async () => {
    process.env.AERODATABOX_API_KEY = "k";
    for (const res of [{ ok: false, status: 404, text: async () => "" }, { ok: true, status: 204, text: async () => "" }]) {
      global.fetch = vi.fn().mockResolvedValue(res) as unknown as typeof fetch;
      expect(await fetchFlight("DL1234", "2026-09-20")).toEqual({ ok: true, snapshot: null });
    }
  });
  it("5xx, network errors and a missing key are errors, and never throw", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "down" }) as unknown as typeof fetch;
    expect((await fetchFlight("DL1234", "2026-09-20")).ok).toBe(false); // no key
    process.env.AERODATABOX_API_KEY = "k";
    expect(await fetchFlight("DL1234", "2026-09-20")).toMatchObject({ ok: false, error: expect.stringContaining("503") });
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNRESET")) as unknown as typeof fetch;
    expect(await fetchFlight("DL1234", "2026-09-20")).toMatchObject({ ok: false, error: expect.stringContaining("ECONNRESET") });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run tests/server/flight.test.ts`
Expected: FAIL, cannot resolve `flight`.

- [ ] **Step 3: Write `src/server/guests/flight.ts`**

```ts
import { CONCOURSES, type Concourse, type TrackingState } from "../../lib/arrival/types";

export interface FlightSnapshot {
  state: Exclude<TrackingState, "idle">;
  airline: string | null;
  arrivalAirport: string | null;
  international: boolean | null;
  gate: string | null;
  terminal: string | null;
  concourse: Concourse | null;
  scheduledDeparture: string | null;
  scheduledArrival: string | null;
  estimatedArrival: string | null;
  landedAt: string | null;
}

export type FlightResult = { ok: true; snapshot: FlightSnapshot | null } | { ok: false; error: string };

const DOMESTIC_COUNTRIES = new Set(["US", "PR", "VI", "GU", "AS", "MP"]);
// US CBP preclearance airports: passengers clear US customs before departure and arrive at ATL as domestic.
const PRECLEARANCE = new Set(["YYZ", "YUL", "YVR", "YYC", "YEG", "YOW", "YHZ", "YWG", "DUB", "SNN", "NAS", "FPO", "BDA", "AUA", "AUH"]);

export function airlineFromFlightNumber(n: string | null): string | null {
  const m = n?.trim().toUpperCase().match(/^([A-Z0-9]{2})\s?\d{1,4}$/);
  return m ? m[1] : null;
}

export function concourseFrom(gate: string | null | undefined, terminal: string | null | undefined): Concourse | null {
  const g = gate?.trim().toUpperCase();
  if (g && (CONCOURSES as readonly string[]).includes(g[0])) return g[0] as Concourse;
  const t = terminal?.trim().toUpperCase();
  if (t === "I") return "F"; // International Terminal
  if (t && t.length === 1 && (CONCOURSES as readonly string[]).includes(t)) return t as Concourse;
  return null;
}

type TimeVal = string | { utc?: string; local?: string } | undefined;
function iso(v: TimeVal): string | null {
  const s = typeof v === "string" ? v : v?.utc ?? v?.local;
  if (!s) return null;
  const d = new Date(s.trim().replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapStatus(s: unknown): FlightSnapshot["state"] {
  switch (String(s ?? "").toLowerCase()) {
    case "arrived": case "landed": return "landed";
    case "departed": case "enroute": case "en route": case "approaching": case "airborne": return "departed";
    case "canceled": case "cancelled": case "canceleduncertain": return "cancelled";
    case "diverted": return "diverted";
    case "unknown": return "unknown";
    default: return "scheduled"; // Expected, CheckIn, Boarding, GateClosed, Delayed, missing
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

export function normalizeAeroDataBox(raw: unknown, flightDate: string): FlightSnapshot | null {
  const list: Raw[] = Array.isArray(raw) ? raw : Array.isArray((raw as Raw)?.data) ? (raw as Raw).data : [];
  const toAtl = list.filter((f) => f?.arrival?.airport?.iata === "ATL");
  if (toAtl.length === 0) return null;
  const f = toAtl.find((x) => (iso(x.departure?.scheduledTime) ?? "").slice(0, 10) === flightDate) ?? toAtl[0];

  const from = f.departure?.airport?.iata as string | undefined;
  const country = (f.departure?.airport?.countryCode as string | undefined)?.toUpperCase();
  const international = from && PRECLEARANCE.has(from) ? false : country ? !DOMESTIC_COUNTRIES.has(country) : null;
  const state = mapStatus(f.status);
  const gate = (f.arrival?.gate as string | undefined)?.trim() || null;
  const terminal = (f.arrival?.terminal as string | undefined)?.trim() || null;
  const estimatedArrival = iso(f.arrival?.revisedTime) ?? iso(f.arrival?.predictedTime);

  return {
    state,
    airline: f.airline?.iata ?? null,
    arrivalAirport: "ATL",
    international,
    gate,
    terminal,
    concourse: concourseFrom(gate, terminal),
    scheduledDeparture: iso(f.departure?.scheduledTime),
    scheduledArrival: iso(f.arrival?.scheduledTime),
    estimatedArrival,
    landedAt: state === "landed" ? iso(f.arrival?.runwayTime) ?? estimatedArrival ?? iso(f.arrival?.scheduledTime) : null,
  };
}

export async function fetchFlight(number: string, date: string): Promise<FlightResult> {
  const key = process.env.AERODATABOX_API_KEY;
  if (!key) return { ok: false, error: "AERODATABOX_API_KEY not set" };
  const url = `https://prod.api.market/api/v1/aedbx/aerodatabox/flights/number/${encodeURIComponent(number)}/${date}`;
  try {
    const res = await fetch(url, { headers: { "x-api-market-key": key } });
    const text = await res.text();
    if (res.status === 404 || res.status === 204 || (res.ok && !text.trim())) return { ok: true, snapshot: null };
    if (!res.ok) return { ok: false, error: `aerodatabox ${res.status}: ${text.slice(0, 200)}` };
    let data: unknown;
    try { data = JSON.parse(text); } catch { return { ok: false, error: `aerodatabox bad json: ${text.slice(0, 200)}` }; }
    return { ok: true, snapshot: normalizeAeroDataBox(data, date) };
  } catch (e) {
    return { ok: false, error: `aerodatabox unreachable: ${(e as Error).message}` };
  }
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/server/flight.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/guests/flight.ts tests/server/flight.test.ts
git commit -m "feat(arrival): AeroDataBox client with ATL-leg normalization"
```

(A real captured response gets checked against this normalizer in Task 10, not here, because it costs a paid call.)

### Task 5: Home config and senders (email, SMS, ntfy)

**Files:**
- Create: `src/server/guests/home.ts`, `src/server/guests/email.ts`, `src/server/guests/sms.ts`, `src/server/guests/ntfy.ts`
- Test: `tests/server/senders.test.ts`

**Interfaces:**
- Consumes: `HomeVars` (Task 1).
- Produces:
  - `homeFromEnv(): { ok: true; home: HomeVars } | { ok: false; error: string }`
  - `type SendResult = { ok: true; id: string } | { ok: false; skipped?: false; error: string } | { ok: false; skipped: true; reason: string }`
  - `sendEmail(msg: { to: string; subject: string; html: string; text: string }): Promise<SendResult>`
  - `sendSms(msg: { to: string; body: string }): Promise<SendResult>`
  - `sendNtfy(msg: NtfyMessage): Promise<{ ok: true } | { ok: false; error: string }>` with `NtfyMessage { title: string; body: string; click?: string; priority?: "default" | "high" }`

All three senders **never throw**.

**Env:**
- **Resend:** `RESEND_API_KEY`, `GUEST_EMAIL_FROM` (e.g. `Zach <zach@…>`), `ZACH_REPLY_TO`.
- **Twilio:** `GUEST_SMS_ENABLED` (must be exactly `"true"`), `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.
- **ntfy:** `NTFY_TOPIC`.
- **Home:** `HOME_*` (see `tests/helpers/env.ts` for the names).

- [ ] **Step 1: Write the failing tests**

`tests/server/senders.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { homeFromEnv } from "../../src/server/guests/home";
import { sendEmail } from "../../src/server/guests/email";
import { sendSms } from "../../src/server/guests/sms";
import { sendNtfy } from "../../src/server/guests/ntfy";
import { applyFakeEnv, FAKE_ENV } from "../helpers/env";

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_ENV = { ...process.env };
beforeEach(() => { applyFakeEnv(); });
afterEach(() => { global.fetch = ORIGINAL_FETCH; process.env = { ...ORIGINAL_ENV }; });

const mockFetch = (res: unknown) => { const f = vi.fn().mockResolvedValue(res); global.fetch = f as unknown as typeof fetch; return f; };

describe("homeFromEnv", () => {
  it("reads every HOME_* var and parses coordinates", () => {
    const r = homeFromEnv();
    expect(r).toEqual({ ok: true, home: { address: FAKE_ENV.HOME_ADDRESS, lat: 33.7, lng: -84.3, street: "test", crossStreet: "99th", unit: "7Q", unitLetter: "Q", floor: "7" } });
  });
  it("names every missing or bad var", () => {
    delete process.env.HOME_UNIT; process.env.HOME_LAT = "north-ish";
    const r = homeFromEnv();
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).toContain("HOME_UNIT"); expect(r.error).toContain("HOME_LAT"); }
  });
});

describe("sendEmail", () => {
  beforeEach(() => { process.env.RESEND_API_KEY = "re_x"; process.env.GUEST_EMAIL_FROM = "Zach <zach@example.test>"; process.env.ZACH_REPLY_TO = "zach@example.test"; });
  it("posts to Resend with from, reply_to and both bodies", async () => {
    const f = mockFetch({ ok: true, status: 200, json: async () => ({ id: "em_1" }) });
    expect(await sendEmail({ to: "g@example.test", subject: "s", html: "<p>h</p>", text: "h" })).toEqual({ ok: true, id: "em_1" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_x");
    expect(JSON.parse(init.body)).toEqual({ from: "Zach <zach@example.test>", to: ["g@example.test"], subject: "s", html: "<p>h</p>", text: "h", reply_to: "zach@example.test" });
  });
  it("returns errors instead of throwing", async () => {
    mockFetch({ ok: false, status: 422, json: async () => ({ message: "bad from" }) });
    expect(await sendEmail({ to: "g@example.test", subject: "s", html: "", text: "" })).toEqual({ ok: false, error: "resend 422: bad from" });
    global.fetch = vi.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;
    expect((await sendEmail({ to: "g@example.test", subject: "s", html: "", text: "" })).ok).toBe(false);
    delete process.env.RESEND_API_KEY;
    expect((await sendEmail({ to: "g@example.test", subject: "s", html: "", text: "" })).ok).toBe(false);
  });
});

describe("sendSms", () => {
  beforeEach(() => { process.env.TWILIO_ACCOUNT_SID = "AC1"; process.env.TWILIO_AUTH_TOKEN = "t"; process.env.TWILIO_FROM_NUMBER = "+15555550199"; });
  it("is skipped, not failed, unless GUEST_SMS_ENABLED is exactly 'true'", async () => {
    const f = mockFetch({ ok: true });
    for (const v of [undefined, "1", "yes", "TRUE"]) {
      if (v === undefined) delete process.env.GUEST_SMS_ENABLED; else process.env.GUEST_SMS_ENABLED = v;
      expect(await sendSms({ to: "+15555550111", body: "hi" })).toMatchObject({ ok: false, skipped: true });
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("posts form-encoded to Twilio with basic auth when enabled", async () => {
    process.env.GUEST_SMS_ENABLED = "true";
    const f = mockFetch({ ok: true, status: 201, json: async () => ({ sid: "SM1" }) });
    expect(await sendSms({ to: "+15555550111", body: "hi there" })).toEqual({ ok: true, id: "SM1" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    expect(init.headers.Authorization).toBe("Basic " + Buffer.from("AC1:t").toString("base64"));
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ From: "+15555550199", To: "+15555550111", Body: "hi there" });
  });
  it("returns Twilio errors instead of throwing", async () => {
    process.env.GUEST_SMS_ENABLED = "true";
    mockFetch({ ok: false, status: 400, json: async () => ({ message: "unregistered number" }) });
    expect(await sendSms({ to: "+15555550111", body: "x" })).toEqual({ ok: false, error: "twilio 400: unregistered number" });
  });
});

describe("sendNtfy", () => {
  beforeEach(() => { process.env.NTFY_TOPIC = "zach-guests-test"; });
  it("posts the body, keeps headers ASCII even with fancy title text", async () => {
    const f = mockFetch({ ok: true, status: 200 });
    expect(await sendNtfy({ title: "Shiner landed — T5 ✈", body: "body — with unicode ✓", click: "https://guest.example.test/arrive/x", priority: "high" })).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://ntfy.sh/zach-guests-test");
    expect(init.body).toBe("body — with unicode ✓");
    for (const v of Object.values(init.headers as Record<string, string>)) expect(v).toMatch(/^[\x20-\x7E]*$/);
    expect(init.headers.Title).toBe("Shiner landed - T5 ?");
    expect(init.headers.Priority).toBe("high");
  });
  it("never throws: missing topic, non-2xx, network error", async () => {
    delete process.env.NTFY_TOPIC;
    expect((await sendNtfy({ title: "t", body: "b" })).ok).toBe(false);
    process.env.NTFY_TOPIC = "x";
    mockFetch({ ok: false, status: 500 });
    expect((await sendNtfy({ title: "t", body: "b" })).ok).toBe(false);
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    expect((await sendNtfy({ title: "t", body: "b" })).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run tests/server/senders.test.ts`
Expected: FAIL, cannot resolve the modules.

- [ ] **Step 3: Write `src/server/guests/home.ts`**

```ts
import type { HomeVars } from "../../lib/arrival/types";

export function homeFromEnv(): { ok: true; home: HomeVars } | { ok: false; error: string } {
  const e = process.env;
  const missing = ["HOME_ADDRESS", "HOME_STREET", "HOME_CROSS_STREET", "HOME_UNIT", "HOME_UNIT_LETTER", "HOME_FLOOR"]
    .filter((k) => !e[k]?.trim());
  const lat = Number(e.HOME_LAT);
  const lng = Number(e.HOME_LNG);
  if (!e.HOME_LAT || !Number.isFinite(lat)) missing.push("HOME_LAT");
  if (!e.HOME_LNG || !Number.isFinite(lng)) missing.push("HOME_LNG");
  if (missing.length) return { ok: false, error: `home config missing/invalid: ${missing.join(", ")}` };
  return {
    ok: true,
    home: {
      address: e.HOME_ADDRESS!, lat, lng, street: e.HOME_STREET!, crossStreet: e.HOME_CROSS_STREET!,
      unit: e.HOME_UNIT!, unitLetter: e.HOME_UNIT_LETTER!, floor: e.HOME_FLOOR!,
    },
  };
}
```

- [ ] **Step 4: Write `src/server/guests/email.ts`**

```ts
export type SendResult =
  | { ok: true; id: string }
  | { ok: false; skipped?: false; error: string }
  | { ok: false; skipped: true; reason: string };

export async function sendEmail(msg: { to: string; subject: string; html: string; text: string }): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.GUEST_EMAIL_FROM;
  const replyTo = process.env.ZACH_REPLY_TO;
  if (!key || !from) return { ok: false, error: "RESEND_API_KEY or GUEST_EMAIL_FROM not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: `resend ${res.status}: ${body.message ?? ""}`.trim() };
    if (!body.id) return { ok: false, error: "resend returned no id" };
    return { ok: true, id: body.id };
  } catch (e) {
    return { ok: false, error: `resend unreachable: ${(e as Error).message}` };
  }
}
```

- [ ] **Step 5: Write `src/server/guests/sms.ts`**

```ts
import type { SendResult } from "./email";

// Texts need US carrier registration (10DLC / toll-free) before Twilio will deliver them.
// Until that's approved, GUEST_SMS_ENABLED stays unset and every text is recorded as skipped.
export async function sendSms(msg: { to: string; body: string }): Promise<SendResult> {
  if (process.env.GUEST_SMS_ENABLED !== "true") return { ok: false, skipped: true, reason: "sms disabled (GUEST_SMS_ENABLED)" };
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { ok: false, error: "Twilio env vars missing" };
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: from, To: msg.to, Body: msg.body }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) return { ok: false, error: `twilio ${res.status}: ${body.message ?? ""}`.trim() };
    return { ok: true, id: body.sid ?? "unknown" };
  } catch (e) {
    return { ok: false, error: `twilio unreachable: ${(e as Error).message}` };
  }
}
```

- [ ] **Step 6: Write `src/server/guests/ntfy.ts`**

```ts
export interface NtfyMessage { title: string; body: string; click?: string; priority?: "default" | "high" }

// Header values must be Latin1 or fetch throws before sending; keep them printable ASCII.
const ascii = (s: string) => s.replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "?");

// A 2xx means ntfy ACCEPTED the message, not that a phone received it.
export async function sendNtfy(msg: NtfyMessage): Promise<{ ok: true } | { ok: false; error: string }> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return { ok: false, error: "NTFY_TOPIC not set" };
  const headers: Record<string, string> = { Title: ascii(msg.title), Tags: "house" };
  if (msg.priority) headers.Priority = msg.priority;
  if (msg.click) headers.Click = ascii(encodeURI(msg.click));
  try {
    const res = await fetch(`https://ntfy.sh/${topic}`, { method: "POST", headers, body: msg.body });
    return res.ok ? { ok: true } : { ok: false, error: `ntfy ${res.status}` };
  } catch (e) {
    return { ok: false, error: `ntfy unreachable: ${(e as Error).message}` };
  }
}
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npx vitest run tests/server/senders.test.ts`
Expected: PASS (9 tests). If the ntfy title assertion fails because the non-ASCII replacement differs, fix `ascii()`, not the test. `—` becomes `-`, and `✈` becomes `?`.

- [ ] **Step 8: Commit**

```bash
git add src/server/guests/home.ts src/server/guests/email.ts src/server/guests/sms.ts src/server/guests/ntfy.ts tests/server/senders.test.ts
git commit -m "feat(arrival): home env config and never-throw email/sms/ntfy senders"
```

### Task 6: Guest intake API (`/api/guests`)

**Files:**
- Create: `src/server/guests/validate.ts`, `src/server/guests/view.ts`, `netlify/functions/guests.ts`
- Test: `tests/server/validate.test.ts`, `tests/functions/guests.test.ts`

**Interfaces:**
- Consumes: `Guest`, `emptyTracking`, `Pickup` (Task 1); `GuestStore`, `blobGuestStore` (Task 1); `sendNtfy` (Task 5).
- Produces:
  - `interface GuestInput`, `type Parsed<T>`
  - `parseCreate(body: unknown): Parsed<GuestInput>`, `parsePatch(body: unknown): Parsed<Partial<GuestInput>>`
  - `normalizeFlightNumber(s): string | null`
  - `newGuest(input, now, rand?): Guest`, `applyPatch(g, patch): Guest`
  - `siteUrl(): string`, `pageUrl(site: string, g: Guest): string`
  - HTTP: `GET/POST/PATCH/DELETE /api/guests` with `Authorization: Bearer $GUEST_API_KEY`

**Contract for Muse and Claude Code** (it goes in the README in Task 9):
- **`POST /api/guests`** takes a JSON body with:
  - Required: `name`, `arriveDate`, `departDate`.
  - Optional: `firstName`, `email`, `phone` (E.164), `flight: { number, date }`, `checkedBag` (true/false/null), `pickup` ("rideshare" | "zach"), `doorInvited`, `buildingRegistered`.
  - Unknown keys are rejected, so a typo like `checked_bag` fails loudly instead of being silently dropped.
  - A missing `checkedBag` is stored as `null`, never `false`.
- **`PATCH /api/guests?id=<id>`** takes any subset of those fields. Changing `flight` resets tracking and the landed sends.
- **`GET /api/guests`** lists every guest, each with its `pageUrl`.
- **`DELETE /api/guests?id=<id>`** removes a guest.

- [ ] **Step 1: Write the failing validation tests**

`tests/server/validate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseCreate, parsePatch, newGuest, applyPatch, normalizeFlightNumber } from "../../src/server/guests/validate";
import { makeGuest } from "../helpers/guest";

const ok = { name: "Melissa Test", arriveDate: "2026-09-20", departDate: "2026-09-23" };

describe("parseCreate", () => {
  it("accepts the minimum and leaves checkedBag unknown", () => {
    const r = parseCreate(ok);
    expect(r.ok).toBe(true);
    const g = newGuest((r as { ok: true; value: typeof ok }).value, new Date("2026-09-10T15:00:00Z"));
    expect(g.checkedBag).toBeNull();
    expect(g.pickup).toBe("rideshare");
    expect(g.firstName).toBe("Melissa");
    expect(g.doorInvited).toBe(false);
  });
  it("rejects unknown keys by name (catches typos)", () => {
    const r = parseCreate({ ...ok, checked_bag: true });
    expect(r).toEqual({ ok: false, errors: ['unknown field "checked_bag"'] });
  });
  it("validates every field", () => {
    const r = parseCreate({ name: " ", arriveDate: "2026-02-30", departDate: "tomorrow", email: "nope", phone: "404-555-0100", flight: { number: "Delta 12", date: "9/20" }, checkedBag: "no", pickup: "car", doorInvited: "yes" });
    expect(r.ok).toBe(false);
    const errs = (r as { ok: false; errors: string[] }).errors.join("\n");
    for (const f of ["name", "arriveDate", "departDate", "email", "phone", "flight.number", "flight.date", "checkedBag", "pickup", "doorInvited"]) expect(errs).toContain(f);
  });
  it("rejects departing before arriving", () => {
    expect(parseCreate({ ...ok, departDate: "2026-09-19" }).ok).toBe(false);
  });
  it("normalizes flight numbers", () => {
    expect(normalizeFlightNumber("dl 1234")).toBe("DL1234");
    expect(normalizeFlightNumber("B6 88")).toBe("B688");
    expect(normalizeFlightNumber("Delta 1234")).toBeNull();
    const r = parseCreate({ ...ok, flight: { number: "dl 1234", date: "2026-09-20" } });
    expect(r).toMatchObject({ ok: true, value: { flight: { number: "DL1234", date: "2026-09-20" } } });
  });
});

describe("newGuest", () => {
  it("makes an unguessable token and a readable id", () => {
    const g = newGuest({ ...ok, firstName: "Shiner" }, new Date());
    expect(g.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(g.id).toMatch(/^melissa-test-[0-9a-f]{6}$/);
    expect(g.firstName).toBe("Shiner");
    expect(newGuest(ok, new Date()).token).not.toBe(g.token);
  });
});

describe("parsePatch + applyPatch", () => {
  it("allows partial updates and never touches id/token", () => {
    const p = parsePatch({ checkedBag: true });
    expect(p).toEqual({ ok: true, value: { checkedBag: true } });
    expect(parsePatch({ token: "x" }).ok).toBe(false);
    const g = makeGuest();
    const next = applyPatch(g, { checkedBag: true });
    expect(next.checkedBag).toBe(true);
    expect(next.token).toBe(g.token);
    expect(g.checkedBag).toBe(false); // input not mutated
  });
  it("a flight change resets tracking and landed sends, keeps the pre-arrival record", () => {
    const g = makeGuest({
      tracking: { ...makeGuest().tracking, state: "landed", gate: "B12", concourse: "B" },
      sends: { preArrival: { status: "sent", at: "x", attempts: 1 }, landedEmail: { status: "sent", at: "x", attempts: 1 } },
      alertsSent: ["created", "door-reminder", "delay:30", "gate:B12", "landed"],
    });
    const next = applyPatch(g, { flight: { number: "DL9", date: "2026-09-21" } });
    expect(next.tracking.state).toBe("idle");
    expect(next.tracking.gate).toBeNull();
    expect(next.sends.landedEmail).toBeUndefined();
    expect(next.sends.preArrival?.status).toBe("sent");
    expect(next.alertsSent).toEqual(["created", "door-reminder"]);
  });
  it("patching the same flight changes nothing about tracking", () => {
    const g = makeGuest({ tracking: { ...makeGuest().tracking, state: "departed" } });
    expect(applyPatch(g, { flight: { ...g.flight! } }).tracking.state).toBe("departed");
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run tests/server/validate.test.ts`
Expected: FAIL, cannot resolve `validate`.

- [ ] **Step 3: Write `src/server/guests/validate.ts`**

```ts
import { randomBytes } from "node:crypto";
import { emptyTracking, type Guest, type Pickup } from "../../lib/arrival/types";

export interface GuestInput {
  name: string;
  firstName?: string;
  email?: string | null;
  phone?: string | null;
  arriveDate: string;
  departDate: string;
  flight?: { number: string; date: string } | null;
  checkedBag?: boolean | null;
  pickup?: Pickup;
  doorInvited?: boolean;
  buildingRegistered?: boolean;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const ALLOWED = new Set(["name", "firstName", "email", "phone", "arriveDate", "departDate", "flight", "checkedBag", "pickup", "doorInvited", "buildingRegistered"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function normalizeFlightNumber(s: string): string | null {
  const m = s.trim().toUpperCase().match(/^([A-Z0-9]{2})\s?(\d{1,4})$/);
  return m ? `${m[1]}${m[2]}` : null;
}

function check(body: unknown, partial: boolean): Parsed<Partial<GuestInput>> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, errors: ["body must be a JSON object"] };
  const b = body as Record<string, unknown>;
  const errors: string[] = [];
  const out: Partial<GuestInput> = {};
  const has = (k: string) => Object.hasOwn(b, k);

  for (const k of Object.keys(b)) if (!ALLOWED.has(k)) errors.push(`unknown field "${k}"`);

  if (!partial || has("name")) {
    if (typeof b.name === "string" && b.name.trim()) out.name = b.name.trim(); else errors.push("name is required");
  }
  if (has("firstName")) {
    if (typeof b.firstName === "string" && b.firstName.trim()) out.firstName = b.firstName.trim(); else errors.push("firstName must be a non-empty string");
  }
  if (has("email")) {
    if (b.email === null) out.email = null;
    else if (typeof b.email === "string" && EMAIL.test(b.email.trim())) out.email = b.email.trim();
    else errors.push("email must be an address or null");
  }
  if (has("phone")) {
    if (b.phone === null) out.phone = null;
    else if (typeof b.phone === "string" && E164.test(b.phone)) out.phone = b.phone;
    else errors.push('phone must be E.164 like "+14045550100" or null');
  }
  for (const k of ["arriveDate", "departDate"] as const) {
    if (!partial || has(k)) {
      if (validDate(b[k])) out[k] = b[k] as string; else errors.push(`${k} must be a real YYYY-MM-DD date`);
    }
  }
  if (has("flight")) {
    if (b.flight === null) out.flight = null;
    else {
      const f = (typeof b.flight === "object" && b.flight !== null ? b.flight : {}) as Record<string, unknown>;
      const number = typeof f.number === "string" ? normalizeFlightNumber(f.number) : null;
      if (!number) errors.push('flight.number must look like "DL1234"');
      if (!validDate(f.date)) errors.push("flight.date must be YYYY-MM-DD (the departure date on their ticket)");
      if (number && validDate(f.date)) out.flight = { number, date: f.date };
    }
  }
  if (has("checkedBag")) {
    if (b.checkedBag === null || typeof b.checkedBag === "boolean") out.checkedBag = b.checkedBag;
    else errors.push("checkedBag must be true, false, or null (unknown)");
  }
  if (has("pickup")) {
    if (b.pickup === "rideshare" || b.pickup === "zach") out.pickup = b.pickup; else errors.push('pickup must be "rideshare" or "zach"');
  }
  for (const k of ["doorInvited", "buildingRegistered"] as const) {
    if (has(k)) { if (typeof b[k] === "boolean") out[k] = b[k] as boolean; else errors.push(`${k} must be true or false`); }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export function parseCreate(body: unknown): Parsed<GuestInput> {
  const r = check(body, false);
  if (!r.ok) return r;
  if (r.value.departDate! < r.value.arriveDate!) return { ok: false, errors: ["departDate is before arriveDate"] };
  return r as Parsed<GuestInput>;
}

export function parsePatch(body: unknown): Parsed<Partial<GuestInput>> {
  return check(body, true);
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "guest";

export function newGuest(input: GuestInput, now: Date, rand: (n: number) => Buffer = randomBytes): Guest {
  return {
    id: `${slug(input.name)}-${rand(3).toString("hex")}`,
    token: rand(32).toString("base64url"),
    name: input.name,
    firstName: input.firstName ?? input.name.split(/\s+/)[0],
    email: input.email ?? null,
    phone: input.phone ?? null,
    arriveDate: input.arriveDate,
    departDate: input.departDate,
    flight: input.flight ?? null,
    checkedBag: input.checkedBag ?? null,
    pickup: input.pickup ?? "rideshare",
    doorInvited: input.doorInvited ?? false,
    buildingRegistered: input.buildingRegistered ?? false,
    tracking: emptyTracking(),
    sends: {},
    alertsSent: [],
    createdAt: now.toISOString(),
  };
}

// Alert keys that belong to one specific flight; cleared when the flight changes.
const FLIGHT_ALERT = /^(delay:|gate:|state:|errors:|stale$|not-found$|landed$|stuck:landed|failed:landed|no-flight$)/;

export function applyPatch(g: Guest, patch: Partial<GuestInput>): Guest {
  const next = structuredClone(g);
  const flightChanged = Object.hasOwn(patch, "flight") && JSON.stringify(patch.flight ?? null) !== JSON.stringify(g.flight);
  Object.assign(next, patch);
  if (flightChanged) {
    next.tracking = emptyTracking();
    delete next.sends.landedEmail;
    delete next.sends.landedSms;
    next.alertsSent = next.alertsSent.filter((k) => !FLIGHT_ALERT.test(k));
  }
  return next;
}
```

- [ ] **Step 4: Run the validation tests and confirm they pass**

Run: `npx vitest run tests/server/validate.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Write `src/server/guests/view.ts` (first part)**

```ts
import type { Guest } from "../../lib/arrival/types";

export function siteUrl(): string {
  return (process.env.SITE_URL ?? "https://guest.xbyz.fun").replace(/\/$/, "");
}

export function pageUrl(site: string, g: Guest): string {
  return `${site}/arrive/${g.token}`;
}
```

- [ ] **Step 6: Write the failing function tests**

`tests/functions/guests.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryGuestStore, type GuestStore } from "../../src/server/guests/store";
import { applyFakeEnv } from "../helpers/env";

let mem: GuestStore;
vi.mock("../../src/server/guests/store", async (orig) => ({
  ...(await orig<typeof import("../../src/server/guests/store")>()),
  blobGuestStore: () => mem,
}));
const ntfy = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
vi.mock("../../src/server/guests/ntfy", () => ({ sendNtfy: (m: unknown) => ntfy(m) }));

const KEY = "test-guest-key-123";
const call = async (method: string, body?: unknown, query = "", auth = `Bearer ${KEY}`) => {
  const { default: handler } = await import("../../netlify/functions/guests");
  return handler(new Request(`https://guest.example.test/api/guests${query}`, {
    method, headers: { authorization: auth, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
};
const valid = { name: "Melissa Test", firstName: "Testy", arriveDate: "2026-09-20", departDate: "2026-09-23", flight: { number: "DL1234", date: "2026-09-20" }, checkedBag: false };

beforeEach(() => { applyFakeEnv(); process.env.GUEST_API_KEY = KEY; mem = memoryGuestStore(); ntfy.mockClear(); });
afterEach(() => { delete process.env.GUEST_API_KEY; });

describe("/api/guests", () => {
  it("rejects a missing or wrong key", async () => {
    expect((await call("GET", undefined, "", "")).status).toBe(401);
    expect((await call("GET", undefined, "", `Bearer ${KEY}x`)).status).toBe(401);
  });
  it("500s when GUEST_API_KEY is not configured, even with a matching-looking header", async () => {
    delete process.env.GUEST_API_KEY;
    expect((await call("GET", undefined, "", "Bearer undefined")).status).toBe(500);
  });
  it("POST creates, stores, returns the page URL and pings Zach once", async () => {
    const res = await call("POST", valid);
    expect(res.status).toBe(201);
    const { guest, pageUrl } = await res.json();
    expect(pageUrl).toBe(`https://guest.example.test/arrive/${guest.token}`);
    const stored = await mem.get(guest.id);
    expect(stored?.checkedBag).toBe(false);
    expect(stored?.alertsSent).toEqual(["created"]);
    expect(ntfy).toHaveBeenCalledTimes(1);
    expect(ntfy.mock.calls[0][0].body).toContain("DL1234");
  });
  it("POST with bad fields returns every error and stores nothing", async () => {
    const res = await call("POST", { ...valid, checked_bag: true, phone: "555" });
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toHaveLength(2);
    expect(await mem.list()).toHaveLength(0);
  });
  it("GET lists guests with page URLs", async () => {
    await call("POST", valid);
    const { guests } = await (await call("GET")).json();
    expect(guests).toHaveLength(1);
    expect(guests[0].pageUrl).toContain("/arrive/");
  });
  it("PATCH updates, 404s unknown ids, rejects depart-before-arrive", async () => {
    const { guest } = await (await call("POST", valid)).json();
    const res = await call("PATCH", { checkedBag: true, doorInvited: true }, `?id=${guest.id}`);
    expect(res.status).toBe(200);
    expect((await mem.get(guest.id))?.checkedBag).toBe(true);
    expect((await call("PATCH", { checkedBag: true }, "?id=nope")).status).toBe(404);
    expect((await call("PATCH", { departDate: "2026-09-01" }, `?id=${guest.id}`)).status).toBe(400);
  });
  it("DELETE removes", async () => {
    const { guest } = await (await call("POST", valid)).json();
    expect((await call("DELETE", undefined, `?id=${guest.id}`)).status).toBe(200);
    expect(await mem.get(guest.id)).toBeNull();
  });
});
```

- [ ] **Step 7: Run them and confirm they fail**

Run: `npx vitest run tests/functions/guests.test.ts`
Expected: FAIL, cannot resolve `netlify/functions/guests`.

- [ ] **Step 8: Write `netlify/functions/guests.ts`**

```ts
import { timingSafeEqual } from "node:crypto";
import { blobGuestStore } from "../../src/server/guests/store";
import { parseCreate, parsePatch, newGuest, applyPatch } from "../../src/server/guests/validate";
import { sendNtfy } from "../../src/server/guests/ntfy";
import { siteUrl, pageUrl } from "../../src/server/guests/view";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

function authorized(req: Request, key: string): boolean {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${key}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export default async function handler(req: Request): Promise<Response> {
  const key = process.env.GUEST_API_KEY;
  if (!key) return json({ error: "GUEST_API_KEY not set" }, 500);
  if (!authorized(req, key)) return json({ error: "unauthorized" }, 401);

  const store = blobGuestStore();
  const site = siteUrl();
  const id = new URL(req.url).searchParams.get("id");

  switch (req.method) {
    case "GET": {
      const guests = await store.list();
      return json({ guests: guests.map((g) => ({ ...g, pageUrl: pageUrl(site, g) })) });
    }
    case "POST": {
      const p = parseCreate(await req.json().catch(() => undefined));
      if (!p.ok) return json({ errors: p.errors }, 400);
      const g = newGuest(p.value, new Date());
      await store.put(g);
      const url = pageUrl(site, g);
      const r = await sendNtfy({
        title: "Guest added",
        body: `${g.name}, ${g.arriveDate} to ${g.departDate}${g.flight ? `, ${g.flight.number}` : ", no flight yet"}.\n${url}`,
        click: url,
      });
      if (r.ok) { g.alertsSent.push("created"); await store.put(g); }
      else console.warn("[guests] ntfy failed:", r.error);
      return json({ guest: g, pageUrl: url }, 201);
    }
    case "PATCH": {
      if (!id) return json({ error: "id query param required" }, 400);
      const g = await store.get(id);
      if (!g) return json({ error: "not found" }, 404);
      const p = parsePatch(await req.json().catch(() => undefined));
      if (!p.ok) return json({ errors: p.errors }, 400);
      const next = applyPatch(g, p.value);
      if (next.departDate < next.arriveDate) return json({ errors: ["departDate is before arriveDate"] }, 400);
      await store.put(next);
      return json({ guest: next, pageUrl: pageUrl(site, next) });
    }
    case "DELETE": {
      if (!id) return json({ error: "id query param required" }, 400);
      if (!(await store.get(id))) return json({ error: "not found" }, 404);
      await store.remove(id);
      return json({ ok: true });
    }
    default:
      return json({ error: "method not allowed" }, 405);
  }
}

export const config = { path: "/api/guests" };
```

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/server/guests/validate.ts src/server/guests/view.ts netlify/functions/guests.ts tests/server/validate.test.ts tests/functions/guests.test.ts
git commit -m "feat(arrival): /api/guests intake with strict validation and bearer auth"
```

### Task 7: Timeline engine and the scheduled tick

**Files:**
- Modify: `src/server/guests/view.ts` (add `routeInputFor`, `isExpired`)
- Create: `src/server/guests/tick.ts`, `netlify/functions/guest-tick.ts`
- Test: `tests/server/tick.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: types, time helpers, `GuestStore`, `CounterStore`
  - Task 2: `buildRoute`
  - Task 3: `filledCopy`, `rideLinks`, `renderSms`, `renderLandedEmail`, `renderPreArrivalEmail`
  - Task 4: `FlightResult`, `airlineFromFlightNumber`
  - Task 5: `SendResult`, `NtfyMessage`, `homeFromEnv`, the senders
  - Task 6: `pageUrl`, `siteUrl`
- Produces:
  - `routeInputFor(g): RouteInput`, `isExpired(g, now): boolean`
  - `interface Alert extends NtfyMessage { key: string }`, `interface TickDeps`, `interface TickSummary`
  - `shouldPoll(g, now)`, `applySnapshot(g, result, now)`, `dueSends(g, now)`, `landedRecently(g, now)`, `timelineAlerts(g, now, site)`, `runTick(deps)`

**Rules (spec "Timeline"; all ET):**

| Rule | Behavior |
|---|---|
| Door reminder | From `arriveDate−3d 09:00` until arrival day ends, while `!doorInvited`. |
| Pre-arrival email | From `arriveDate−2d 10:00` until `arriveDate+1d 00:00`. Needs an email, and the flight must not have landed. |
| Night-before check | The first poll happens at or after `flight.date−1d 20:00`. |
| Flight polling | From `scheduledDeparture−30m`: every 10 min, or every 5 min once ETA is less than 30 min away. Stops 6h after the latest arrival estimate, or once the flight is landed, cancelled, or diverted. If there's no schedule data yet, hourly from `flight.date 05:00`. |
| Landed messages | Only if `landedAt` is under 6h old. |
| Delay alerts | One per 30-min band, at 30 min late or more. |
| Gate change | Alert only when a previously known gate changes. |
| Tracking errors | Alert at 3 consecutive failures. |
| Stale | Alert when not landed 2h past the latest estimate. |
| Visit over | Alert at `departDate+3d`. |
| Send leases | A send is written as `sending` before the provider call. A lease older than 10 min becomes failed with 3 attempts (alert, never resent). A failed send is retried until it has had 3 attempts, then alerts. |
| API cap | `AERODATABOX_MONTHLY_CAP`. When unset or 0, nothing is polled and Zach gets an alert. |

- [ ] **Step 1: Add to `src/server/guests/view.ts`**

Add these imports at the top, and append the functions:
```ts
import type { RouteInput } from "../../lib/arrival/types";
import { addDays, etDateTime, etHour } from "../../lib/arrival/time";
import { airlineFromFlightNumber } from "./flight";

export function routeInputFor(g: Guest): RouteInput {
  const t = g.tracking;
  return {
    airline: t.airline ?? airlineFromFlightNumber(g.flight?.number ?? null),
    checkedBag: g.checkedBag,
    concourse: t.concourse,
    international: t.international,
    pickup: g.pickup,
    arrivalHourET: etHour(t.landedAt ?? t.estimatedArrival ?? t.scheduledArrival),
  };
}

export function isExpired(g: Guest, now: Date): boolean {
  return now.getTime() >= etDateTime(addDays(g.departDate, 3), 0).getTime();
}
```

- [ ] **Step 2: Write the failing engine tests**

`tests/server/tick.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { runTick } from "../../src/server/guests/tick";
import { memoryGuestStore, memoryCounterStore } from "../../src/server/guests/store";
import type { FlightResult, FlightSnapshot } from "../../src/server/guests/flight";
import type { SendResult } from "../../src/server/guests/email";
import { emptyTracking, type Guest } from "../../src/lib/arrival/types";
import { makeGuest } from "../helpers/guest";
import { FAKE_HOME } from "../helpers/env";

type Email = { to: string; subject: string; html: string; text: string };
type Push = { title: string; body: string; priority?: string };

function harness(guest: Guest, o: { monthlyCap?: number; email?: () => SendResult; sms?: () => SendResult } = {}) {
  const store = memoryGuestStore([guest]);
  const counters = memoryCounterStore();
  const flights: FlightResult[] = [];
  const emails: Email[] = [], texts: { to: string; body: string }[] = [], pushes: Push[] = [];
  const fetchFlight = vi.fn(async () => flights.shift() ?? ({ ok: false, error: "no scripted response" } as FlightResult));
  const sendEmail = vi.fn(async (m: Email) => { emails.push(m); return o.email?.() ?? { ok: true as const, id: `em${emails.length}` }; });
  const sendSms = vi.fn(async (m: { to: string; body: string }) => { texts.push(m); return o.sms?.() ?? { ok: true as const, id: `sm${texts.length}` }; });
  const sendNtfy = vi.fn(async (m: Push) => { pushes.push(m); return { ok: true as const }; });
  const tick = async (iso: string) => {
    await runTick({ store, counters, fetchFlight, sendEmail, sendSms, sendNtfy, now: new Date(iso), siteUrl: "https://guest.example.test", home: FAKE_HOME, zachPhone: "+15555550100", monthlyCap: o.monthlyCap ?? 500 });
    return (await store.get(guest.id))!;
  };
  return { store, counters, flights, fetchFlight, sendEmail, sendSms, emails, texts, pushes, tick };
}

// DL1234: departs 06:00 ET (10:00Z), lands 08:25 ET (12:25Z) on 2026-09-20.
const snap = (o: Partial<FlightSnapshot> = {}): FlightResult => ({
  ok: true,
  snapshot: {
    state: "scheduled", airline: "DL", arrivalAirport: "ATL", international: false, gate: null, terminal: null, concourse: null,
    scheduledDeparture: "2026-09-20T10:00:00.000Z", scheduledArrival: "2026-09-20T12:25:00.000Z", estimatedArrival: null, landedAt: null, ...o,
  },
});
const inFlight = (o: Partial<Guest["tracking"]> = {}): Guest["tracking"] => ({
  ...emptyTracking(), state: "departed", airline: "DL", international: false,
  scheduledDeparture: "2026-09-20T10:00:00.000Z", scheduledArrival: "2026-09-20T12:25:00.000Z",
  lastCheckedAt: "2026-09-20T11:00:00.000Z", ...o,
});
const settled = { doorInvited: true, sends: { preArrival: { status: "sent" as const, at: "x", attempts: 1 } } };
const titles = (p: Push[]) => p.map((x) => x.title);

describe("runTick: the Shiner timeline end to end", () => {
  it("door reminder, pre-arrival, night-before check, polling, landed messages, exactly once each", async () => {
    const h = harness(makeGuest({ doorInvited: false }));

    await h.tick("2026-09-16T12:00:00Z");
    expect(h.pushes).toHaveLength(0);

    await h.tick("2026-09-17T13:05:00Z");
    await h.tick("2026-09-17T13:10:00Z");
    expect(titles(h.pushes)).toEqual(["Send the Door invite"]);

    await h.tick("2026-09-18T14:05:00Z");
    await h.tick("2026-09-18T14:10:00Z");
    expect(h.emails.map((e) => e.subject)).toEqual(["your atlanta landing plan (so you don't have to think)"]);
    expect(h.fetchFlight).not.toHaveBeenCalled();

    h.flights.push(snap());
    await h.tick("2026-09-20T00:05:00Z");            // 8:05pm ET night before
    await h.tick("2026-09-20T00:10:00Z");            // before departure window: no poll
    expect(h.fetchFlight).toHaveBeenCalledTimes(1);

    h.flights.push(snap({ state: "departed" }), snap({ state: "departed", gate: "T5", concourse: "T" }));
    await h.tick("2026-09-20T09:35:00Z");
    await h.tick("2026-09-20T09:40:00Z");            // 5 min later, 10-min cadence: no poll
    await h.tick("2026-09-20T09:45:00Z");
    expect(h.fetchFlight).toHaveBeenCalledTimes(3);

    h.flights.push(snap({ state: "landed", gate: "T5", concourse: "T", landedAt: "2026-09-20T11:58:00.000Z" }));
    const g = await h.tick("2026-09-20T12:00:00Z");
    expect(h.fetchFlight).toHaveBeenCalledTimes(4);
    expect(g.tracking.state).toBe("landed");

    const landed = h.emails[1];
    expect(landed.subject).toBe("you landed!! here's how to get to me");
    expect(landed.text).toContain("best case scenario");  // concourse.walk-t
    expect(landed.text).toContain("turn RIGHT toward the NORTH side");
    expect(landed.text).toContain("7Q");                  // home placeholders filled
    expect(h.texts).toHaveLength(1);
    expect(h.texts[0].body).toContain("you're in T");
    expect(h.texts[0].body).toContain(`/arrive/${g.token}`);
    const landedPush = h.pushes.find((p) => p.title === "Guest landed")!;
    expect(landedPush.body).toContain("T5");
    expect(landedPush.body).toContain("email: sent");
    expect(landedPush.body).toContain("text: sent");

    await h.tick("2026-09-20T12:05:00Z");
    expect(h.fetchFlight).toHaveBeenCalledTimes(4);
    expect(h.emails).toHaveLength(2);
    expect(h.texts).toHaveLength(1);
    expect(titles(h.pushes).filter((t) => t === "Guest landed")).toHaveLength(1);
  });
});

describe("runTick: alerts", () => {
  it("one delay alert per 30-minute band", async () => {
    const h = harness(makeGuest({ ...settled, tracking: inFlight() }));
    h.flights.push(snap({ state: "departed", estimatedArrival: "2026-09-20T13:00:00.000Z" }));
    await h.tick("2026-09-20T11:10:00Z");
    h.flights.push(snap({ state: "departed", estimatedArrival: "2026-09-20T13:15:00.000Z" }));
    await h.tick("2026-09-20T11:20:00Z");
    h.flights.push(snap({ state: "departed", estimatedArrival: "2026-09-20T13:30:00.000Z" }));
    await h.tick("2026-09-20T11:30:00Z");
    expect(h.pushes.filter((p) => p.title === "Guest flight delayed").map((p) => p.body)).toEqual([
      expect.stringContaining("35 min late"), expect.stringContaining("65 min late"),
    ]);
  });
  it("gate change alerts once, first gate assignment does not", async () => {
    const h = harness(makeGuest({ ...settled, tracking: inFlight() }));
    h.flights.push(snap({ state: "departed", gate: "B12", concourse: "B" }), snap({ state: "departed", gate: "C3", concourse: "C" }), snap({ state: "departed", gate: "C3", concourse: "C" }));
    await h.tick("2026-09-20T11:10:00Z");
    await h.tick("2026-09-20T11:20:00Z");
    await h.tick("2026-09-20T11:30:00Z");
    expect(h.pushes.filter((p) => p.title === "Guest gate change").map((p) => p.body)).toEqual([expect.stringContaining("B12 -> C3")]);
  });
  it("three tracking errors: one high-priority alert, nothing to the guest", async () => {
    const h = harness(makeGuest({ ...settled, tracking: inFlight() }));
    await h.tick("2026-09-20T11:10:00Z");
    await h.tick("2026-09-20T11:20:00Z");
    await h.tick("2026-09-20T11:30:00Z");
    await h.tick("2026-09-20T11:40:00Z");
    const fails = h.pushes.filter((p) => p.title === "Flight tracking failing");
    expect(fails).toHaveLength(1);
    expect(fails[0].priority).toBe("high");
    expect(h.emails).toHaveLength(0);
    expect(h.texts).toHaveLength(0);
  });
  it("cancelled: high alert, no sends, polling stops", async () => {
    const h = harness(makeGuest({ ...settled, tracking: inFlight() }));
    h.flights.push(snap({ state: "cancelled" }));
    await h.tick("2026-09-20T11:10:00Z");
    await h.tick("2026-09-20T11:20:00Z");
    expect(h.fetchFlight).toHaveBeenCalledTimes(1);
    expect(titles(h.pushes)).toEqual(["Guest flight cancelled"]);
    expect(h.emails).toHaveLength(0);
  });
  it("not found on the night-before check, then hourly from 5am ET", async () => {
    const h = harness(makeGuest(settled));
    h.flights.push({ ok: true, snapshot: null }, { ok: true, snapshot: null }, { ok: true, snapshot: null });
    await h.tick("2026-09-20T00:05:00Z");
    expect(titles(h.pushes)).toEqual(["Guest flight not found"]);
    await h.tick("2026-09-20T08:30:00Z");   // 4:30am ET
    await h.tick("2026-09-20T09:05:00Z");   // 5:05am ET
    await h.tick("2026-09-20T09:35:00Z");   // 30 min later
    await h.tick("2026-09-20T10:06:00Z");
    expect(h.fetchFlight).toHaveBeenCalledTimes(3);
    expect(titles(h.pushes)).toEqual(["Guest flight not found"]);
  });
  it("AeroDataBox cap: no fetch, one alert; unset cap alerts too", async () => {
    const h = harness(makeGuest({ ...settled, tracking: inFlight() }), { monthlyCap: 2 });
    await h.counters.increment("aerodatabox:2026-09");
    await h.counters.increment("aerodatabox:2026-09");
    await h.tick("2026-09-20T11:10:00Z");
    await h.tick("2026-09-20T11:20:00Z");
    expect(h.fetchFlight).not.toHaveBeenCalled();
    expect(titles(h.pushes)).toEqual(["AeroDataBox cap reached"]);
    const u = harness(makeGuest({ ...settled, tracking: inFlight() }), { monthlyCap: 0 });
    await u.tick("2026-09-20T11:10:00Z");
    expect(u.fetchFlight).not.toHaveBeenCalled();
    expect(titles(u.pushes)).toEqual(["Flight tracking is off"]);
  });
  it("timeline alerts: no email, no flight, visit over", async () => {
    const h = harness(makeGuest({ doorInvited: true, email: null, flight: null }));
    await h.tick("2026-09-20T01:00:00Z");
    expect(titles(h.pushes).sort()).toEqual(["Guest has no email", "Guest has no flight"]);
    await h.tick("2026-09-26T04:05:00Z");   // Sep 26 00:05 ET = departDate + 3d
    expect(titles(h.pushes)).toContain("Guest visit over");
  });
});

describe("runTick: landed sends", () => {
  const landedGuest = (o: Partial<Guest> = {}, t: Partial<Guest["tracking"]> = {}) =>
    makeGuest({ ...settled, ...o, tracking: inFlight({ state: "landed", gate: "B12", concourse: "B", landedAt: "2026-09-20T12:20:00.000Z", lastCheckedAt: "2026-09-20T12:20:00.000Z", ...t }) });

  it("no gate from tracking: the pick-your-concourse version, and the push says so", async () => {
    const h = harness(landedGuest({}, { gate: null, concourse: null }));
    await h.tick("2026-09-20T12:25:00Z");
    expect(h.emails[0].text).toContain("check the letter on your gate");
    expect(h.pushes.find((p) => p.title === "Guest landed")!.body).toContain("no gate");
  });
  it("unknown bag: the text covers both cases", async () => {
    const h = harness(landedGuest({ checkedBag: null }));
    await h.tick("2026-09-20T12:25:00Z");
    expect(h.texts[0].body).toContain("no bag:");
    expect(h.texts[0].body).toContain("checked bag:");
  });
  it("a landing more than 6h old sends nothing", async () => {
    const h = harness(landedGuest({}, { landedAt: "2026-09-20T05:00:00.000Z" }));
    await h.tick("2026-09-20T12:25:00Z");
    expect(h.emails).toHaveLength(0);
    expect(h.texts).toHaveLength(0);
  });
  it("sms disabled: recorded as skipped, reported, never retried", async () => {
    const h = harness(landedGuest(), { sms: () => ({ ok: false, skipped: true, reason: "sms disabled" }) });
    const g = await h.tick("2026-09-20T12:25:00Z");
    expect(g.sends.landedSms?.status).toBe("skipped");
    expect(h.pushes.find((p) => p.title === "Guest landed")!.body).toContain("text: skipped");
    await h.tick("2026-09-20T12:30:00Z");
    expect(h.texts).toHaveLength(1);
  });
  it("a failing email is tried 3 times across ticks, then alerts once", async () => {
    const h = harness(landedGuest({ phone: null }), { email: () => ({ ok: false, error: "resend 500" }) });
    for (const t of ["12:25", "12:30", "12:35", "12:40", "12:45"]) await h.tick(`2026-09-20T${t}:00Z`);
    expect(h.emails).toHaveLength(3);
    expect(titles(h.pushes).filter((t) => t === "Guest message failed")).toHaveLength(1);
  });
  it("a stuck 'sending' lease is never resent and alerts", async () => {
    const h = harness(landedGuest({ sends: { ...settled.sends, landedEmail: { status: "sending", at: "2026-09-20T12:10:00.000Z", attempts: 1 } } }));
    const g = await h.tick("2026-09-20T12:25:00Z");
    expect(h.emails).toHaveLength(0);
    expect(g.sends.landedEmail).toMatchObject({ status: "failed", attempts: 3 });
    expect(titles(h.pushes)).toContain("Guest message unclear");
    expect(h.texts).toHaveLength(1);
  });
  it("the lease is persisted before the provider is called", async () => {
    const h = harness(landedGuest({ phone: null }));
    h.sendEmail.mockImplementationOnce(async () => {
      expect((await h.store.get("testy-abc123"))!.sends.landedEmail?.status).toBe("sending");
      return { ok: true, id: "em1" };
    });
    await h.tick("2026-09-20T12:25:00Z");
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });
  it("international unknown: sends domestic steps and says it couldn't tell", async () => {
    const h = harness(landedGuest({}, { international: null }));
    await h.tick("2026-09-20T12:25:00Z");
    expect(h.pushes.find((p) => p.title === "Guest landed")!.body).toContain("couldn't tell if the flight was international");
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `npx vitest run tests/server/tick.test.ts`
Expected: FAIL, cannot resolve `tick`.

- [ ] **Step 4: Write `src/server/guests/tick.ts`**

```ts
import { SEND_KINDS, type Guest, type HomeVars, type SendKind, type SendRecord } from "../../lib/arrival/types";
import { addDays, etClock, etDateTime, etParts } from "../../lib/arrival/time";
import { buildRoute } from "../../lib/arrival/route";
import { filledCopy } from "../../lib/arrival/copy";
import { rideLinks } from "../../lib/arrival/deeplinks";
import { renderLandedEmail, renderPreArrivalEmail, renderSms } from "../../lib/arrival/render";
import type { CounterStore, GuestStore } from "./store";
import type { FlightResult } from "./flight";
import type { SendResult } from "./email";
import type { NtfyMessage } from "./ntfy";
import { isExpired, pageUrl, routeInputFor } from "./view";

const MIN = 60_000;
const HOUR = 60 * MIN;

export interface Alert extends NtfyMessage { key: string }

export interface TickDeps {
  store: GuestStore;
  counters: CounterStore;
  fetchFlight(number: string, date: string): Promise<FlightResult>;
  sendEmail(m: { to: string; subject: string; html: string; text: string }): Promise<SendResult>;
  sendSms(m: { to: string; body: string }): Promise<SendResult>;
  sendNtfy(m: NtfyMessage): Promise<{ ok: true } | { ok: false; error: string }>;
  now: Date;
  siteUrl: string;
  home: HomeVars;
  zachPhone: string | null;
  monthlyCap: number;
}

export interface TickSummary { guests: number; polled: number; sent: string[]; alerts: string[]; errors: string[] }

const FINISHED = new Set(["landed", "cancelled", "diverted"]);

export function shouldPoll(g: Guest, now: Date): boolean {
  if (!g.flight) return false;
  const t = g.tracking;
  if (FINISHED.has(t.state)) return false;
  if (now < etDateTime(addDays(g.flight.date, -1), 20)) return false;
  if (!t.lastCheckedAt) return true;
  const since = (now.getTime() - Date.parse(t.lastCheckedAt)) / MIN;
  if (t.scheduledDeparture) {
    const latest = t.estimatedArrival ?? t.scheduledArrival;
    if (latest && now.getTime() > Date.parse(latest) + 6 * HOUR) return false;
    if (now.getTime() < Date.parse(t.scheduledDeparture) - 30 * MIN) return false;
    const eta = Date.parse(latest ?? t.scheduledDeparture);
    const interval = eta - now.getTime() < 30 * MIN ? 5 : 10;
    return since >= interval - 0.5;
  }
  // No schedule yet (not found, or only errors so far): hourly from 5am ET on the flight date.
  if (now < etDateTime(g.flight.date, 5)) return false;
  return since >= 59.5;
}

export function applySnapshot(g: Guest, result: FlightResult, now: Date): { guest: Guest; alerts: Alert[] } {
  const guest = structuredClone(g);
  const t = guest.tracking;
  const alerts: Alert[] = [];
  const who = `${guest.firstName}'s ${guest.flight?.number ?? "flight"}`;
  t.lastCheckedAt = now.toISOString();

  if (!result.ok) {
    t.consecutiveErrors += 1;
    t.lastError = result.error;
    if (t.consecutiveErrors >= 3) {
      alerts.push({ key: `errors:${etParts(now).date}`, title: "Flight tracking failing", priority: "high",
        body: `${who}: ${t.consecutiveErrors} failed checks in a row (${result.error}). nothing has been sent to them.` });
    }
    return { guest, alerts };
  }
  t.consecutiveErrors = 0;
  t.lastError = null;

  const s = result.snapshot;
  if (!s) {
    alerts.push({ key: "not-found", title: "Guest flight not found", priority: "high",
      body: `AeroDataBox has no ${guest.flight?.number} on ${guest.flight?.date} into ATL. check the number and date for ${guest.name}.` });
    return { guest, alerts };
  }

  const prevGate = t.gate;
  Object.assign(t, {
    state: s.state, airline: s.airline, international: s.international, gate: s.gate, concourse: s.concourse,
    scheduledDeparture: s.scheduledDeparture, scheduledArrival: s.scheduledArrival,
    estimatedArrival: s.estimatedArrival, landedAt: s.landedAt,
  });

  if (s.scheduledArrival && s.estimatedArrival && s.state !== "landed") {
    const late = Math.round((Date.parse(s.estimatedArrival) - Date.parse(s.scheduledArrival)) / MIN);
    if (late >= 30) {
      alerts.push({ key: `delay:${Math.floor(late / 30) * 30}`, title: "Guest flight delayed",
        body: `${who} is running ${late} min late, now landing ${etClock(s.estimatedArrival)}.` });
    }
  }
  if (prevGate && s.gate && prevGate !== s.gate) {
    alerts.push({ key: `gate:${s.gate}`, title: "Guest gate change", body: `${who}: arrival gate ${prevGate} -> ${s.gate}.` });
  }
  if (s.state === "cancelled" || s.state === "diverted") {
    alerts.push({ key: `state:${s.state}`, priority: "high",
      title: s.state === "cancelled" ? "Guest flight cancelled" : "Guest flight diverted",
      body: `${who} shows ${s.state}. nothing has been sent to them.` });
  }
  return { guest, alerts };
}

export function landedRecently(g: Guest, now: Date): boolean {
  const t = g.tracking;
  return t.state === "landed" && t.landedAt !== null && now.getTime() - Date.parse(t.landedAt) < 6 * HOUR;
}

const canAttempt = (r: SendRecord | undefined) => !r || (r.status === "failed" && r.attempts < 3);

export function dueSends(g: Guest, now: Date): SendKind[] {
  const out: SendKind[] = [];
  const preWindow = now >= etDateTime(addDays(g.arriveDate, -2), 10) && now < etDateTime(addDays(g.arriveDate, 1), 0);
  if (g.email && preWindow && g.tracking.state !== "landed" && canAttempt(g.sends.preArrival)) out.push("preArrival");
  if (landedRecently(g, now)) {
    if (g.email && canAttempt(g.sends.landedEmail)) out.push("landedEmail");
    if (g.phone && canAttempt(g.sends.landedSms)) out.push("landedSms");
  }
  return out;
}

export function timelineAlerts(g: Guest, now: Date, site: string): Alert[] {
  const a: Alert[] = [];
  const t = g.tracking;
  const url = pageUrl(site, g);
  if (!g.doorInvited && now >= etDateTime(addDays(g.arriveDate, -3), 9) && now < etDateTime(addDays(g.arriveDate, 1), 0)) {
    a.push({ key: "door-reminder", title: "Send the Door invite",
      body: `${g.firstName} arrives ${g.arriveDate} and doesn't have a Door invite yet. once it's sent, PATCH doorInvited: true.` });
  }
  if (!g.email && now >= etDateTime(addDays(g.arriveDate, -2), 10)) {
    a.push({ key: "no-email", title: "Guest has no email", body: `no email for ${g.name}, so no pre-arrival or landed email. their page still works: ${url}` });
  }
  if (!g.flight && now >= etDateTime(addDays(g.arriveDate, -1), 20)) {
    a.push({ key: "no-flight", title: "Guest has no flight", body: `no flight number for ${g.name}, so no landed messages. their page still works: ${url}` });
  }
  const latest = t.estimatedArrival ?? t.scheduledArrival;
  if (latest && (t.state === "scheduled" || t.state === "departed" || t.state === "unknown") && now.getTime() > Date.parse(latest) + 2 * HOUR) {
    a.push({ key: "stale", title: "Guest flight status stale", priority: "high",
      body: `${g.firstName}'s ${g.flight?.number} should have landed by ${etClock(latest)} but tracking never saw it land. nothing was sent to them.` });
  }
  if (isExpired(g, now)) {
    a.push({ key: "expired", title: "Guest visit over", body: `${g.name}'s visit is over and the page link is dead. run: cd ~/zachs-place && npm run archive-guests` });
  }
  return a;
}

async function deliver(kind: SendKind, g: Guest, d: TickDeps): Promise<SendResult> {
  try {
    const url = pageUrl(d.siteUrl, g);
    if (kind === "preArrival") {
      const m = renderPreArrivalEmail({
        firstName: g.firstName, arriveDate: g.arriveDate, flightNumber: g.flight?.number ?? null,
        checkedBag: g.checkedBag, pickup: g.pickup, pageUrl: url, address: d.home.address, zachPhone: d.zachPhone,
      });
      return await d.sendEmail({ to: g.email!, ...m });
    }
    const input = routeInputFor(g);
    const steps = buildRoute(input);
    if (kind === "landedSms") return await d.sendSms({ to: g.phone!, body: renderSms(steps, input.pickup, input.concourse, url) });
    const m = renderLandedEmail({
      firstName: g.firstName, steps, input, copy: filledCopy(d.home), pageUrl: url, links: rideLinks(d.home), zachPhone: d.zachPhone,
    });
    return await d.sendEmail({ to: g.email!, ...m });
  } catch (e) {
    return { ok: false, error: `render/send threw: ${(e as Error).message}` };
  }
}

export async function runTick(d: TickDeps): Promise<TickSummary> {
  const summary: TickSummary = { guests: 0, polled: 0, sent: [], alerts: [], errors: [] };
  const monthKey = `aerodatabox:${etParts(d.now).date.slice(0, 7)}`;
  const guests = await d.store.list();
  summary.guests = guests.length;

  for (const original of guests) {
    try {
      let g = original;
      const alerts: Alert[] = [];

      if (shouldPoll(g, d.now)) {
        const used = await d.counters.get(monthKey);
        if (d.monthlyCap <= 0) {
          alerts.push({ key: "cap-unset", title: "Flight tracking is off", priority: "high",
            body: `AERODATABOX_MONTHLY_CAP isn't set, so ${g.firstName}'s flight isn't being tracked and nothing will send at landing.` });
        } else if (used >= d.monthlyCap) {
          alerts.push({ key: `cap:${monthKey}`, title: "AeroDataBox cap reached", priority: "high",
            body: `${used}/${d.monthlyCap} calls this month. tracking is paused, nothing will send at landing. raise AERODATABOX_MONTHLY_CAP if the plan allows.` });
        } else {
          const result = await d.fetchFlight(g.flight!.number, g.flight!.date);
          const n = await d.counters.increment(monthKey);
          if (n >= Math.ceil(d.monthlyCap * 0.8)) {
            alerts.push({ key: `cap80:${monthKey}`, title: "AeroDataBox 80% used", body: `${n}/${d.monthlyCap} calls this month.` });
          }
          const applied = applySnapshot(g, result, d.now);
          g = applied.guest;
          alerts.push(...applied.alerts);
          summary.polled++;
        }
      }

      for (const kind of SEND_KINDS) {
        const r = g.sends[kind];
        if (r?.status === "sending" && d.now.getTime() - Date.parse(r.at) > 10 * MIN) {
          g.sends[kind] = { ...r, status: "failed", attempts: 3, detail: "lease expired mid-send; may or may not have gone out" };
          alerts.push({ key: `stuck:${kind}`, title: "Guest message unclear", priority: "high",
            body: `the ${kind} message to ${g.firstName} may or may not have gone out (a tick died mid-send). check the Resend/Twilio logs. it won't be retried.` });
        }
      }

      alerts.push(...timelineAlerts(g, d.now, d.siteUrl));

      const sentNow: SendKind[] = [];
      for (const kind of dueSends(g, d.now)) {
        const attempts = (g.sends[kind]?.attempts ?? 0) + 1;
        g.sends[kind] = { status: "sending", at: d.now.toISOString(), attempts };
        await d.store.put(g); // the lease is durable before the provider call
        const r = await deliver(kind, g, d);
        const at = d.now.toISOString();
        if (r.ok) {
          g.sends[kind] = { status: "sent", at, attempts, detail: r.id };
          sentNow.push(kind);
          summary.sent.push(`${g.id}:${kind}`);
        } else if (r.skipped) {
          g.sends[kind] = { status: "skipped", at, attempts, detail: r.reason };
        } else {
          g.sends[kind] = { status: "failed", at, attempts, detail: r.error };
          if (attempts >= 3) {
            alerts.push({ key: `failed:${kind}`, title: "Guest message failed", priority: "high",
              body: `the ${kind} message to ${g.firstName} failed 3 times: ${r.error}` });
          }
        }
        await d.store.put(g);
      }

      if (sentNow.includes("preArrival")) {
        alerts.push({ key: "pre-arrival-sent", title: "Pre-arrival email sent", body: `${g.firstName}'s pre-arrival email went out.\n${pageUrl(d.siteUrl, g)}` });
      }

      const t = g.tracking;
      const landedKinds = (["landedEmail", "landedSms"] as const).filter((k) => (k === "landedEmail" ? g.email : g.phone));
      if (landedRecently(g, d.now) && landedKinds.every((k) => g.sends[k])) {
        const status = (k: SendKind) => (g.sends[k]!.status === "skipped" ? "skipped (sms off)" : g.sends[k]!.status);
        const gate = t.gate ? ` at ${t.gate}` : " (no gate from tracking, so they got the pick-your-concourse version)";
        const intl = t.international === null ? " couldn't tell if the flight was international, sent domestic steps." : "";
        alerts.push({ key: "landed", title: "Guest landed",
          body: `${g.firstName} landed${gate}. email: ${g.email ? status("landedEmail") : "no email"}. text: ${g.phone ? status("landedSms") : "no phone"}.${intl}` });
      }

      for (const a of alerts) {
        if (g.alertsSent.includes(a.key)) continue;
        const { key, ...msg } = a;
        const r = await d.sendNtfy(msg);
        if (r.ok) { g.alertsSent.push(key); summary.alerts.push(`${g.id}:${key}`); }
        else summary.errors.push(`${g.id}: ntfy ${key}: ${r.error}`);
      }
      await d.store.put(g);
    } catch (e) {
      summary.errors.push(`${original.id}: ${(e as Error).message}`);
    }
  }
  return summary;
}
```

- [ ] **Step 5: Run the engine tests and confirm they pass**

Run: `npx vitest run tests/server/tick.test.ts`
Expected: PASS (16 tests). If a timing test fails, check the ET conversion of the timestamp in the test comment before touching the rule. The rules table above is the source of truth.

- [ ] **Step 6: Mutation-check the no-guess guards**

Each temporary edit must make a test FAIL. Revert each edit by hand after checking:
1. In `dueSends`, delete `landedRecently(g, now)` and use `g.tracking.state === "landed"`. Expected failure: "a landing more than 6h old sends nothing".
2. In `runTick`, move the first `await d.store.put(g);` (the lease) to after `deliver`. Expected failure: "the lease is persisted before the provider is called".
3. In `canAttempt`, change `r.attempts < 3` to `r.attempts < 4`. Expected failure: "a failing email is tried 3 times".

- [ ] **Step 7: Write `netlify/functions/guest-tick.ts`**

```ts
import { runTick } from "../../src/server/guests/tick";
import { blobGuestStore, blobCounterStore } from "../../src/server/guests/store";
import { fetchFlight } from "../../src/server/guests/flight";
import { sendEmail } from "../../src/server/guests/email";
import { sendSms } from "../../src/server/guests/sms";
import { sendNtfy } from "../../src/server/guests/ntfy";
import { homeFromEnv } from "../../src/server/guests/home";
import { siteUrl } from "../../src/server/guests/view";
import { etParts } from "../../src/lib/arrival/time";

export default async function handler(): Promise<Response> {
  const now = new Date();
  const counters = blobCounterStore();
  const home = homeFromEnv();
  if (!home.ok) {
    const key = `alert:home-config:${etParts(now).date}`;
    if ((await counters.get(key)) === 0) {
      const r = await sendNtfy({ title: "Guest system misconfigured", priority: "high", body: `${home.error}. guest-tick does nothing until it's fixed.` });
      if (r.ok) await counters.increment(key);
    }
    console.error("[guest-tick]", home.error);
    return new Response(home.error, { status: 500 });
  }
  const cap = Number(process.env.AERODATABOX_MONTHLY_CAP);
  const summary = await runTick({
    store: blobGuestStore(), counters, fetchFlight, sendEmail, sendSms, sendNtfy, now,
    siteUrl: siteUrl(), home: home.home, zachPhone: process.env.ZACH_PHONE ?? null,
    monthlyCap: Number.isFinite(cap) && cap > 0 ? cap : 0,
  });
  console.log("[guest-tick]", JSON.stringify(summary));
  return Response.json(summary);
}

export const config = { schedule: "*/5 * * * *" };
```

- [ ] **Step 8: Run the full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add src/server/guests/view.ts src/server/guests/tick.ts netlify/functions/guest-tick.ts tests/server/tick.test.ts
git commit -m "feat(arrival): timeline engine with send leases, alert dedupe, and 5-min scheduled tick"
```

### Task 8: Arrival page and `/api/arrive`

**Files:**
- Modify: `src/server/guests/view.ts` (add `pageModel`)
- Create: `netlify/functions/arrive.ts`, `src/lib/arrival/page.ts`, `src/pages/arrive/index.astro`, `src/scripts/arrive.ts`
- Modify: `netlify.toml`, `public/sw.js`, `src/layouts/BaseLayout.astro`
- Test: `tests/functions/arrive.test.ts`, `tests/lib/arrival/page.test.ts`

**Interfaces:**
- Consumes: `findByToken`, `blobGuestStore` (Task 1); `buildRoute` (Task 2); `groupSteps`, `BRANCH_LABEL`, `filledCopy`, `rideLinks` (Task 3); `homeFromEnv` (Task 5); `routeInputFor`, `isExpired` (Task 7); `etClock` (Task 1).
- Produces:
  - `pageModel(g, home, zachPhone): PageModel`
  - `GET /api/arrive?token=` → 200 `PageModel` / 404 / 410 / 500
  - `tokenFromPath(path)`, `statusLine(flight)`, `shouldRefresh(flight)`
  - The page at `/arrive/<token>`

**Privacy notes:**
- **Tokens leak through links.** The token is in the URL, so the page sends `Referrer-Policy: no-referrer`. Otherwise tapping the Lyft/Uber link would pass the token to them.
- **The response is an allowlist.** It carries no email, phone, full name, sends, or alerts.
- **Private values only reach a valid token holder.** The page bundle contains templates only; the filled copy comes from the API.

- [ ] **Step 1: Write the failing page-helper tests**

`tests/lib/arrival/page.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { tokenFromPath, statusLine, shouldRefresh } from "../../../src/lib/arrival/page";

const f = (o: Record<string, unknown> = {}) => ({ number: "DL1234", state: "scheduled", gate: null, scheduledArrival: "2026-09-20T12:25:00.000Z", estimatedArrival: null, landedAt: null, ...o }) as never;

describe("tokenFromPath", () => {
  it("accepts /arrive/<token> with or without trailing slash, rejects everything else", () => {
    const t = "A".repeat(43);
    expect(tokenFromPath(`/arrive/${t}`)).toBe(t);
    expect(tokenFromPath(`/arrive/${t}/`)).toBe(t);
    expect(tokenFromPath("/arrive/")).toBeNull();
    expect(tokenFromPath("/arrive/short")).toBeNull();
    expect(tokenFromPath(`/arrive/${t}/extra`)).toBeNull();
  });
});

describe("statusLine", () => {
  it("speaks each state in Zach's voice with ATL time", () => {
    expect(statusLine(null)).toBe("");
    expect(statusLine(f({ state: "idle" }))).toContain("night before");
    expect(statusLine(f())).toBe("DL1234 is on schedule, landing 8:25am atlanta time.");
    expect(statusLine(f({ estimatedArrival: "2026-09-20T13:10:00.000Z" }))).toBe("DL1234 is running late, now landing 9:10am atlanta time.");
    expect(statusLine(f({ state: "departed", estimatedArrival: "2026-09-20T12:30:00.000Z" }))).toBe("DL1234 is in the air, landing about 8:30am atlanta time.");
    expect(statusLine(f({ state: "landed", gate: "B12" }))).toBe("you landed at B12!! steps below.");
    expect(statusLine(f({ state: "landed" }))).toBe("you landed!! steps below.");
    expect(statusLine(f({ state: "cancelled" }))).toContain("call zach");
    expect(statusLine(f({ state: "diverted" }))).toContain("call zach");
  });
});

describe("shouldRefresh", () => {
  it("refreshes only while the flight can still change", () => {
    expect(shouldRefresh(null)).toBe(false);
    for (const state of ["idle", "scheduled", "departed", "unknown"]) expect(shouldRefresh(f({ state }))).toBe(true);
    for (const state of ["landed", "cancelled", "diverted"]) expect(shouldRefresh(f({ state }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run tests/lib/arrival/page.test.ts`
Expected: FAIL, cannot resolve `page`.

- [ ] **Step 3: Write `src/lib/arrival/page.ts`**

```ts
import type { PageModel } from "./types";
import { etClock } from "./time";

type Flight = PageModel["flight"];

export function tokenFromPath(path: string): string | null {
  const m = path.match(/^\/arrive\/([A-Za-z0-9_-]{20,})\/?$/);
  return m ? m[1] : null;
}

export function statusLine(flight: Flight): string {
  if (!flight) return "";
  const n = flight.number;
  const when = flight.estimatedArrival ?? flight.scheduledArrival;
  const at = when ? `${etClock(when)} atlanta time` : null;
  switch (flight.state) {
    case "idle": return `${n}: i'll start tracking it the night before.`;
    case "scheduled": {
      const late = flight.estimatedArrival && flight.scheduledArrival
        && Date.parse(flight.estimatedArrival) - Date.parse(flight.scheduledArrival) >= 15 * 60_000;
      if (late) return `${n} is running late, now landing ${at}.`;
      return at ? `${n} is on schedule, landing ${at}.` : `${n} is on schedule.`;
    }
    case "departed": return at ? `${n} is in the air, landing about ${at}.` : `${n} is in the air.`;
    case "landed": return `you landed${flight.gate ? ` at ${flight.gate}` : ""}!! steps below.`;
    case "cancelled": return `${n} shows cancelled. call zach.`;
    case "diverted": return `${n} got diverted. call zach.`;
    default: return `${n}: no live status right now.`;
  }
}

export function shouldRefresh(flight: Flight): boolean {
  return !!flight && ["idle", "scheduled", "departed", "unknown"].includes(flight.state);
}
```

- [ ] **Step 4: Run the helper tests and confirm they pass**

Run: `npx vitest run tests/lib/arrival/page.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add `pageModel` to `src/server/guests/view.ts`**

Add these imports and append the function:
```ts
import type { HomeVars, PageModel } from "../../lib/arrival/types";
import { filledCopy } from "../../lib/arrival/copy";
import { rideLinks } from "../../lib/arrival/deeplinks";

export function pageModel(g: Guest, home: HomeVars, zachPhone: string | null): PageModel {
  const t = g.tracking;
  return {
    firstName: g.firstName,
    arriveDate: g.arriveDate,
    flight: g.flight
      ? { number: g.flight.number, state: t.state, gate: t.gate, scheduledArrival: t.scheduledArrival, estimatedArrival: t.estimatedArrival, landedAt: t.landedAt }
      : null,
    route: routeInputFor(g),
    copy: filledCopy(home),
    links: rideLinks(home),
    address: home.address,
    zachPhone,
  };
}
```

- [ ] **Step 6: Write the failing endpoint tests**

`tests/functions/arrive.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryGuestStore, type GuestStore } from "../../src/server/guests/store";
import { makeGuest } from "../helpers/guest";
import { applyFakeEnv } from "../helpers/env";

let mem: GuestStore;
vi.mock("../../src/server/guests/store", async (orig) => ({
  ...(await orig<typeof import("../../src/server/guests/store")>()),
  blobGuestStore: () => mem,
}));

const TOKEN = "T".repeat(43);
const get = async (token: string) => {
  const { default: handler } = await import("../../netlify/functions/arrive");
  return handler(new Request(`https://guest.example.test/api/arrive?token=${token}`));
};

beforeEach(() => {
  applyFakeEnv();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
  mem = memoryGuestStore([makeGuest({ token: TOKEN, checkedBag: null, tracking: { ...makeGuest().tracking, state: "departed", gate: "B12", concourse: "B", airline: "DL", international: false } })]);
});
afterEach(() => { vi.useRealTimers(); });

describe("/api/arrive", () => {
  it("404s unknown tokens and sets no-store/noindex", async () => {
    const res = await get("nope".repeat(10));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
  });
  it("410s after departDate + 3 days", async () => {
    vi.setSystemTime(new Date("2026-09-26T05:00:00Z"));
    expect((await get(TOKEN)).status).toBe(410);
  });
  it("returns exactly the page model: no email, phone, full name, token, sends or alerts", async () => {
    const res = await get(TOKEN);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["address", "arriveDate", "copy", "firstName", "flight", "links", "route", "zachPhone"]);
    const raw = JSON.stringify(body);
    for (const secret of ["testy@example.test", "+15555550111", "Testy McTest", TOKEN]) expect(raw).not.toContain(secret);
    expect(body.route).toEqual({ airline: "DL", checkedBag: null, concourse: "B", international: false, pickup: "rideshare", arrivalHourET: null });
    expect(body.copy["building.door"]).toContain("7Q");
    expect(body.flight).toMatchObject({ number: "DL1234", state: "departed", gate: "B12" });
  });
  it("500s without leaking which HOME var is missing", async () => {
    delete process.env.HOME_UNIT;
    const res = await get(TOKEN);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("HOME_UNIT");
  });
});
```

- [ ] **Step 7: Run them and confirm they fail**

Run: `npx vitest run tests/functions/arrive.test.ts`
Expected: FAIL, cannot resolve `netlify/functions/arrive`.

- [ ] **Step 8: Write `netlify/functions/arrive.ts`**

```ts
import { blobGuestStore, findByToken } from "../../src/server/guests/store";
import { homeFromEnv } from "../../src/server/guests/home";
import { isExpired, pageModel } from "../../src/server/guests/view";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: HEADERS });

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const g = await findByToken(blobGuestStore(), token);
  if (!g) return json({ error: "not found" }, 404);
  if (isExpired(g, new Date())) return json({ error: "expired" }, 410);
  const home = homeFromEnv();
  if (!home.ok) {
    console.error("[arrive]", home.error);
    return json({ error: "misconfigured" }, 500);
  }
  return json(pageModel(g, home.home, process.env.ZACH_PHONE ?? null));
}

export const config = { path: "/api/arrive" };
```

- [ ] **Step 9: Run the endpoint tests and confirm they pass**

Run: `npx vitest run tests/functions/arrive.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 10: Add `noindex` to `src/layouts/BaseLayout.astro`**

Change the props and head:
```astro
---
import "../styles/global.css";

interface Props {
  title?: string;
  noindex?: boolean;
}
const { title = "Zach's Place", noindex = false } = Astro.props;
---
```
and add this directly after `<title>{title}</title>`:
```astro
    {noindex && <meta name="robots" content="noindex, nofollow" />}
    {noindex && <meta name="referrer" content="no-referrer" />}
```

- [ ] **Step 11: Write `src/pages/arrive/index.astro`**

```astro
---
import BaseLayout from "../../layouts/BaseLayout.astro";
---
<BaseLayout title="Getting to Zach's" noindex>
  <main class="arrive">
    <p id="loading" class="muted">one sec...</p>

    <section id="gone" class="hero" hidden>
      <h1 id="gone-title"></h1>
      <p id="gone-text" class="muted"></p>
    </section>

    <div id="page" hidden>
      <section class="hero">
        <h1 id="hello"></h1>
        <p id="status" class="status"></p>
      </section>

      <section id="where" class="card" aria-label="Where are you?">
        <h2 class="section-title">where are you?</h2>
        <p class="muted">tap the letter on your gate.</p>
        <div id="picker" class="picker" role="group" aria-label="Concourse"></div>
      </section>

      <div id="steps"></div>

      <section id="ride" class="card" hidden>
        <h2 class="section-title">get a ride</h2>
        <div class="buttons">
          <a id="lyft" class="btn primary" rel="noreferrer">open lyft</a>
          <a id="uber" class="btn" rel="noreferrer">open uber</a>
        </div>
        <button id="copy" class="btn ghost" type="button">copy my address</button>
        <p id="address" class="muted"></p>
      </section>

      <section class="card buttons">
        <a id="call" class="btn" hidden>call zach</a>
        <a href="/guest" class="btn ghost">house manual</a>
      </section>
    </div>
  </main>
</BaseLayout>

<style is:global>
  .arrive { max-width: 560px; margin: 0 auto; padding: var(--space-6) var(--space-4) var(--space-10); color: var(--text-primary); font-family: var(--font-sans); }
  .arrive [hidden] { display: none !important; }
  .arrive .hero h1 { font-size: 2rem; margin: 0 0 var(--space-2); }
  .arrive .status { color: var(--accent-warm); margin: 0; font-size: 1.05rem; }
  .arrive .muted { color: var(--text-secondary); }
  .arrive .card { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-card); padding: var(--space-5); margin-top: var(--space-5); }
  .arrive .section-title { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); margin: 0 0 var(--space-3); }
  .arrive .picker { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .arrive .picker button { min-width: 44px; min-height: 44px; border-radius: var(--radius-chip); border: 1px solid var(--border-subtle); background: var(--bg-tile); color: var(--text-primary); font-size: 1rem; font-weight: 600; }
  .arrive .picker button[aria-pressed="true"] { background: var(--bg-tile-active); border-color: var(--border-active); color: var(--accent-warm); }
  .arrive .step-list { margin: 0; padding-left: 1.4em; }
  .arrive .step-list li { margin: 0 0 var(--space-3); line-height: 1.5; }
  .arrive .step-list li.branch { list-style: none; margin-left: -1.4em; font-weight: 700; color: var(--accent-warm); }
  .arrive .buttons { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .arrive .btn { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 var(--space-5); border-radius: var(--radius-chip); background: var(--bg-tile); color: var(--text-primary); border: 1px solid var(--border-subtle); text-decoration: none; font-weight: 600; font-size: 1rem; }
  .arrive .btn.primary { background: var(--accent-warm); color: var(--bg-base); border-color: transparent; }
  .arrive .btn.ghost { background: transparent; }
  .arrive #copy { margin-top: var(--space-3); }
</style>

<script>
  import "../../scripts/arrive";
</script>
```

- [ ] **Step 12: Write `src/scripts/arrive.ts`**

```ts
import { buildRoute } from "../lib/arrival/route";
import { groupSteps } from "../lib/arrival/render";
import { BRANCH_LABEL } from "../lib/arrival/copy";
import { CONCOURSES, type Concourse, type PageModel } from "../lib/arrival/types";
import { shouldRefresh, statusLine, tokenFromPath } from "../lib/arrival/page";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const token = tokenFromPath(location.pathname);
const CACHE_KEY = token ? `arrive:${token}` : "";
let model: PageModel | null = null;
let override: Concourse | null | undefined; // undefined = trust tracking

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function gone(title: string, text: string) {
  $("loading").hidden = true;
  $("page").hidden = true;
  $("gone").hidden = false;
  $("gone-title").textContent = title;
  $("gone-text").textContent = text;
}

function renderSteps() {
  if (!model) return;
  const concourse = override !== undefined ? override : model.route.concourse;
  const input = { ...model.route, concourse };
  const root = $("steps");
  root.replaceChildren();
  for (const g of groupSteps(buildRoute(input), input.pickup, concourse, model.copy)) {
    const card = el("section", "card");
    card.append(el("h2", "section-title", g.title));
    const list = el("ol", "step-list");
    let last: string | undefined;
    for (const item of g.items) {
      if (item.branch && item.branch !== last) list.append(el("li", "branch", BRANCH_LABEL[item.branch]));
      last = item.branch;
      list.append(el("li", undefined, item.text));
    }
    card.append(list);
    root.append(card);
  }
  $("where").hidden = input.international === true;
  for (const b of $("picker").querySelectorAll("button")) {
    b.setAttribute("aria-pressed", String((b.dataset.c || null) === concourse));
  }
}

function paint() {
  const m = model!;
  $("loading").hidden = true;
  $("gone").hidden = true;
  $("page").hidden = false;
  $("hello").textContent = `welcome, ${m.firstName}.`;
  $("status").textContent = statusLine(m.flight);
  const ride = m.route.pickup === "rideshare";
  $("ride").hidden = !ride;
  if (ride) {
    $<HTMLAnchorElement>("lyft").href = m.links.lyft;
    $<HTMLAnchorElement>("uber").href = m.links.uber;
    $("address").textContent = m.address;
  }
  const call = $<HTMLAnchorElement>("call");
  call.hidden = !m.zachPhone;
  if (m.zachPhone) call.href = `tel:${m.zachPhone}`;
  renderSteps();
}

async function load(first: boolean) {
  if (!token) return gone("this link doesn't look right", "text zach for a fresh link.");
  let res: Response;
  try {
    res = await fetch(`/api/arrive?token=${encodeURIComponent(token)}`, { cache: "no-store" });
  } catch {
    if (first && !model) return gone("no signal right now", "your steps load once you're back online. or just call zach.");
    return;
  }
  if (res.status === 404) return gone("this link doesn't work", "text zach for a fresh one.");
  if (res.status === 410) { try { localStorage.removeItem(CACHE_KEY); } catch {} return gone("this visit's over", "hope it was a good one!!"); }
  if (!res.ok) { if (first && !model) gone("something broke", "call zach, ringer's on."); return; }
  model = (await res.json()) as PageModel;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(model)); } catch {}
  paint();
}

// Picker
for (const c of [...CONCOURSES, null] as (Concourse | null)[]) {
  const b = el("button", undefined, c ?? "not sure");
  b.type = "button";
  b.dataset.c = c ?? "";
  b.addEventListener("click", () => { override = c; renderSteps(); });
  $("picker").append(b);
}

// Copy address
$("copy").addEventListener("click", async () => {
  if (!model) return;
  const btn = $("copy");
  try { await navigator.clipboard.writeText(model.address); btn.textContent = "copied!"; }
  catch { btn.textContent = "long-press the address below to copy"; }
});

// Airports have bad signal: paint the last good copy first, then refresh.
try {
  const cached = CACHE_KEY && localStorage.getItem(CACHE_KEY);
  if (cached) { model = JSON.parse(cached) as PageModel; paint(); }
} catch {}
void load(true);
setInterval(() => {
  if (document.visibilityState === "visible" && model && shouldRefresh(model.flight)) void load(false);
}, 60_000);
```

- [ ] **Step 13: Route `/arrive/*`, bypass the service worker, and set headers**

Append to `netlify.toml`:
```toml
[[redirects]]
  from = "/arrive/*"
  to = "/arrive/index.html"
  status = 200

[[headers]]
  for = "/arrive/*"
  [headers.values]
    X-Robots-Tag = "noindex, nofollow"
    Referrer-Policy = "no-referrer"
    Cache-Control = "no-cache"
```

In `public/sw.js`, directly under the `/api/` line in the fetch handler, add:
```js
  // Arrival pages: network-only, never cache a guest's page shell under their token URL.
  if (url.pathname.startsWith("/arrive")) return;
```

- [ ] **Step 14: Build and run the suite**

Run: `npm test && npm run build && ls dist/arrive/index.html`
Expected: tests PASS, the build succeeds, and the file exists.

Run: `grep -rlE "7Q|100 Test Ave|testy@example" dist || echo "no test fixtures in dist"`
Expected: `no test fixtures in dist`. (The real-values leak check is in Task 10, and it reads the values from env at check time.)

- [ ] **Step 15: Run it locally and look at it**

Create a local `.env`. It's gitignored; confirm with `git check-ignore .env`, which should print `.env`. Use the FAKE values from `tests/helpers/env.ts` plus `GUEST_API_KEY=dev-local-key`.

Run `npx netlify dev` in the background. Then:
```bash
curl -s -X POST localhost:8888/api/guests -H "authorization: Bearer dev-local-key" -H "content-type: application/json" \
  -d '{"name":"Local Test","arriveDate":"2026-09-20","departDate":"2026-09-23","flight":{"number":"DL1234","date":"2026-09-20"},"checkedBag":null}'
```
Expected: 201 with a `pageUrl`. NTFY_TOPIC is unset, so the log shows `ntfy failed` and the request still succeeds.

Open `http://localhost:8888/arrive/<token>` in Chrome at 400px wide. Check each of these:
1. "welcome, Local." appears and the status line reads as tracking not started yet.
2. With no concourse, the first step is the check-your-gate-letter text.
3. Tapping **B** changes step 1 to "you're in B" and highlights B.
4. Step 2 shows both the "if you didn't check a bag" and "if you checked a bag" branches. The bag branch says LEFT/SOUTH and then the Rideshare signs to NORTH.
5. Lyft and Uber buttons have hrefs, and copy-address works.
6. `/arrive/garbage` shows "this link doesn't look right".

Take a screenshot of steps 3–4 for Zach. Stop netlify dev. Delete the local test guest:
```bash
curl -s -X DELETE "localhost:8888/api/guests?id=<id>" -H "authorization: Bearer dev-local-key"
```

- [ ] **Step 16: Commit**

```bash
git add src/server/guests/view.ts netlify/functions/arrive.ts src/lib/arrival/page.ts src/pages/arrive/index.astro src/scripts/arrive.ts netlify.toml public/sw.js src/layouts/BaseLayout.astro tests/functions/arrive.test.ts tests/lib/arrival/page.test.ts
git commit -m "feat(arrival): private arrival page with concourse picker and /api/arrive"
```

### Task 9: Archive tool and README

**Files:**
- Create: `tools/archive-guests.mjs`
- Modify: `package.json` (script `archive-guests`), `README.md`

**Interfaces:**
- Consumes: `GET /api/guests` and `DELETE /api/guests?id=` (Task 6).
- Produces: `npm run archive-guests [-- --dry-run]` and the operator docs.

- [ ] **Step 1: Write `tools/archive-guests.mjs`**

```js
#!/usr/bin/env node
// Saves finished visits (departDate + 3 days has passed, ET) to guests/archive/ and
// deletes them from the live store. guests/ is gitignored: this repo is public, and
// these files hold friends' names, emails and phones. They stay on this Mac only.
//
// Usage: GUEST_API_KEY=... npm run archive-guests [-- --dry-run]
import { mkdir, writeFile } from "node:fs/promises";

const SITE = (process.env.SITE_URL ?? "https://guest.xbyz.fun").replace(/\/$/, "");
const KEY = process.env.GUEST_API_KEY;
const DRY = process.argv.includes("--dry-run");
if (!KEY) { console.error("GUEST_API_KEY not set. Try: GUEST_API_KEY=$(npx netlify env:get GUEST_API_KEY) npm run archive-guests"); process.exit(1); }

const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const addDays = (date, n) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const headers = { Authorization: `Bearer ${KEY}` };

const res = await fetch(`${SITE}/api/guests`, { headers });
if (!res.ok) { console.error(`GET /api/guests failed: ${res.status}`); process.exit(1); }
const { guests } = await res.json();
const done = guests.filter((g) => addDays(g.departDate, 3) <= todayET);
if (done.length === 0) { console.log(`nothing to archive (${guests.length} active)`); process.exit(0); }

await mkdir("guests/archive", { recursive: true });
for (const g of done) {
  const { token, pageUrl, ...record } = g; // the token is dead after expiry anyway; don't keep it
  const file = `guests/archive/${g.departDate}-${g.id}.json`;
  if (DRY) { console.log(`would archive ${file}`); continue; }
  await writeFile(file, JSON.stringify(record, null, 2) + "\n");
  const del = await fetch(`${SITE}/api/guests?id=${encodeURIComponent(g.id)}`, { method: "DELETE", headers });
  if (!del.ok) { console.error(`wrote ${file} but DELETE failed (${del.status}); it's still live`); process.exitCode = 1; continue; }
  console.log(`archived ${file}`);
}
```

- [ ] **Step 2: Add the npm script**

In `package.json` `scripts`, add: `"archive-guests": "node tools/archive-guests.mjs"`.

Run: `git check-ignore guests/archive/x.json`
Expected: prints `guests/archive/x.json`. `guests/` was added to `.gitignore` with the spec commit. If it prints nothing, add `guests/` to `.gitignore` in this commit.

- [ ] **Step 3: Add a "Guest arrival" section to `README.md`**

Append this section. Keep it free of private values; name the env vars only.

````markdown
## Guest arrival

Friends flying into ATL get a pre-arrival email, then a text + email the moment they land with
directions from their concourse, and a private page at `guest.xbyz.fun/arrive/<token>`.
Spec: `docs/superpowers/specs/2026-09-12-guest-arrival-design.md`.

**This repo is public.** Home address, unit, floor, coordinates and phone live only in Netlify env.
Copy in `src/lib/arrival/copy.ts` uses `{placeholders}`. Guest data never goes in git.

### Adding a guest (Muse or Claude Code)

```bash
curl -X POST https://guest.xbyz.fun/api/guests \
  -H "Authorization: Bearer $GUEST_API_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Full Name","firstName":"What Zach calls them","email":"them@example.com","phone":"+14045550100",
       "arriveDate":"2026-10-01","departDate":"2026-10-04","flight":{"number":"DL1234","date":"2026-10-01"},
       "checkedBag":null,"pickup":"rideshare","doorInvited":false}'
```

- `checkedBag`: `true`/`false`/`null`. Leave it `null` until you know; the messages cover both cases.
- `flight.date` is the departure date on their ticket.
- Unknown fields are rejected on purpose.
- Update: `PATCH /api/guests?id=<id>` with any subset (e.g. `{"doorInvited":true}`). Changing `flight` restarts tracking.
- List: `GET /api/guests`. Remove: `DELETE /api/guests?id=<id>`.

### What happens (all times ET)

- **Added:** ntfy with the page link.
- **3 days out:** ntfy reminder if the Door invite isn't marked sent.
- **2 days out, 10am:** pre-arrival email.
- **Night before, 8pm:** first flight check.
- **From 30 min before departure:** checks every 10 min (5 min near landing). Alerts on delays, gate changes, cancellations, and diversions.
- **Landed:** text + email to the guest, ntfy to Zach.
- **Anything uncertain:** nothing goes to the guest, and Zach gets an ntfy.

### Env (zachs-place site)

| Var | Notes |
|---|---|
| `GUEST_API_KEY` | Bearer key for `/api/guests`. Muse keeps a copy in its vault. |
| `HOME_ADDRESS`, `HOME_LAT`, `HOME_LNG`, `HOME_STREET`, `HOME_CROSS_STREET`, `HOME_UNIT`, `HOME_UNIT_LETTER`, `HOME_FLOOR` | Private. Filled into copy on the server only. |
| `ZACH_PHONE`, `ZACH_REPLY_TO` | Call button and email reply-to. |
| `RESEND_API_KEY`, `GUEST_EMAIL_FROM` | **Second copy** of the xbyz Resend key. |
| `AERODATABOX_API_KEY` | **Second copy** of the xbyz key. |
| `AERODATABOX_MONTHLY_CAP` | Calls allowed per month from this site. Unset or 0 = tracking off. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | **Second copy** of the xbyz Twilio creds. |
| `GUEST_SMS_ENABLED` | Must be exactly `true` to send texts. Leave unset until carrier registration is approved. |
| `NTFY_TOPIC` | Zach's guest alerts topic. |
| `SITE_URL` | `https://guest.xbyz.fun` |

**Rotating a key:** the Resend, AeroDataBox and Twilio keys live in BOTH xbyz-app (Netlify + `.env.local` + GitHub Actions where used) AND here. Update both, or this site silently stops sending.

### After a visit

`GUEST_API_KEY=$(npx netlify env:get GUEST_API_KEY) npm run archive-guests` saves ended visits to
gitignored `guests/archive/` on this Mac and deletes them from the live store.
````

- [ ] **Step 4: Commit**

```bash
git add tools/archive-guests.mjs package.json README.md
git commit -m "docs(arrival): archive tool, API contract, env and rotation notes"
```

---

### Task 10: Ship, verify on production, rehearse

This task spends real money and publishes to production. Every step marked **GATE** waits for Zach. Never put real private values in any file in this repo, including this plan.

**Files:** none, unless the rehearsal finds a bug. A bug gets fixed test-first in the task that owns the code, then this task resumes.

- [ ] **Step 1: Check which domains Resend can send from (read-only, free)**

This has to run from a shell linked to the xbyz-app Netlify site. Run `npx netlify status` first and confirm the site name. Don't echo the key.
```bash
cd ~/xbyz-platform/xbyz-app && npx netlify status | grep -i "site\|project"
RK=$(npx netlify env:get RESEND_API_KEY) && curl -s https://api.resend.com/domains -H "Authorization: Bearer $RK" | python3 -c 'import sys,json; [print(d["name"], d["status"]) for d in json.load(sys.stdin).get("data",[])]'
```
Expected: a list of domains and their statuses. Pick `GUEST_EMAIL_FROM`: `Zach <zach@xbyz.fun>` if `xbyz.fun` is verified, otherwise a verified xbyzexperience.com address. Tell Zach which one and why.

- [ ] **Step 2: GATE: set the AeroDataBox cap**

Ask Zach for the plan's monthly call quota from the api.market dashboard. Read xbyz's recent usage from Firebase `usage/aerodatabox/<YYYY-MM>` for the last 3 months. Propose `AERODATABOX_MONTHLY_CAP = quota − (highest xbyz month × 1.5)`, with a floor of 0, and state the number. If the result is under ~60 (about two guest flights), say so plainly, and don't start tracking until Zach decides.

- [ ] **Step 3: GATE: ntfy topic**

Generate `zach-guests-$(openssl rand -hex 6)`. Zach subscribes to it in the ntfy app. Send one test and read it back:
```bash
curl -s -d "guest alerts test" -H "Title: Guest system test" https://ntfy.sh/<topic>
curl -s "https://ntfy.sh/<topic>/json?poll=1&since=5m"
```
Zach confirms the push arrived on his phone. A 200 alone proves nothing.

- [ ] **Step 4: GATE: set production env on the zachs-place site**

From `~/zachs-place`, run `npx netlify status` and confirm the zachs-place site. Set each var with `npx netlify env:set <NAME> <value>`:
- `GUEST_API_KEY` = `openssl rand -base64 32` (generate it in a shell var and don't print it)
- `HOME_*`: Zach confirms each value in chat first. Geocode the address with OpenStreetMap Nominatim (free) and confirm the result names Zach's building; street, cross street, unit, unit letter and floor come from the Shiner text.
- `ZACH_PHONE`: same value as xbyz `ZACH_PHONE_NUMBER`. `ZACH_REPLY_TO`: Zach's personal Gmail (confirm the address).
- `RESEND_API_KEY`, `AERODATABOX_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`: copied from xbyz-app with `env:get` piped straight into `env:set`, never printed.
- `GUEST_EMAIL_FROM` (Step 1), `AERODATABOX_MONTHLY_CAP` (Step 2), `NTFY_TOPIC` (Step 3), `SITE_URL=https://guest.xbyz.fun`.
- Leave `GUEST_SMS_ENABLED` **unset**.

Verify by name only: `npx netlify env:list --json | python3 -c 'import sys,json; print(sorted(json.load(sys.stdin).keys()))'`

- [ ] **Step 5: Check the bundle for real private values**

The public manual already contains the street and unit, so check only what this feature ships (`dist/arrive` and the JS assets):
```bash
cd ~/zachs-place && npm run build
for v in HOME_ADDRESS HOME_LAT HOME_LNG HOME_CROSS_STREET HOME_UNIT ZACH_PHONE; do
  val=$(npx netlify env:get $v); [ -n "$val" ] || { echo "EMPTY $v"; continue; }
  if grep -rqF -- "$val" dist/arrive dist/assets 2>/dev/null; then echo "LEAK $v"; else echo "clean $v"; fi
done
```
Expected: `clean` for every var. A `LEAK` stops shipping. Find the source and move it behind the API.

- [ ] **Step 6: GATE: push, open the PR, and merge**

Ask Zach before pushing. Then:
```bash
git push -u origin feat/guest-arrival
gh pr create --title "Guest arrival: pre-arrival + landed messages, flight tracking, arrival page" --body "<summary + test plan>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
Merge only on Zach's go-ahead. `main` auto-deploys.

- [ ] **Step 7: Verify production (the served artifact, not the deploy exit code)**

```bash
curl -sI https://guest.xbyz.fun/arrive/$(openssl rand -hex 24) | grep -iE "^HTTP|x-robots-tag|referrer-policy"
curl -s -o /dev/null -w "%{http_code}\n" "https://guest.xbyz.fun/api/arrive?token=$(openssl rand -hex 24)"
curl -s -o /dev/null -w "%{http_code}\n" https://guest.xbyz.fun/api/guests
curl -s -o /dev/null -w "%{http_code}\n" https://guest.xbyz.fun/guest
```
Expected:
- `/arrive/<random>`: 200, with `noindex` and `no-referrer` headers.
- `/api/arrive` with a random token: `404`.
- `/api/guests` with no key: `401`.
- `/guest`: `200` (the existing manual is unharmed).

Then confirm `guest-tick` is really running. In the Netlify dashboard, open Functions → guest-tick → logs. Within 10 minutes there should be `[guest-tick] {"guests":0,...}` lines five minutes apart. A deployed function that never logs is not running.

- [ ] **Step 8: GATE: rehearsal with a real flight (costs about 15–40 AeroDataBox calls)**

Tell Zach the call estimate and wait for a yes. Zach picks a real flight landing at ATL in 2–4 hours (from FlightAware). Create a guest that is really Zach:
```bash
GK=$(npx netlify env:get GUEST_API_KEY)
curl -s -X POST https://guest.xbyz.fun/api/guests -H "Authorization: Bearer $GK" -H "Content-Type: application/json" \
  -d '{"name":"Rehearsal Run","firstName":"Zach","email":"<zach personal gmail>","phone":null,"arriveDate":"<today>","departDate":"<today>","flight":{"number":"<XX1234>","date":"<today>"},"checkedBag":null,"doorInvited":true}'
```
Watch and check each of these on the real surfaces:
1. The "Guest added" push arrives on Zach's phone.
2. Within about 5 min the pre-arrival email lands in Gmail. Read the delivered email, not the logs: the address is filled in, there are no `{placeholders}`, the page link works, and the sender and reply-to are right.
3. `GET /api/guests` shows `tracking` populated from the real AeroDataBox response: state, times, and after the gate is known, `gate` and `concourse`. If the gate/terminal format doesn't map to a concourse, add a failing test for that exact shape in `tests/server/flight.test.ts`, fix `concourseFrom`, and redeploy.
4. On Zach's iPhone, open the page. Tap **open lyft** and **open uber**: each should open the app with the home address as destination. If Lyft doesn't prefill, try `lyft://ridetype?id=lyft&destination[latitude]=..&destination[longitude]=..` as the href. Update `lyftUrl` and its test, redeploy, and retest.
5. At landing: the landed email arrives with the real concourse's steps and the "Guest landed" push arrives. SMS shows "skipped (sms off)".
6. Delete the rehearsal guest: `curl -s -X DELETE "https://guest.xbyz.fun/api/guests?id=<id>" -H "Authorization: Bearer $GK"`.

- [ ] **Step 9: Hand Muse the contract**

Give Zach the Muse prompt: the API contract from the README, plus "store GUEST_API_KEY in your vault". Zach copies the key himself with `! cd ~/zachs-place && npx netlify env:get GUEST_API_KEY | pbcopy` and pastes it into Muse's vault page. The key never passes through chat.

- [ ] **Step 10: GATE: Twilio carrier registration (a separate decision)**

Read the current 10DLC sole-proprietor and toll-free verification fees from the Twilio console, then ask Zach in one sentence which route and whether to spend it. After approval and carrier approval: set `GUEST_SMS_ENABLED=true`, rehearse by PATCHing a test guest's phone to Zach's number on a real landing, and confirm the text on his phone.

- [ ] **Step 11: Update memory**

Update `~/.claude/projects/-Users-zachstrohmeyer/memory/project-guest-portal.md` with what's live, the PR number, the rehearsal result, and whether SMS is on.
