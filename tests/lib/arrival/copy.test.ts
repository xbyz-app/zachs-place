import { describe, it, expect } from "vitest";
import { STEP_COPY, SMS_COPY, SMS_STEP_IDS, fillTemplate, filledCopy } from "../../../src/lib/arrival/copy";
import { STEP_IDS } from "../../../src/lib/arrival/route";
import { FAKE_HOME } from "../../helpers/env";

describe("copy", () => {
  it("every step id has non-empty page copy", () => {
    for (const id of STEP_IDS) expect(STEP_COPY[id]?.trim().length, id).toBeGreaterThan(20);
  });
  it("every group-1, group-2 and meet step has SMS copy, printable ASCII only", () => {
    for (const id of SMS_STEP_IDS) {
      expect(SMS_COPY[id], id).toBeTruthy();
      expect(SMS_COPY[id]!, id).toMatch(/^[\x20-\x7E]+$/);
    }
    expect(SMS_STEP_IDS).toEqual(STEP_IDS.filter((id) => /^(concourse|escalator|meet)\./.test(id)));
  });
  it("directions are true: north steps say RIGHT + NORTH, south steps say LEFT + SOUTH, unlisted name neither side", () => {
    for (const table of [STEP_COPY, SMS_COPY]) {
      for (const id of ["escalator.north", "escalator.north-claim", "escalator.north-side"] as const) {
        expect(table[id], id).toContain("RIGHT"); expect(table[id], id).toContain("NORTH"); expect(table[id], id).not.toContain("LEFT");
      }
      for (const id of ["escalator.south-claim", "escalator.south-side"] as const) {
        expect(table[id], id).toContain("LEFT"); expect(table[id], id).toContain("SOUTH"); expect(table[id], id).not.toContain("RIGHT");
      }
      for (const id of ["escalator.unlisted-claim", "escalator.unlisted-side"] as const) {
        expect(table[id], id).not.toMatch(/LEFT|RIGHT|NORTH|SOUTH/);
      }
      expect(table["escalator.to-north"]).toContain("NORTH");
    }
  });
  it("building copy is templated, never hardcoded", () => {
    const building = Object.entries(STEP_COPY).filter(([id]) => id.startsWith("building.")).map(([, t]) => t).join(" ");
    for (const ph of ["{street}", "{crossStreet}", "{unit}", "{unitLetter}", "{floor}"]) expect(building).toContain(ph);
    for (const t of Object.values(SMS_COPY)) expect(t).not.toMatch(/\{(street|crossStreet|unit|unitLetter|floor|address)\}/);
  });
  it("fillTemplate fills known vars and leaves unknown placeholders alone", () => {
    expect(fillTemplate("in {unit} on {concourse}", { unit: "7Q" })).toBe("in 7Q on {concourse}");
  });
  it("filledCopy substitutes every home placeholder", () => {
    const c = filledCopy(FAKE_HOME);
    const all = Object.values(c).join(" ");
    expect(all).not.toMatch(/\{(street|crossStreet|unit|unitLetter|floor|address)\}/);
    expect(c["building.door"]).toContain("7Q");
  });
});
