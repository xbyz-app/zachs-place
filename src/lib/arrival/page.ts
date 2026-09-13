import type { PageModel } from "./types";
import { etClock } from "./time";

type Flight = PageModel["flight"];

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

export function shouldRefresh(flight: Flight): boolean {
  return !!flight && ["idle", "scheduled", "departed", "unknown"].includes(flight.state);
}
