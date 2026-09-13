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
      alertsSent: ["created", "door-reminder", "delay:30", "gate:B12", "landed", "landed-late"],
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
