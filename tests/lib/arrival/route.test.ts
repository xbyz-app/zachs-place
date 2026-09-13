import { describe, it, expect } from "vitest";
import { buildRoute, type Step } from "../../../src/lib/arrival/route";
import { CONCOURSES, type RouteInput, type Concourse } from "../../../src/lib/arrival/types";

const base: RouteInput = { airline: "DL", checkedBag: false, concourse: "T", international: false, pickup: "rideshare", arrivalHourET: 6 };
const ids = (s: Step[]) => s.map((x) => (x.branch ? `${x.id}#${x.branch}` : x.id));

describe("buildRoute: exact routes for canonical cases", () => {
  it("Shiner: Delta, no bag, T, 6am, rideshare", () => {
    expect(ids(buildRoute(base))).toEqual([
      "concourse.walk-t", "escalator.north",
      "ride.north-deck", "ride.call", "ride.time-quiet",
      "building.dropoff", "building.door", "building.elevator", "building.hall", "building.room", "close.asleep",
    ]);
  });
  it("Delta with a checked bag in B at 2pm: LEFT to south claim, then over to north", () => {
    expect(ids(buildRoute({ ...base, checkedBag: true, concourse: "B", arrivalHourET: 14 }))).toEqual([
      "concourse.train", "escalator.south-claim", "escalator.to-north",
      "ride.north-deck", "ride.call", "ride.time-normal",
      "building.dropoff", "building.door", "building.elevator", "building.hall", "building.room", "close.awake",
    ]);
  });
  it("Southwest with a bag: claim is already on the north side, no crossing step", () => {
    expect(ids(buildRoute({ ...base, airline: "WN", checkedBag: true, concourse: "C" })).slice(0, 3))
      .toEqual(["concourse.train", "escalator.north-claim", "ride.north-deck"]);
  });
  it("unknown bag: both branches, labeled, no-bag first", () => {
    expect(ids(buildRoute({ ...base, checkedBag: null, concourse: "A" })).slice(0, 4))
      .toEqual(["concourse.train", "escalator.north#no-bag", "escalator.south-claim#bag", "escalator.to-north#bag"]);
  });
  it("international: customs in F, no escalator group, international curb and call", () => {
    expect(ids(buildRoute({ ...base, international: true, concourse: "F", checkedBag: true })).slice(0, 4))
      .toEqual(["concourse.international", "ride.international-curb", "ride.call-international", "ride.time-quiet"]);
  });
  it("Zach picking up a Delta guest: south side, curb, no building steps", () => {
    expect(ids(buildRoute({ ...base, pickup: "zach", concourse: "D" })))
      .toEqual(["concourse.train", "escalator.south-side", "meet.curb", "close.see-you"]);
  });
});

describe("buildRoute: unlisted-airline routing (not DL, not in NORTH_AIRLINES)", () => {
  const group2 = (input: RouteInput) => buildRoute(input).filter((s) => s.group === 2).map((s) => s.id);
  it("XP + checked bag + rideshare, domestic concourse B: unlisted claim then cross to north", () => {
    expect(group2({ ...base, airline: "XP", checkedBag: true, concourse: "B" })).toEqual(["escalator.unlisted-claim", "escalator.to-north"]);
  });
  it("unknown airline (null) + checked bag: same unlisted routing as XP", () => {
    expect(group2({ ...base, airline: null, checkedBag: true, concourse: "B" })).toEqual(["escalator.unlisted-claim", "escalator.to-north"]);
  });
  it("XP + zach pickup: unlisted side, no claim/cross steps", () => {
    expect(group2({ ...base, airline: "XP", pickup: "zach", concourse: "B" })).toEqual(["escalator.unlisted-side"]);
  });
});

describe("buildRoute: invariants over every combination", () => {
  const airlines = ["DL", "AA", "WN", "XP", null];
  const bags = [true, false, null];
  const concourses: (Concourse | null)[] = [...CONCOURSES, null];
  const intls = [true, false, null];
  const pickups = ["rideshare", "zach"] as const;
  const hours = [0, 6, 7, 14, 20, 23, null];
  const all: RouteInput[] = [];
  for (const airline of airlines) for (const checkedBag of bags) for (const concourse of concourses)
    for (const international of intls) for (const pickup of pickups) for (const arrivalHourET of hours)
      all.push({ airline, checkedBag, concourse, international, pickup, arrivalHourET });

  it("exactly one group-1 step, groups never go backwards, ends with a close step", () => {
    for (const input of all) {
      const r = buildRoute(input);
      expect(r.filter((s) => s.group === 1)).toHaveLength(1);
      for (let i = 1; i < r.length; i++) expect(r[i].group).toBeGreaterThanOrEqual(r[i - 1].group);
      expect(r[r.length - 1].id.startsWith("close.")).toBe(true);
    }
  });
  it("group 1 is decided by international, then concourse", () => {
    for (const input of all) {
      const first = buildRoute(input)[0].id;
      if (input.international === true) expect(first).toBe("concourse.international");
      else if (input.concourse === "T") expect(first).toBe("concourse.walk-t");
      else if (input.concourse === null) expect(first).toBe("concourse.unknown");
      else expect(first).toBe("concourse.train");
    }
  });
  it("international routes have no escalator steps; domestic routes always do", () => {
    for (const input of all) {
      const esc = buildRoute(input).filter((s) => s.id.startsWith("escalator."));
      if (input.international === true) expect(esc).toHaveLength(0);
      else expect(esc.length).toBeGreaterThan(0);
    }
  });
  it("a known bag answer never produces branches; unknown bag + rideshare + domestic always does", () => {
    for (const input of all) {
      const r = buildRoute(input);
      const branched = r.some((s) => s.branch);
      if (input.checkedBag !== null || input.pickup === "zach" || input.international === true) expect(branched).toBe(false);
      else {
        expect(r.some((s) => s.branch === "no-bag")).toBe(true);
        expect(r.some((s) => s.branch === "bag")).toBe(true);
      }
    }
  });
  it("rideshare with checkedBag === false never visits a claim; with true never uses the no-bag step", () => {
    for (const input of all) {
      if (input.pickup !== "rideshare" || input.international === true) continue;
      const r = ids(buildRoute(input));
      if (input.checkedBag === false) expect(r.filter((x) => x.includes("claim"))).toEqual([]);
      if (input.checkedBag === true) expect(r).not.toContain("escalator.north");
    }
  });
  it("Delta + bag (rideshare, domestic) always goes south then crosses north; nobody else goes south", () => {
    for (const input of all) {
      if (input.pickup !== "rideshare" || input.international === true) continue;
      const r = ids(buildRoute(input));
      const south = r.some((x) => x.startsWith("escalator.south"));
      const delta = input.airline === "DL";
      if (delta && input.checkedBag === true) {
        expect(r.indexOf("escalator.south-claim")).toBeLessThan(r.indexOf("escalator.to-north"));
      }
      if (!delta) expect(south).toBe(false);
    }
  });
  it("zach pickup never includes rideshare or building steps", () => {
    for (const input of all.filter((i) => i.pickup === "zach")) {
      const r = ids(buildRoute(input));
      expect(r.some((x) => x.startsWith("ride.") || x.startsWith("building."))).toBe(false);
      expect(r[r.length - 1]).toBe("close.see-you");
    }
  });
  it("quiet drive time is before 7am or from 8pm; unknown hour is normal; asleep is 11pm-8am; unknown hour is 'either'", () => {
    const at = (h: number | null) => ids(buildRoute({ ...base, arrivalHourET: h }));
    expect(at(6)).toContain("ride.time-quiet");
    expect(at(7)).toContain("ride.time-normal");
    expect(at(20)).toContain("ride.time-quiet");
    expect(at(null)).toContain("ride.time-normal");
    expect(at(23)).toContain("close.asleep");
    expect(at(7)).toContain("close.asleep");
    expect(at(8)).toContain("close.awake");
    expect(at(null)).toContain("close.either");
  });
});
