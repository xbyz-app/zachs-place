import { describe, it, expect } from "vitest";
import { buildRoute } from "../../../src/lib/arrival/route";
import { filledCopy } from "../../../src/lib/arrival/copy";
import { rideLinks } from "../../../src/lib/arrival/deeplinks";
import { groupSteps, renderSms, renderLandedEmail, renderPreArrivalEmail } from "../../../src/lib/arrival/render";
import { CONCOURSES, type RouteInput, type Concourse } from "../../../src/lib/arrival/types";
import { FAKE_HOME } from "../../helpers/env";

const copy = filledCopy(FAKE_HOME);
const links = rideLinks(FAKE_HOME);
const url = "https://guest.example.test/arrive/" + "x".repeat(43); // realistic length
const base: RouteInput = { airline: "DL", checkedBag: false, concourse: "B", international: false, pickup: "rideshare", arrivalHourET: 6 };

describe("groupSteps", () => {
  it("groups consecutive steps, fills {concourse}, keeps branch labels", () => {
    const input = { ...base, checkedBag: null };
    const g = groupSteps(buildRoute(input), input.pickup, input.concourse, copy);
    expect(g.map((x) => x.group)).toEqual([1, 2, 3, 4]);
    expect(g[0].items[0].text).toContain("you're in B");
    expect(g[1].items.map((i) => i.branch)).toEqual(["no-bag", "bag", "bag"]);
  });
  it("throws loudly if a step has no copy", () => {
    expect(() => groupSteps(buildRoute(base), "rideshare", "B", {})).toThrow(/no copy/);
  });
});

describe("renderSms", () => {
  it("stays short and ASCII for every combination", () => {
    for (const airline of ["DL", "WN", null]) for (const checkedBag of [true, false, null])
      for (const concourse of [...CONCOURSES, null] as (Concourse | null)[]) for (const international of [true, false])
        for (const pickup of ["rideshare", "zach"] as const) {
          const input: RouteInput = { airline, checkedBag, concourse, international, pickup, arrivalHourET: 6 };
          const s = renderSms(buildRoute(input), pickup, concourse, url);
          expect(s.length, s).toBeLessThanOrEqual(360);
          expect(s, s).toMatch(/^[\x20-\x7E]+$/);
          expect(s.endsWith(url)).toBe(true);
        }
  });
  it("Delta + bag: LEFT comes before the crossing to NORTH", () => {
    const s = renderSms(buildRoute({ ...base, checkedBag: true }), "rideshare", "B", url);
    expect(s.indexOf("LEFT")).toBeGreaterThan(-1);
    expect(s.indexOf("LEFT")).toBeLessThan(s.indexOf("NORTH side"));
  });
  it("unknown bag says both, never picks one", () => {
    const s = renderSms(buildRoute({ ...base, checkedBag: null }), "rideshare", "B", url);
    expect(s).toContain("no bag:");
    expect(s).toContain("checked bag:");
  });
  it("mentions the lyft button only for rideshare", () => {
    expect(renderSms(buildRoute(base), "rideshare", "B", url)).toContain("lyft button");
    expect(renderSms(buildRoute({ ...base, pickup: "zach" }), "zach", "B", url)).not.toContain("lyft");
  });
});

describe("renderLandedEmail", () => {
  const args = { firstName: "<b>Testy</b>", steps: buildRoute(base), input: base, copy, pageUrl: url, links, zachPhone: "+15555550100" };
  it("escapes the name and fills private values from copy", () => {
    const m = renderLandedEmail(args);
    expect(m.html).toContain("&lt;b&gt;Testy&lt;/b&gt;");
    expect(m.html).toContain("7Q");
    expect(m.html).not.toMatch(/\{(unit|street|floor|concourse)\}/);
    expect(m.text).toContain("7Q");
  });
  it("rideshare has lyft + uber buttons with escaped hrefs; zach pickup has none", () => {
    const m = renderLandedEmail(args);
    expect(m.html).toContain("open lyft");
    expect(m.html).toContain(links.lyft.replaceAll("&", "&amp;"));
    const input = { ...base, pickup: "zach" as const };
    const z = renderLandedEmail({ ...args, input, steps: buildRoute(input) });
    expect(z.html).not.toContain("open lyft");
  });
  it("text and html carry every step, in order", () => {
    const m = renderLandedEmail(args);
    const groups = groupSteps(args.steps, "rideshare", "B", copy);
    let last = -1;
    for (const item of groups.flatMap((g) => g.items)) {
      const i = m.text.indexOf(item.text);
      expect(i, item.text).toBeGreaterThan(last);
      last = i;
    }
  });
});

describe("renderPreArrivalEmail", () => {
  const args = { firstName: "Testy", arriveDate: "2026-09-20", flightNumber: "DL1234", checkedBag: false as boolean | null, pickup: "rideshare" as const, pageUrl: url, address: FAKE_HOME.address, zachPhone: "+15555550100" };
  it("rideshare: address, lyft, Door, page link, the date", () => {
    const m = renderPreArrivalEmail(args);
    for (const s of [FAKE_HOME.address, "lyft", "Door", url, "sep 20", "DL1234"]) expect(m.text).toContain(s);
  });
  it("zach pickup: no lyft pitch", () => {
    const m = renderPreArrivalEmail({ ...args, pickup: "zach" });
    expect(m.text).toContain("picking you up");
    expect(m.text).not.toContain("lyft");
  });
  it("asks about the bag only when unknown", () => {
    expect(renderPreArrivalEmail({ ...args, checkedBag: null }).text).toContain("checking a bag");
    expect(renderPreArrivalEmail(args).text).not.toContain("checking a bag");
  });
});
