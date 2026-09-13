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
