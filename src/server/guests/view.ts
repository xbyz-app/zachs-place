import type { Guest } from "../../lib/arrival/types";
import type { RouteInput } from "../../lib/arrival/types";
import type { HomeVars, PageModel } from "../../lib/arrival/types";
import { addDays, etDateTime, etHour } from "../../lib/arrival/time";
import { airlineFromFlightNumber } from "./flight";
import { filledCopy } from "../../lib/arrival/copy";
import { rideLinks } from "../../lib/arrival/deeplinks";

export function siteUrl(): string {
  return (process.env.SITE_URL ?? "https://guest.xbyz.fun").replace(/\/$/, "");
}

export function pageUrl(site: string, g: Guest): string {
  return `${site}/arrive/${g.token}`;
}

export function routeInputFor(g: Guest): RouteInput {
  const t = g.tracking;
  return {
    airline: t.airline ?? airlineFromFlightNumber(g.flight?.number ?? null),
    checkedBag: g.checkedBag,
    concourse: t.concourse,
    international: t.international,
    pickup: g.pickup,
    arrivalHourET: etHour(t.landedAt ?? t.estimatedArrival ?? t.scheduledArrival),
  };
}

export function isExpired(g: Guest, now: Date): boolean {
  return now.getTime() >= etDateTime(addDays(g.departDate, 3), 0).getTime();
}

export function pageModel(g: Guest, home: HomeVars, zachPhone: string | null): PageModel {
  const t = g.tracking;
  return {
    firstName: g.firstName,
    arriveDate: g.arriveDate,
    flight: g.flight
      ? { number: g.flight.number, state: t.state, gate: t.gate, scheduledArrival: t.scheduledArrival, estimatedArrival: t.estimatedArrival, landedAt: t.landedAt }
      : null,
    route: routeInputFor(g),
    copy: filledCopy(home),
    links: rideLinks(home),
    address: home.address,
    zachPhone,
  };
}
