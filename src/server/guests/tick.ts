import { SEND_KINDS, type Guest, type HomeVars, type SendKind, type SendRecord } from "../../lib/arrival/types";
import { addDays, etClock, etDateTime, etParts } from "../../lib/arrival/time";
import { buildRoute } from "../../lib/arrival/route";
import { filledCopy } from "../../lib/arrival/copy";
import { rideLinks } from "../../lib/arrival/deeplinks";
import { renderLandedEmail, renderPreArrivalEmail, renderSms } from "../../lib/arrival/render";
import type { CounterStore, GuestStore } from "./store";
import type { FlightResult } from "./flight";
import type { SendResult } from "./email";
import type { NtfyMessage } from "./ntfy";
import { isExpired, pageUrl, routeInputFor } from "./view";

const MIN = 60_000;
const HOUR = 60 * MIN;

export interface Alert extends NtfyMessage { key: string }

export interface TickDeps {
  store: GuestStore;
  counters: CounterStore;
  fetchFlight(number: string, date: string): Promise<FlightResult>;
  sendEmail(m: { to: string; subject: string; html: string; text: string }): Promise<SendResult>;
  sendSms(m: { to: string; body: string }): Promise<SendResult>;
  sendNtfy(m: NtfyMessage): Promise<{ ok: true } | { ok: false; error: string }>;
  now: Date;
  siteUrl: string;
  home: HomeVars;
  zachPhone: string | null;
  monthlyCap: number;
}

export interface TickSummary { guests: number; polled: number; sent: string[]; alerts: string[]; errors: string[] }

const FINISHED = new Set(["landed", "cancelled", "diverted"]);

export function shouldPoll(g: Guest, now: Date): boolean {
  if (!g.flight) return false;
  const t = g.tracking;
  if (FINISHED.has(t.state)) return false;
  if (now < etDateTime(addDays(g.flight.date, -1), 20)) return false;
  if (!t.lastCheckedAt) return true;
  const since = (now.getTime() - Date.parse(t.lastCheckedAt)) / MIN;
  if (t.scheduledDeparture) {
    const latest = t.estimatedArrival ?? t.scheduledArrival;
    if (latest && now.getTime() > Date.parse(latest) + 6 * HOUR) return false;
    if (now.getTime() < Date.parse(t.scheduledDeparture) - 30 * MIN) return false;
    const eta = Date.parse(latest ?? t.scheduledDeparture);
    const interval = eta - now.getTime() < 30 * MIN ? 5 : 10;
    return since >= interval - 0.5;
  }
  // No schedule yet (not found, or only errors so far): hourly from 5am ET on the flight date.
  if (now < etDateTime(g.flight.date, 5)) return false;
  return since >= 59.5;
}

export function applySnapshot(g: Guest, result: FlightResult, now: Date): { guest: Guest; alerts: Alert[] } {
  const guest = structuredClone(g);
  const t = guest.tracking;
  const alerts: Alert[] = [];
  const who = `${guest.firstName}'s ${guest.flight?.number ?? "flight"}`;
  t.lastCheckedAt = now.toISOString();

  if (!result.ok) {
    t.consecutiveErrors += 1;
    t.lastError = result.error;
    if (t.consecutiveErrors >= 3) {
      alerts.push({ key: `errors:${etParts(now).date}`, title: "Flight tracking failing", priority: "high",
        body: `${who}: ${t.consecutiveErrors} failed checks in a row (${result.error}). nothing has been sent to them.` });
    }
    return { guest, alerts };
  }
  t.consecutiveErrors = 0;
  t.lastError = null;

  const s = result.snapshot;
  if (!s) {
    alerts.push({ key: "not-found", title: "Guest flight not found", priority: "high",
      body: `AeroDataBox has no ${guest.flight?.number} on ${guest.flight?.date} into ATL. check the number and date for ${guest.name}.` });
    return { guest, alerts };
  }

  const prevGate = t.gate;
  Object.assign(t, {
    state: s.state, airline: s.airline, international: s.international, gate: s.gate, concourse: s.concourse,
    scheduledDeparture: s.scheduledDeparture, scheduledArrival: s.scheduledArrival,
    estimatedArrival: s.estimatedArrival, landedAt: s.landedAt,
  });

  if (s.scheduledArrival && s.estimatedArrival && s.state !== "landed") {
    const late = Math.round((Date.parse(s.estimatedArrival) - Date.parse(s.scheduledArrival)) / MIN);
    if (late >= 30) {
      alerts.push({ key: `delay:${Math.floor(late / 30) * 30}`, title: "Guest flight delayed",
        body: `${who} is running ${late} min late, now landing ${etClock(s.estimatedArrival)}.` });
    }
  }
  if (prevGate && s.gate && prevGate !== s.gate) {
    alerts.push({ key: `gate:${s.gate}`, title: "Guest gate change", body: `${who}: arrival gate ${prevGate} -> ${s.gate}.` });
  }
  if (s.state === "cancelled" || s.state === "diverted") {
    alerts.push({ key: `state:${s.state}`, priority: "high",
      title: s.state === "cancelled" ? "Guest flight cancelled" : "Guest flight diverted",
      body: `${who} shows ${s.state}. nothing has been sent to them.` });
  }
  return { guest, alerts };
}

export function landedRecently(g: Guest, now: Date): boolean {
  const t = g.tracking;
  return t.state === "landed" && t.landedAt !== null && now.getTime() - Date.parse(t.landedAt) < 6 * HOUR;
}

const canAttempt = (r: SendRecord | undefined) => !r || (r.status === "failed" && r.attempts < 3);

export function dueSends(g: Guest, now: Date): SendKind[] {
  const out: SendKind[] = [];
  const preWindow = now >= etDateTime(addDays(g.arriveDate, -2), 10) && now < etDateTime(addDays(g.arriveDate, 1), 0);
  if (g.email && preWindow && g.tracking.state !== "landed" && canAttempt(g.sends.preArrival)) out.push("preArrival");
  if (landedRecently(g, now)) {
    if (g.email && canAttempt(g.sends.landedEmail)) out.push("landedEmail");
    if (g.phone && canAttempt(g.sends.landedSms)) out.push("landedSms");
  }
  return out;
}

export function timelineAlerts(g: Guest, now: Date, site: string): Alert[] {
  const a: Alert[] = [];
  const t = g.tracking;
  const url = pageUrl(site, g);
  if (!g.doorInvited && now >= etDateTime(addDays(g.arriveDate, -3), 9) && now < etDateTime(addDays(g.arriveDate, 1), 0)) {
    a.push({ key: "door-reminder", title: "Send the Door invite",
      body: `${g.firstName} arrives ${g.arriveDate} and doesn't have a Door invite yet. once it's sent, PATCH doorInvited: true.` });
  }
  if (!g.email && now >= etDateTime(addDays(g.arriveDate, -2), 10)) {
    a.push({ key: "no-email", title: "Guest has no email", body: `no email for ${g.name}, so no pre-arrival or landed email. their page still works: ${url}` });
  }
  if (!g.flight && now >= etDateTime(addDays(g.arriveDate, -1), 20)) {
    a.push({ key: "no-flight", title: "Guest has no flight", body: `no flight number for ${g.name}, so no landed messages. their page still works: ${url}` });
  }
  const latest = t.estimatedArrival ?? t.scheduledArrival;
  if (latest && (t.state === "scheduled" || t.state === "departed" || t.state === "unknown") && now.getTime() > Date.parse(latest) + 2 * HOUR) {
    a.push({ key: "stale", title: "Guest flight status stale", priority: "high",
      body: `${g.firstName}'s ${g.flight?.number} should have landed by ${etClock(latest)} but tracking never saw it land. nothing was sent to them.` });
  }
  if (isExpired(g, now)) {
    a.push({ key: "expired", title: "Guest visit over", body: `${g.name}'s visit is over and the page link is dead. run: cd ~/zachs-place && npm run archive-guests` });
  }
  return a;
}

async function deliver(kind: SendKind, g: Guest, d: TickDeps): Promise<SendResult> {
  try {
    const url = pageUrl(d.siteUrl, g);
    if (kind === "preArrival") {
      const m = renderPreArrivalEmail({
        firstName: g.firstName, arriveDate: g.arriveDate, flightNumber: g.flight?.number ?? null,
        checkedBag: g.checkedBag, pickup: g.pickup, pageUrl: url, address: d.home.address, zachPhone: d.zachPhone,
      });
      return await d.sendEmail({ to: g.email!, ...m });
    }
    const input = routeInputFor(g);
    const steps = buildRoute(input);
    if (kind === "landedSms") return await d.sendSms({ to: g.phone!, body: renderSms(steps, input.pickup, input.concourse, url) });
    const m = renderLandedEmail({
      firstName: g.firstName, steps, input, copy: filledCopy(d.home), pageUrl: url, links: rideLinks(d.home), zachPhone: d.zachPhone,
    });
    return await d.sendEmail({ to: g.email!, ...m });
  } catch (e) {
    return { ok: false, error: `render/send threw: ${(e as Error).message}` };
  }
}

export async function runTick(d: TickDeps): Promise<TickSummary> {
  const summary: TickSummary = { guests: 0, polled: 0, sent: [], alerts: [], errors: [] };
  const monthKey = `aerodatabox:${etParts(d.now).date.slice(0, 7)}`;
  const guests = await d.store.list();
  summary.guests = guests.length;

  for (const original of guests) {
    try {
      let g = original;
      const alerts: Alert[] = [];

      if (shouldPoll(g, d.now)) {
        const used = await d.counters.get(monthKey);
        if (d.monthlyCap <= 0) {
          alerts.push({ key: "cap-unset", title: "Flight tracking is off", priority: "high",
            body: `AERODATABOX_MONTHLY_CAP isn't set, so ${g.firstName}'s flight isn't being tracked and nothing will send at landing.` });
        } else if (used >= d.monthlyCap) {
          alerts.push({ key: `cap:${monthKey}`, title: "AeroDataBox cap reached", priority: "high",
            body: `${used}/${d.monthlyCap} calls this month. tracking is paused, nothing will send at landing. raise AERODATABOX_MONTHLY_CAP if the plan allows.` });
        } else {
          const result = await d.fetchFlight(g.flight!.number, g.flight!.date);
          const n = await d.counters.increment(monthKey);
          if (n >= Math.ceil(d.monthlyCap * 0.8)) {
            alerts.push({ key: `cap80:${monthKey}`, title: "AeroDataBox 80% used", body: `${n}/${d.monthlyCap} calls this month.` });
          }
          const applied = applySnapshot(g, result, d.now);
          g = applied.guest;
          alerts.push(...applied.alerts);
          summary.polled++;
        }
      }

      for (const kind of SEND_KINDS) {
        const r = g.sends[kind];
        if (r?.status === "sending" && d.now.getTime() - Date.parse(r.at) > 10 * MIN) {
          g.sends[kind] = { ...r, status: "failed", attempts: 3, detail: "lease expired mid-send; may or may not have gone out" };
          alerts.push({ key: `stuck:${kind}`, title: "Guest message unclear", priority: "high",
            body: `the ${kind} message to ${g.firstName} may or may not have gone out (a tick died mid-send). check the Resend/Twilio logs. it won't be retried.` });
        }
      }

      alerts.push(...timelineAlerts(g, d.now, d.siteUrl));

      const sentNow: SendKind[] = [];
      for (const kind of dueSends(g, d.now)) {
        const attempts = (g.sends[kind]?.attempts ?? 0) + 1;
        g.sends[kind] = { status: "sending", at: d.now.toISOString(), attempts };
        await d.store.put(g); // the lease is durable before the provider call
        const r = await deliver(kind, g, d);
        const at = d.now.toISOString();
        if (r.ok) {
          g.sends[kind] = { status: "sent", at, attempts, detail: r.id };
          sentNow.push(kind);
          summary.sent.push(`${g.id}:${kind}`);
        } else if (r.skipped) {
          g.sends[kind] = { status: "skipped", at, attempts, detail: r.reason };
        } else {
          g.sends[kind] = { status: "failed", at, attempts, detail: r.error };
          if (attempts >= 3) {
            alerts.push({ key: `failed:${kind}`, title: "Guest message failed", priority: "high",
              body: `the ${kind} message to ${g.firstName} failed 3 times: ${r.error}` });
          }
        }
        await d.store.put(g);
      }

      if (sentNow.includes("preArrival")) {
        alerts.push({ key: "pre-arrival-sent", title: "Pre-arrival email sent", body: `${g.firstName}'s pre-arrival email went out.\n${pageUrl(d.siteUrl, g)}` });
      }

      const t = g.tracking;
      const landedKinds = (["landedEmail", "landedSms"] as const).filter((k) => (k === "landedEmail" ? g.email : g.phone));
      if (landedRecently(g, d.now) && landedKinds.every((k) => g.sends[k])) {
        const status = (k: SendKind) => (g.sends[k]!.status === "skipped" ? "skipped (sms off)" : g.sends[k]!.status);
        const gate = t.gate ? ` at ${t.gate}` : " (no gate from tracking, so they got the pick-your-concourse version)";
        const intl = t.international === null ? " couldn't tell if the flight was international, sent domestic steps." : "";
        alerts.push({ key: "landed", title: "Guest landed",
          body: `${g.firstName} landed${gate}. email: ${g.email ? status("landedEmail") : "no email"}. text: ${g.phone ? status("landedSms") : "no phone"}.${intl}` });
      }

      for (const a of alerts) {
        if (g.alertsSent.includes(a.key)) continue;
        const { key, ...msg } = a;
        const r = await d.sendNtfy(msg);
        if (r.ok) { g.alertsSent.push(key); summary.alerts.push(`${g.id}:${key}`); }
        else summary.errors.push(`${g.id}: ntfy ${key}: ${r.error}`);
      }
      await d.store.put(g);
    } catch (e) {
      summary.errors.push(`${original.id}: ${(e as Error).message}`);
    }
  }
  return summary;
}
