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
  it("returns 500 when store fails, without leaking error details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mem = {
      get: async () => { throw new Error("blob secret detail"); },
      put: async () => { throw new Error("blob secret detail"); },
      list: async () => { throw new Error("blob secret detail"); },
      remove: async () => { throw new Error("blob secret detail"); },
    };
    const res = await call("GET");
    expect(res.status).toBe(500);
    const bodyText = await res.text();
    expect(bodyText).not.toContain("blob secret detail");
    expect(JSON.parse(bodyText)).toEqual({ error: "internal error" });
    spy.mockRestore();
  });
});
