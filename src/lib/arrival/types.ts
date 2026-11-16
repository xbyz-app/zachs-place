// Shared by server and browser. Must never read process.env (public repo; see plan constraints).

export type Concourse = "T" | "A" | "B" | "C" | "D" | "E" | "F";
export const CONCOURSES: readonly Concourse[] = ["T", "A", "B", "C", "D", "E", "F"];

export type Pickup = "rideshare" | "zach";

export type TrackingState =
  | "idle"       // never checked
  | "scheduled"
  | "departed"   // includes en route / approaching
  | "landed"
  | "cancelled"
  | "diverted"
  | "unknown";   // AeroDataBox answered but status is Unknown

export type SendKind = "preArrival" | "landedSms" | "landedEmail";
export const SEND_KINDS: readonly SendKind[] = ["preArrival", "landedEmail", "landedSms"];

export interface SendRecord {
  status: "sending" | "sent" | "failed" | "skipped";
  at: string;        // ISO
  attempts: number;
  detail?: string;   // provider id, error, or skip reason
}

export interface Tracking {
  state: TrackingState;
  airline: string | null;          // IATA
  international: boolean | null;
  concourse: Concourse | null;
  gate: string | null;
  scheduledDeparture: string | null; // ISO UTC
  scheduledArrival: string | null;
  estimatedArrival: string | null;
  landedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  consecutiveErrors: number;
}

export type DepartState =
  | "idle"       // never checked
  | "scheduled"
  | "boarding"   // Boarding or GateClosed
  | "departed"   // took off (en route, landed, or diverted all count: they're gone)
  | "cancelled"
  | "unknown";

/** Tracking for the flight home, which leaves ATL. */
export interface DepartTracking {
  state: DepartState;
  destination: string | null;        // IATA
  gate: string | null;
  scheduledDeparture: string | null; // ISO UTC
  estimatedDeparture: string | null;
  departedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  consecutiveErrors: number;
}

export interface Guest {
  id: string;
  token: string;                  // page URL secret
  name: string;
  firstName: string;              // what Zach calls them, e.g. "Shiner"
  email: string | null;
  phone: string | null;           // E.164
  arriveDate: string;             // YYYY-MM-DD (ET)
  departDate: string;
  flight: { number: string; date: string } | null; // "DL1234", departure date on the ticket
  checkedBag: boolean | null;     // null = unknown, never false
  pickup: Pickup;
  doorInvited: boolean;
  buildingRegistered: boolean;
  tracking: Tracking;
  /** The flight home from ATL. Absent on records made before departures were tracked: read via departOf(). */
  departFlight?: { number: string; date: string } | null;
  departTracking?: DepartTracking;
  sends: Partial<Record<SendKind, SendRecord>>;
  alertsSent: string[];
  createdAt: string;
}

export interface RouteInput {
  airline: string | null;
  checkedBag: boolean | null;
  concourse: Concourse | null;
  international: boolean | null;
  pickup: Pickup;
  arrivalHourET: number | null;   // 0-23
}

/** Private values. Server-only; comes from env. */
export interface HomeVars {
  address: string;
  lat: number;
  lng: number;
  street: string;
  crossStreet: string;
  unit: string;
  unitLetter: string;
  floor: string;
}

export interface RideLinks { lyft: string; uber: string; appleMaps: string }

/** What /api/arrive returns to a valid token holder. */
export interface PageModel {
  firstName: string;
  arriveDate: string;
  flight: null | {
    number: string;
    state: TrackingState;
    gate: string | null;
    scheduledArrival: string | null;
    estimatedArrival: string | null;
    landedAt: string | null;
  };
  departure: null | {
    number: string;
    date: string;                  // YYYY-MM-DD, departure date on the ticket
    state: DepartState;
    destination: string | null;
    gate: string | null;
    scheduledDeparture: string | null;
    estimatedDeparture: string | null;
    departedAt: string | null;
  };
  route: RouteInput;
  copy: Record<string, string>;   // STEP_COPY with placeholders already filled
  links: RideLinks;
  address: string;
  zachPhone: string | null;
}

export function emptyTracking(): Tracking {
  return {
    state: "idle", airline: null, international: null, concourse: null, gate: null,
    scheduledDeparture: null, scheduledArrival: null, estimatedArrival: null, landedAt: null,
    lastCheckedAt: null, lastError: null, consecutiveErrors: 0,
  };
}

export function emptyDepartTracking(): DepartTracking {
  return {
    state: "idle", destination: null, gate: null, scheduledDeparture: null, estimatedDeparture: null,
    departedAt: null, lastCheckedAt: null, lastError: null, consecutiveErrors: 0,
  };
}

/** The departing flight and its tracking, defaulted for records that predate them. */
export function departOf(g: Guest): { flight: { number: string; date: string } | null; tracking: DepartTracking } {
  return { flight: g.departFlight ?? null, tracking: g.departTracking ?? emptyDepartTracking() };
}
