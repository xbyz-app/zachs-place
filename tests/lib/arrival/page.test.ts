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
