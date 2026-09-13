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
