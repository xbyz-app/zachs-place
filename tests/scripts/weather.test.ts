import { describe, it, expect } from "vitest";
import { dayName, range } from "../../src/scripts/weather";

describe("dayName", () => {
  it("says Today and Tomorrow, then the weekday", () => {
    expect(dayName("2026-11-07", 0)).toBe("Today");
    expect(dayName("2026-11-08", 1)).toBe("Tomorrow");
    expect(dayName("2026-11-09", 2)).toBe("Monday");
  });
});

describe("range", () => {
  it("shows high and low, or whichever is known", () => {
    expect(range({ date: "", label: "", high: 65, low: 49 })).toBe("65° / 49°");
    expect(range({ date: "", label: "", high: 65, low: null })).toBe("High 65°");
    expect(range({ date: "", label: "", high: null, low: null })).toBe("");
  });
});
