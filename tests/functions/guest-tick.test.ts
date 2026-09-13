import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyFakeEnv } from "../helpers/env";

// Simulate a Netlify Blobs outage: store construction throws before any tick work happens.
vi.mock("../../src/server/guests/store", async (orig) => ({
  ...(await orig<typeof import("../../src/server/guests/store")>()),
  blobGuestStore: () => { throw new Error("blobs unreachable: guests store"); },
  blobCounterStore: () => { throw new Error("blobs unreachable: counters store"); },
}));
const ntfy = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }));
vi.mock("../../src/server/guests/ntfy", () => ({ sendNtfy: (m: unknown) => ntfy(m) }));

beforeEach(() => { applyFakeEnv(); ntfy.mockClear(); });
afterEach(() => { vi.resetModules(); });

describe("guest-tick: Blobs outage", () => {
  it("a thrown store error is caught, alerts Zach at high priority, and returns 500 (not silence)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: handler } = await import("../../netlify/functions/guest-tick");
    const res = await handler();
    expect(res.status).toBe(500);
    expect(ntfy).toHaveBeenCalledTimes(1);
    expect(ntfy.mock.calls[0][0]).toMatchObject({ title: "guest-tick crashed", priority: "high" });
    expect(typeof ntfy.mock.calls[0][0].body).toBe("string");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
