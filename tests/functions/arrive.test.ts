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
  it("500s when the store throws, without leaking error details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mem = {
      get: async () => { throw new Error("blob secret detail"); },
      put: async () => { throw new Error("blob secret detail"); },
      list: async () => { throw new Error("blob secret detail"); },
      remove: async () => { throw new Error("blob secret detail"); },
    };
    const res = await get(TOKEN);
    expect(res.status).toBe(500);
    const bodyText = await res.text();
    expect(bodyText).not.toContain("blob secret detail");
    expect(JSON.parse(bodyText)).toEqual({ error: "internal error" });
    spy.mockRestore();
  });
});
