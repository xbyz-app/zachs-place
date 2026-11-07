import type { PageModel } from "./types";
import { addDays, etClock, etParts } from "./time";

type Flight = PageModel["flight"];
type Departure = PageModel["departure"];

export function tokenFromPath(path: string): string | null {
  const m = path.match(/^\/arrive\/([A-Za-z0-9_-]{20,})\/?$/);
  return m ? m[1] : null;
}

export function statusLine(flight: Flight): string {
  if (!flight) return "";
  const n = flight.number;
  const when = flight.estimatedArrival ?? flight.scheduledArrival;
  const at = when ? `${etClock(when)} atlanta time` : null;
  switch (flight.state) {
    case "idle": return `${n}: i'll start tracking it the night before.`;
    case "scheduled": {
      const late = flight.estimatedArrival && flight.scheduledArrival
        && Date.parse(flight.estimatedArrival) - Date.parse(flight.scheduledArrival) >= 15 * 60_000;
      if (late) return `${n} is running late, now landing ${at}.`;
      return at ? `${n} is on schedule, landing ${at}.` : `${n} is on schedule.`;
    }
    case "departed": return at ? `${n} is in the air, landing about ${at}.` : `${n} is in the air.`;
    case "landed": return `you landed${flight.gate ? ` at ${flight.gate}` : ""}!! steps below.`;
    case "cancelled": return `${n} shows cancelled. call zach.`;
    case "diverted": return `${n} got diverted. call zach.`;
    default: return `${n}: no live status right now.`;
  }
}

/** The flight-home card shows from the day before the flight (ET) until the page expires. */
export function showDeparture(dep: Departure, now: Date): boolean {
  return !!dep && etParts(now).date >= addDays(dep.date, -1);
}

export function departureLine(dep: Departure): string {
  if (!dep) return "";
  const n = dep.number;
  const to = dep.destination ? ` to ${dep.destination}` : "";
  const gate = dep.gate ? ` from ${dep.gate}` : "";
  const when = dep.estimatedDeparture ?? dep.scheduledDeparture;
  const at = when ? etClock(when) : null;
  switch (dep.state) {
    case "idle": return `${n}${to}: i'll start tracking it the night before.`;
    case "scheduled": {
      const late = dep.estimatedDeparture && dep.scheduledDeparture
        && Date.parse(dep.estimatedDeparture) - Date.parse(dep.scheduledDeparture) >= 15 * 60_000;
      if (late) return `${n}${to} is running late, now leaving ${at}${gate}.`;
      return at ? `${n}${to} leaves ${at}${gate}, on time.` : `${n}${to} is on time.`;
    }
    case "boarding": return `${n}${to} is boarding${dep.gate ? ` at ${dep.gate}` : ""}!! go go go.`;
    case "departed": return `${n} took off. safe flight!!`;
    case "cancelled": return `${n} shows cancelled. call zach.`;
    default: return `${n}${to}: no live status right now.`;
  }
}

export function shouldRefresh(flight: Flight, dep: Departure = null, now: Date = new Date()): boolean {
  const arriving = !!flight && ["idle", "scheduled", "departed", "unknown"].includes(flight.state);
  const leaving = showDeparture(dep, now) && ["idle", "scheduled", "boarding", "unknown"].includes(dep!.state);
  return arriving || leaving;
}
