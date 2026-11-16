import { CONCOURSES, type Concourse, type DepartState, type TrackingState } from "../../lib/arrival/types";

export interface FlightSnapshot {
  state: Exclude<TrackingState, "idle">;
  airline: string | null;
  arrivalAirport: string | null;
  international: boolean | null;
  gate: string | null;
  terminal: string | null;
  concourse: Concourse | null;
  scheduledDeparture: string | null;
  scheduledArrival: string | null;
  estimatedArrival: string | null;
  landedAt: string | null;
}

export type FlightResult = { ok: true; snapshot: FlightSnapshot | null } | { ok: false; error: string };

const DOMESTIC_COUNTRIES = new Set(["US", "PR", "VI", "GU", "AS", "MP"]);
// US CBP preclearance airports: passengers clear US customs before departure and arrive at ATL as domestic.
const PRECLEARANCE = new Set(["YYZ", "YUL", "YVR", "YYC", "YEG", "YOW", "YHZ", "YWG", "DUB", "SNN", "NAS", "FPO", "BDA", "AUA", "AUH"]);

export function airlineFromFlightNumber(n: string | null): string | null {
  const m = n?.trim().toUpperCase().match(/^([A-Z0-9]{2})\s?\d{1,4}$/);
  return m ? m[1] : null;
}

export function concourseFrom(gate: string | null | undefined, terminal: string | null | undefined): Concourse | null {
  const g = gate?.trim().toUpperCase();
  if (g && (CONCOURSES as readonly string[]).includes(g[0])) return g[0] as Concourse;
  const t = terminal?.trim().toUpperCase();
  if (t === "I") return "F"; // International Terminal
  if (t && t.length === 1 && (CONCOURSES as readonly string[]).includes(t)) return t as Concourse;
  return null;
}

type TimeVal = string | { utc?: string; local?: string } | undefined;
function iso(v: TimeVal): string | null {
  const s = typeof v === "string" ? v : v?.utc ?? v?.local;
  if (!s) return null;
  const d = new Date(s.trim().replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapStatus(s: unknown): FlightSnapshot["state"] {
  switch (String(s ?? "").toLowerCase()) {
    case "arrived": case "landed": return "landed";
    case "departed": case "enroute": case "en route": case "approaching": case "airborne": return "departed";
    case "canceled": case "cancelled": case "canceleduncertain": return "cancelled";
    case "diverted": return "diverted";
    case "unknown": return "unknown";
    default: return "scheduled"; // Expected, CheckIn, Boarding, GateClosed, Delayed, missing
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

export function normalizeAeroDataBox(raw: unknown, flightDate: string): FlightSnapshot | null {
  const list: Raw[] = Array.isArray(raw) ? raw : Array.isArray((raw as Raw)?.data) ? (raw as Raw).data : [];
  const toAtl = list.filter((f) => f?.arrival?.airport?.iata === "ATL");
  if (toAtl.length === 0) return null;
  const f = toAtl.find((x) => (iso(x.departure?.scheduledTime) ?? "").slice(0, 10) === flightDate) ?? toAtl[0];

  const from = f.departure?.airport?.iata as string | undefined;
  const country = (f.departure?.airport?.countryCode as string | undefined)?.toUpperCase();
  const international = from && PRECLEARANCE.has(from) ? false : country ? !DOMESTIC_COUNTRIES.has(country) : null;
  const state = mapStatus(f.status);
  const gate = (f.arrival?.gate as string | undefined)?.trim() || null;
  const terminal = (f.arrival?.terminal as string | undefined)?.trim() || null;
  const estimatedArrival = iso(f.arrival?.revisedTime) ?? iso(f.arrival?.predictedTime);

  return {
    state,
    airline: f.airline?.iata ?? null,
    arrivalAirport: "ATL",
    international,
    gate,
    terminal,
    concourse: concourseFrom(gate, terminal),
    scheduledDeparture: iso(f.departure?.scheduledTime),
    scheduledArrival: iso(f.arrival?.scheduledTime),
    estimatedArrival,
    landedAt: state === "landed" ? iso(f.arrival?.runwayTime) ?? estimatedArrival ?? iso(f.arrival?.scheduledTime) : null,
  };
}

export interface DepartureSnapshot {
  state: Exclude<DepartState, "idle">;
  destination: string | null;
  gate: string | null;
  scheduledDeparture: string | null;
  estimatedDeparture: string | null;
  departedAt: string | null;
}

export type DepartureResult = { ok: true; snapshot: DepartureSnapshot | null } | { ok: false; error: string };

function mapDepartStatus(s: unknown): DepartureSnapshot["state"] {
  switch (String(s ?? "").toLowerCase()) {
    case "boarding": case "gateclosed": return "boarding";
    case "departed": case "enroute": case "en route": case "approaching": case "airborne":
    case "arrived": case "landed": case "diverted": return "departed";
    case "canceled": case "cancelled": case "canceleduncertain": return "cancelled";
    case "unknown": return "unknown";
    default: return "scheduled"; // Expected, CheckIn, Delayed, missing
  }
}

/** The leg leaving ATL on `flightDate` (else the first leg leaving ATL). */
export function normalizeDeparture(raw: unknown, flightDate: string): DepartureSnapshot | null {
  const list: Raw[] = Array.isArray(raw) ? raw : Array.isArray((raw as Raw)?.data) ? (raw as Raw).data : [];
  const fromAtl = list.filter((f) => f?.departure?.airport?.iata === "ATL");
  if (fromAtl.length === 0) return null;
  const f = fromAtl.find((x) => (iso(x.departure?.scheduledTime) ?? "").slice(0, 10) === flightDate) ?? fromAtl[0];
  const state = mapDepartStatus(f.status);
  const estimatedDeparture = iso(f.departure?.revisedTime) ?? iso(f.departure?.predictedTime);
  return {
    state,
    destination: (f.arrival?.airport?.iata as string | undefined) ?? null,
    gate: (f.departure?.gate as string | undefined)?.trim() || null,
    scheduledDeparture: iso(f.departure?.scheduledTime),
    estimatedDeparture,
    departedAt: state === "departed" ? iso(f.departure?.runwayTime) ?? estimatedDeparture ?? iso(f.departure?.scheduledTime) : null,
  };
}

type RawResult = { ok: true; data: unknown | null } | { ok: false; error: string };

async function fetchRaw(number: string, date: string): Promise<RawResult> {
  const key = process.env.AERODATABOX_API_KEY;
  if (!key) return { ok: false, error: "AERODATABOX_API_KEY not set" };
  const url = `https://prod.api.market/api/v1/aedbx/aerodatabox/flights/number/${encodeURIComponent(number)}/${date}`;
  try {
    const res = await fetch(url, { headers: { "x-api-market-key": key }, signal: AbortSignal.timeout(4000) });
    const text = await res.text();
    if (res.status === 404 || res.status === 204 || (res.ok && !text.trim())) return { ok: true, data: null };
    if (!res.ok) return { ok: false, error: `aerodatabox ${res.status}: ${text.slice(0, 200)}` };
    try { return { ok: true, data: JSON.parse(text) }; } catch { return { ok: false, error: `aerodatabox bad json: ${text.slice(0, 200)}` }; }
  } catch (e) {
    return { ok: false, error: `aerodatabox unreachable: ${(e as Error).message}` };
  }
}

export async function fetchFlight(number: string, date: string): Promise<FlightResult> {
  const r = await fetchRaw(number, date);
  if (!r.ok) return r;
  return { ok: true, snapshot: r.data === null ? null : normalizeAeroDataBox(r.data, date) };
}

export async function fetchDeparture(number: string, date: string): Promise<DepartureResult> {
  const r = await fetchRaw(number, date);
  if (!r.ok) return r;
  return { ok: true, snapshot: r.data === null ? null : normalizeDeparture(r.data, date) };
}
