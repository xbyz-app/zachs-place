import { randomBytes } from "node:crypto";
import { emptyTracking, type Guest, type Pickup } from "../../lib/arrival/types";

export interface GuestInput {
  name: string;
  firstName?: string;
  email?: string | null;
  phone?: string | null;
  arriveDate: string;
  departDate: string;
  flight?: { number: string; date: string } | null;
  checkedBag?: boolean | null;
  pickup?: Pickup;
  doorInvited?: boolean;
  buildingRegistered?: boolean;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const ALLOWED = new Set(["name", "firstName", "email", "phone", "arriveDate", "departDate", "flight", "checkedBag", "pickup", "doorInvited", "buildingRegistered"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function normalizeFlightNumber(s: string): string | null {
  const m = s.trim().toUpperCase().match(/^([A-Z0-9]{2})\s?(\d{1,4})$/);
  return m ? `${m[1]}${m[2]}` : null;
}

function check(body: unknown, partial: boolean): Parsed<Partial<GuestInput>> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, errors: ["body must be a JSON object"] };
  const b = body as Record<string, unknown>;
  const errors: string[] = [];
  const out: Partial<GuestInput> = {};
  const has = (k: string) => Object.hasOwn(b, k);

  for (const k of Object.keys(b)) if (!ALLOWED.has(k)) errors.push(`unknown field "${k}"`);

  if (!partial || has("name")) {
    if (typeof b.name === "string" && b.name.trim()) out.name = b.name.trim(); else errors.push("name is required");
  }
  if (has("firstName")) {
    if (typeof b.firstName === "string" && b.firstName.trim()) out.firstName = b.firstName.trim(); else errors.push("firstName must be a non-empty string");
  }
  if (has("email")) {
    if (b.email === null) out.email = null;
    else if (typeof b.email === "string" && EMAIL.test(b.email.trim())) out.email = b.email.trim();
    else errors.push("email must be an address or null");
  }
  if (has("phone")) {
    if (b.phone === null) out.phone = null;
    else if (typeof b.phone === "string" && E164.test(b.phone)) out.phone = b.phone;
    else errors.push('phone must be E.164 like "+14045550100" or null');
  }
  for (const k of ["arriveDate", "departDate"] as const) {
    if (!partial || has(k)) {
      if (validDate(b[k])) out[k] = b[k] as string; else errors.push(`${k} must be a real YYYY-MM-DD date`);
    }
  }
  if (has("flight")) {
    if (b.flight === null) out.flight = null;
    else {
      const f = (typeof b.flight === "object" && b.flight !== null ? b.flight : {}) as Record<string, unknown>;
      const number = typeof f.number === "string" ? normalizeFlightNumber(f.number) : null;
      if (!number) errors.push('flight.number must look like "DL1234"');
      if (!validDate(f.date)) errors.push("flight.date must be YYYY-MM-DD (the departure date on their ticket)");
      if (number && validDate(f.date)) out.flight = { number, date: f.date };
    }
  }
  if (has("checkedBag")) {
    if (b.checkedBag === null || typeof b.checkedBag === "boolean") out.checkedBag = b.checkedBag;
    else errors.push("checkedBag must be true, false, or null (unknown)");
  }
  if (has("pickup")) {
    if (b.pickup === "rideshare" || b.pickup === "zach") out.pickup = b.pickup; else errors.push('pickup must be "rideshare" or "zach"');
  }
  for (const k of ["doorInvited", "buildingRegistered"] as const) {
    if (has(k)) { if (typeof b[k] === "boolean") out[k] = b[k] as boolean; else errors.push(`${k} must be true or false`); }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export function parseCreate(body: unknown): Parsed<GuestInput> {
  const r = check(body, false);
  if (!r.ok) return r;
  if (r.value.departDate! < r.value.arriveDate!) return { ok: false, errors: ["departDate is before arriveDate"] };
  return r as Parsed<GuestInput>;
}

export function parsePatch(body: unknown): Parsed<Partial<GuestInput>> {
  return check(body, true);
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "guest";

export function newGuest(input: GuestInput, now: Date, rand: (n: number) => Buffer = randomBytes): Guest {
  return {
    id: `${slug(input.name)}-${rand(3).toString("hex")}`,
    token: rand(32).toString("base64url"),
    name: input.name,
    firstName: input.firstName ?? input.name.split(/\s+/)[0],
    email: input.email ?? null,
    phone: input.phone ?? null,
    arriveDate: input.arriveDate,
    departDate: input.departDate,
    flight: input.flight ?? null,
    checkedBag: input.checkedBag ?? null,
    pickup: input.pickup ?? "rideshare",
    doorInvited: input.doorInvited ?? false,
    buildingRegistered: input.buildingRegistered ?? false,
    tracking: emptyTracking(),
    sends: {},
    alertsSent: [],
    createdAt: now.toISOString(),
  };
}

// Alert keys that belong to one specific flight; cleared when the flight changes.
const FLIGHT_ALERT = /^(delay:|gate:|state:|errors:|stale$|not-found$|landed(-late)?$|stuck:landed|failed:landed|no-flight$)/;

export function applyPatch(g: Guest, patch: Partial<GuestInput>): Guest {
  const next = structuredClone(g);
  const flightChanged = Object.hasOwn(patch, "flight") && JSON.stringify(patch.flight ?? null) !== JSON.stringify(g.flight);
  Object.assign(next, patch);
  if (flightChanged) {
    next.tracking = emptyTracking();
    delete next.sends.landedEmail;
    delete next.sends.landedSms;
    next.alertsSent = next.alertsSent.filter((k) => !FLIGHT_ALERT.test(k));
  }
  return next;
}
