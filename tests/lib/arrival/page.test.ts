import { describe, it, expect } from "vitest";
import type { PageModel } from "../../../src/lib/arrival/types";
import { tokenFromPath, statusLine, shouldRefresh, showDeparture, departureLine } from "../../../src/lib/arrival/page";

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

describe("flight home", () => {
  const dep = (o: Partial<NonNullable<PageModel["departure"]>> = {}): PageModel["departure"] => ({
    number: "DL88", date: "2026-09-23", state: "scheduled", destination: "BOS", gate: "B12",
    scheduledDeparture: "2026-09-23T22:10:00.000Z", estimatedDeparture: null, departedAt: null, ...o,
  });
  it("shows from the day before the flight, Atlanta time", () => {
    expect(showDeparture(dep(), new Date("2026-09-22T03:00:00Z"))).toBe(false); // 11pm ET on the 21st
    expect(showDeparture(dep(), new Date("2026-09-22T04:30:00Z"))).toBe(true);  // 12:30am ET on the 22nd
    expect(showDeparture(null, new Date("2026-09-23T12:00:00Z"))).toBe(false);
  });
  it("reads like zach", () => {
    expect(departureLine(dep())).toBe("DL88 to BOS leaves 6:10pm from B12, on time.");
    expect(departureLine(dep({ estimatedDeparture: "2026-09-23T22:55:00.000Z" }))).toBe("DL88 to BOS is running late, now leaving 6:55pm from B12.");
    expect(departureLine(dep({ state: "boarding" }))).toBe("DL88 to BOS is boarding at B12!! go go go.");
    expect(departureLine(dep({ state: "departed" }))).toBe("DL88 took off. safe flight!!");
    expect(departureLine(dep({ state: "cancelled" }))).toBe("DL88 shows cancelled. call zach.");
    expect(departureLine(dep({ state: "idle", gate: null, scheduledDeparture: null }))).toBe("DL88 to BOS: i'll start tracking it the night before.");
    expect(departureLine(dep({ gate: null, destination: null }))).toBe("DL88 leaves 6:10pm, on time.");
  });
  it("keeps refreshing while the flight home is live, stops once it's gone", () => {
    const now = new Date("2026-09-23T20:00:00Z");
    expect(shouldRefresh(null, dep(), now)).toBe(true);
    expect(shouldRefresh(null, dep({ state: "boarding" }), now)).toBe(true);
    expect(shouldRefresh(null, dep({ state: "departed" }), now)).toBe(false);
    expect(shouldRefresh(null, dep(), new Date("2026-09-20T20:00:00Z"))).toBe(false); // not shown yet
  });
});
