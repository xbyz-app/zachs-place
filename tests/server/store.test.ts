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
