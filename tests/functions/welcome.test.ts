import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryGuestStore, type GuestStore } from "../../src/server/guests/store";
import { makeGuest } from "../helpers/guest";

let mem: GuestStore;
vi.mock("../../src/server/guests/store", async (orig) => ({
  ...(await orig<typeof import("../../src/server/guests/store")>()),
  blobGuestStore: () => mem,
}));

const call = async (method = "GET") => {
  const { default: handler } = await import("../../netlify/functions/welcome");
  return handler(new Request("https://guest.example.test/api/welcome", { method }));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-21T16:00:00Z"));
  mem = memoryGuestStore([
    makeGuest(),
    makeGuest({ id: "gone", token: "g".repeat(43), firstName: "Gone", name: "Gone Person", arriveDate: "2026-09-01", departDate: "2026-09-03" }),
  ]);
});
afterEach(() => { vi.useRealTimers(); });

describe("/api/welcome", () => {
  it("answers with only the first names of guests staying today", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ names: ["Testy"] });
    const raw = JSON.stringify(body);
    for (const secret of ["McTest", "testy@example.test", "+15555550111", "tok_", "DL1234", "Gone"]) expect(raw).not.toContain(secret);
  });

  it("answers an empty list when nobody is staying", async () => {
    vi.setSystemTime(new Date("2026-10-15T16:00:00Z"));
    expect(await (await call()).json()).toEqual({ names: [] });
  });

  it("falls back to an empty list when the store fails", async () => {
    mem = { ...mem, list: async () => { throw new Error("blobs down"); } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ names: [] });
    spy.mockRestore();
  });

  it("refuses anything but GET", async () => {
    expect((await call("POST")).status).toBe(405);
  });
});
