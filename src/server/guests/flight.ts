import { CONCOURSES, type Concourse, type TrackingState } from "../../lib/arrival/types";

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

export async function fetchFlight(number: string, date: string): Promise<FlightResult> {
  const key = process.env.AERODATABOX_API_KEY;
  if (!key) return { ok: false, error: "AERODATABOX_API_KEY not set" };
  const url = `https://prod.api.market/api/v1/aedbx/aerodatabox/flights/number/${encodeURIComponent(number)}/${date}`;
  try {
    const res = await fetch(url, { headers: { "x-api-market-key": key } });
    const text = await res.text();
    if (res.status === 404 || res.status === 204 || (res.ok && !text.trim())) return { ok: true, snapshot: null };
    if (!res.ok) return { ok: false, error: `aerodatabox ${res.status}: ${text.slice(0, 200)}` };
    let data: unknown;
    try { data = JSON.parse(text); } catch { return { ok: false, error: `aerodatabox bad json: ${text.slice(0, 200)}` }; }
    return { ok: true, snapshot: normalizeAeroDataBox(data, date) };
  } catch (e) {
    return { ok: false, error: `aerodatabox unreachable: ${(e as Error).message}` };
  }
}
