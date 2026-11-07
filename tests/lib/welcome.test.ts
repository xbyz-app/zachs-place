import { describe, it, expect } from "vitest";
import { greeting, stayingNames } from "../../src/lib/welcome";

const g = (firstName: string, arriveDate: string, departDate: string) => ({ firstName, arriveDate, departDate });

describe("stayingNames", () => {
  const guests = [g("Shiner", "2026-11-06", "2026-11-09")];

  it("covers arrival day through departure day, inclusive", () => {
    expect(stayingNames(guests, new Date("2026-11-05T23:00:00Z"))).toEqual([]); // 6 pm ET on the 5th
    expect(stayingNames(guests, new Date("2026-11-06T05:30:00Z"))).toEqual(["Shiner"]); // 12:30 am ET on the 6th
    expect(stayingNames(guests, new Date("2026-11-10T04:30:00Z"))).toEqual(["Shiner"]); // 11:30 pm ET on the 9th
    expect(stayingNames(guests, new Date("2026-11-10T05:30:00Z"))).toEqual([]); // 12:30 am ET on the 10th
  });

  it("reads the date in Atlanta, not UTC", () => {
    // 02:00 UTC on the 6th is still the evening of the 5th in Atlanta.
    expect(stayingNames(guests, new Date("2026-11-06T02:00:00Z"))).toEqual([]);
  });

  it("lists overlapping stays earliest arrival first, without repeats or blanks", () => {
    const many = [g("Alex", "2026-11-07", "2026-11-08"), g("Sam", "2026-11-06", "2026-11-08"), g("sam", "2026-11-07", "2026-11-07"), g(" ", "2026-11-07", "2026-11-07"), g("Old", "2026-10-01", "2026-10-03")];
    expect(stayingNames(many, new Date("2026-11-07T17:00:00Z"))).toEqual(["Sam", "Alex"]);
  });
});

describe("greeting", () => {
  it("joins names the way a person would", () => {
    expect(greeting([])).toBeNull();
    expect(greeting(["Shiner"])).toBe("Welcome, Shiner.");
    expect(greeting(["Sam", "Alex"])).toBe("Welcome, Sam and Alex.");
    expect(greeting(["A", "B", "C"])).toBe("Welcome, A, B and C.");
  });
});
