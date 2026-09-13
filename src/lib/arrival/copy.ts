import type { Branch, StepId } from "./route";
import type { HomeVars, Pickup } from "./types";

// Templates only. This file is public and ships in the page bundle. Private values are
// {placeholders} filled on the server from env (see plan Global Constraints).
export const STEP_COPY: Record<StepId, string> = {
  "concourse.international": "you're landing international, so you'll clear customs and grab your bags in concourse F, then walk out through the International Terminal. no plane train for you.",
  "concourse.walk-t": "your gate is in T, which is truly best case scenario!! you don't need the train at all, just follow the signs and walk straight to baggage claim.",
  "concourse.train": "you're in {concourse}. follow signs to the plane train and take it to the final stop (domestic baggage claim). don't hop off early, ride it all the way.",
  "concourse.unknown": "check the letter on your gate. if it starts with T, skip the train and walk straight to baggage claim. anything else, take the plane train to the final stop (domestic baggage claim).",

  "escalator.north": "at the top of the escalators turn RIGHT toward the NORTH side. uber/lyft pickup is on the north, and with no checked bag you don't need the other side at all.",
  "escalator.north-claim": "at the top of the escalators turn RIGHT toward the NORTH side and grab your bag at your airline's baggage claim. uber/lyft pickup is on the north too, so you're already on the right side.",
  "escalator.south-claim": "at the top of the escalators turn LEFT toward the SOUTH side, that's delta baggage claim. grab your bag there.",
  "escalator.unlisted-claim": "at the top of the escalators follow the signs for your airline's baggage claim and grab your bag.",
  "escalator.to-north": "bag in hand, follow the Rideshare signs over to the NORTH side. every uber/lyft picks up from there.",
  "escalator.north-side": "at the top of the escalators turn RIGHT toward the NORTH side, and grab your bag at baggage claim if you checked one.",
  "escalator.south-side": "at the top of the escalators turn LEFT toward the SOUTH side (delta), and grab your bag at baggage claim if you checked one.",
  "escalator.unlisted-side": "at the top of the escalators follow the signs for your airline's baggage claim, and grab your bag if you checked one.",

  "ride.north-deck": "go thru north baggage claim to the escalators between doors N2 and N3. go down, out door LN1, and across the street at the crosswalk to the parking deck. there will be orange signs for uber/lyft, follow them to the pickup zones.",
  "ride.international-curb": "once you're through customs, follow the Rideshare signs out the arrivals doors to the pickup curb.",
  "ride.call": "call your ride while you're going down the escalator, takes them like 3-4 min. i'd do lyft, it's usually way cheaper.",
  "ride.call-international": "call your ride as you head for the doors, takes them like 3-4 min. i'd do lyft, it's usually way cheaper.",
  "ride.time-quiet": "15-20 min to me, not much traffic at this hour.",
  "ride.time-normal": "20ish min to me, longer if you hit rush hour.",

  "meet.curb": "head out the doors to the arrivals curb right there and text me which door number you're at. i'll pull up.",
  "meet.international-curb": "once you're through customs, go out to the International Terminal arrivals curb and text me which door you're at. i'll pull up.",

  "building.dropoff": "for the drop off: i live on a one way street. GPS will have them loop around the block and pull into the little delivery garage on {street} (not the resident garage on {crossStreet}). way easier to get your bag out in there.",
  "building.door": "main door is on {street}. it'll be locked but there's a screen to buzz the concierge. buzz them, not me. tell them you're here for zach in {unit}, you're on the guest list!",
  "building.elevator": "they'll call the elevator and send you up to {floor}.",
  "building.hall": "off the elevator look for the double door opening, go through it, then follow the little {unitLetter} signs to the right. all the way down the hall, last door on the left.",
  "building.room": "the Door app unlocks it. bed's made, towels out.",

  "close.asleep": "i'll probably be asleep lol. wake me up or just crash, either is fine!!",
  "close.awake": "text me when you're downstairs!",
  "close.either": "text me when you're downstairs. if it's late and i don't answer, just crash!",
  "close.see-you": "see you at the curb!!",
};

export const SMS_STEP_IDS = [
  "concourse.international", "concourse.walk-t", "concourse.train", "concourse.unknown",
  "escalator.north", "escalator.north-claim", "escalator.south-claim", "escalator.unlisted-claim", "escalator.to-north",
  "escalator.north-side", "escalator.south-side", "escalator.unlisted-side",
  "meet.curb", "meet.international-curb",
] as const satisfies readonly StepId[];

export const SMS_COPY: Partial<Record<StepId, string>> = {
  "concourse.international": "customs + bags in F, then out the International Terminal.",
  "concourse.walk-t": "you're in T, no train, walk straight to baggage claim.",
  "concourse.train": "you're in {concourse}, plane train to the last stop (baggage claim).",
  "concourse.unknown": "gate starts with T? walk to bag claim. else train to the last stop.",
  "escalator.north": "top of escalators go RIGHT (NORTH) for uber/lyft.",
  "escalator.north-claim": "top of escalators go RIGHT (NORTH), bag claim + uber/lyft both there.",
  "escalator.south-claim": "top of escalators go LEFT (SOUTH) to delta bag claim,",
  "escalator.unlisted-claim": "follow signs to your airline's bag claim,",
  "escalator.to-north": "then Rideshare signs to the NORTH side.",
  "escalator.north-side": "top of escalators go RIGHT (NORTH), grab your bag if you checked one.",
  "escalator.south-side": "top of escalators go LEFT (SOUTH), grab your bag if you checked one.",
  "escalator.unlisted-side": "follow signs to your airline's bag claim.",
  "meet.curb": "then out to the arrivals curb, text me your door number.",
  "meet.international-curb": "then out to the International Terminal arrivals curb, text me your door number.",
};

export const GROUP_TITLES: Record<Pickup, Record<1 | 2 | 3 | 4, string>> = {
  rideshare: { 1: "off the plane", 2: "top of the escalators", 3: "your ride", 4: "getting in" },
  zach: { 1: "off the plane", 2: "top of the escalators", 3: "finding me", 4: "see you soon" },
};

export const BRANCH_LABEL: Record<Branch, string> = {
  "no-bag": "if you didn't check a bag",
  bag: "if you checked a bag",
};

export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(vars, k) ? vars[k] : m));
}

export function filledCopy(home: HomeVars): Record<StepId, string> {
  const vars = {
    address: home.address, street: home.street, crossStreet: home.crossStreet,
    unit: home.unit, unitLetter: home.unitLetter, floor: home.floor,
  };
  return Object.fromEntries(Object.entries(STEP_COPY).map(([id, t]) => [id, fillTemplate(t, vars)])) as Record<StepId, string>;
}
