import type { RouteInput } from "./types";

export const STEP_IDS = [
  "concourse.international", "concourse.walk-t", "concourse.train", "concourse.unknown",
  // rideshare, domestic
  "escalator.north", "escalator.north-claim", "escalator.south-claim", "escalator.unlisted-claim", "escalator.to-north",
  // zach pickup, domestic: go to your airline's side
  "escalator.north-side", "escalator.south-side", "escalator.unlisted-side",
  "ride.north-deck", "ride.international-curb", "ride.call", "ride.call-international", "ride.time-quiet", "ride.time-normal",
  "meet.curb", "meet.international-curb",
  "building.dropoff", "building.door", "building.elevator", "building.hall", "building.room",
  "close.asleep", "close.awake", "close.either", "close.see-you",
] as const;
export type StepId = (typeof STEP_IDS)[number];
export type Branch = "no-bag" | "bag";
export interface Step { id: StepId; group: 1 | 2 | 3 | 4; branch?: Branch }

export const DELTA = "DL";
// Domestic Terminal North, official ATL terminal map (Jan 2022): Alaska, American, Frontier,
// JetBlue, Southwest, Spirit, United. Anything else (Avelo, Sun Country, unknown) gets
// "follow signs for your airline's baggage claim" rather than a guessed side.
export const NORTH_AIRLINES: ReadonlySet<string> = new Set(["AS", "AA", "F9", "B6", "WN", "NK", "UA"]);

type Side = "north" | "south" | "unlisted";
function sideOf(airline: string | null): Side {
  if (airline === DELTA) return "south";
  if (airline && NORTH_AIRLINES.has(airline)) return "north";
  return "unlisted";
}

function bagRideshareSteps(airline: string | null): StepId[] {
  const side = sideOf(airline);
  if (side === "north") return ["escalator.north-claim"];
  return [side === "south" ? "escalator.south-claim" : "escalator.unlisted-claim", "escalator.to-north"];
}

const quiet = (h: number | null) => h !== null && (h < 7 || h >= 20);

function closeFor(h: number | null): StepId {
  if (h === null) return "close.either";
  return h >= 23 || h < 8 ? "close.asleep" : "close.awake";
}

export function buildRoute(input: RouteInput): Step[] {
  const steps: Step[] = [];
  const add = (id: StepId, group: Step["group"], branch?: Branch) =>
    steps.push(branch ? { id, group, branch } : { id, group });
  const intl = input.international === true;

  // 1: off the concourse
  if (intl) add("concourse.international", 1);
  else if (input.concourse === "T") add("concourse.walk-t", 1);
  else if (input.concourse === null) add("concourse.unknown", 1);
  else add("concourse.train", 1);

  // 2: top of the escalators (domestic only)
  if (!intl) {
    if (input.pickup === "zach") {
      const side = sideOf(input.airline);
      add(side === "north" ? "escalator.north-side" : side === "south" ? "escalator.south-side" : "escalator.unlisted-side", 2);
    } else if (input.checkedBag === false) {
      add("escalator.north", 2);
    } else if (input.checkedBag === true) {
      for (const id of bagRideshareSteps(input.airline)) add(id, 2);
    } else {
      add("escalator.north", 2, "no-bag");
      for (const id of bagRideshareSteps(input.airline)) add(id, 2, "bag");
    }
  }

  // 3: the ride
  if (input.pickup === "zach") {
    add(intl ? "meet.international-curb" : "meet.curb", 3);
  } else {
    add(intl ? "ride.international-curb" : "ride.north-deck", 3);
    add(intl ? "ride.call-international" : "ride.call", 3);
    add(quiet(input.arrivalHourET) ? "ride.time-quiet" : "ride.time-normal", 3);
  }

  // 4: the building
  if (input.pickup === "zach") {
    add("close.see-you", 4);
  } else {
    for (const id of ["building.dropoff", "building.door", "building.elevator", "building.hall", "building.room"] as const) add(id, 4);
    add(closeFor(input.arrivalHourET), 4);
  }
  return steps;
}
