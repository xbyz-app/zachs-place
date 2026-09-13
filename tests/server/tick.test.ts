import { describe, it, expect, vi } from "vitest";
import { runTick } from "../../src/server/guests/tick";
import { memoryGuestStore, memoryCounterStore } from "../../src/server/guests/store";
import type { FlightResult, FlightSnapshot } from "../../src/server/guests/flight";
import type { SendResult } from "../../src/server/guests/email";
import { emptyTracking, type Guest } from "../../src/lib/arrival/types";
import { makeGuest } from "../helpers/guest";
import { FAKE_HOME } from "../helpers/env";

type Email = { to: string; subject: string; html: string; text: string };
type Push = { title: string; body: string; priority?: string };

function harness(guest: Guest, o: { monthlyCap?: number; email?: () => SendResult; sms?: () => SendResult } = {}) {
  const store = memoryGuestStore([guest]);
  const counters = memoryCounterStore();
  const flights: FlightResult[] = [];
  const emails: Email[] = [], texts: { to: string; body: string }[] = [], pushes: Push[] = [];
  const fetchFlight = vi.fn(async () => flights.shift() ?? ({ ok: false, error: "no scripted response" } as FlightResult));
  const sendEmail = vi.fn(async (m: Email) => { emails.push(m); return o.email?.() ?? { ok: true as const, id: `em${emails.length}` }; });
  const sendSms = vi.fn(async (m: { to: string; body: string }) => { texts.push(m); return o.sms?.() ?? { ok: true as const, id: `sm${texts.length}` }; });
  const sendNtfy = vi.fn(async (m: Push) => { pushes.push(m); return { ok: true as const }; });
  const tick = async (iso: string) => {
    await runTick({ store, counters, fetchFlight, sendEmail, sendSms, sendNtfy, now: new Date(iso), siteUrl: "https://guest.example.test", home: FAKE_HOME, zachPhone: "+15555550100", monthlyCap: o.monthlyCap ?? 500 });
    return (await store.get(guest.id))!;
  };
  return { store, counters, flights, fetchFlight, sendEmail, sendSms, sendNtfy, emails, texts, pushes, tick };
}

// DL1234: departs 06:00 ET (10:00Z), lands 08:25 ET (12:25Z) on 2026-09-20.
const snap = (o: Partial<FlightSnapshot> = {}): FlightResult => ({
  ok: true,
  snapshot: {
    state: "scheduled", airline: "DL", arrivalAirport: "ATL", international: false, gate: null, terminal: null, concourse: null,
    scheduledDeparture: "2026-09-20T10:00:00.000Z", scheduledArrival: "2026-09-20T12:25:00.000Z", estimatedArrival: null, landedAt: null, ...o,
  },
});
const inFlight = (o: Partial<Guest["tracking"]> = {}): Guest["tracking"] => ({
  ...emptyTracking(), state: "departed", airline: "DL", international: false,
  scheduledDeparture: "2026-09-20T10:00:00.000Z", scheduledArrival: "2026-09-20T12:25:00.000Z",
  lastCheckedAt: "2026-09-20T11:00:00.000Z", ...o,
});
// preArrival already sent AND acknowledged -- the "Pre-arrival email sent" alert is derived from
// persisted state (so it survives an ntfy failure), so a fixture representing "fully handled"
// needs the ack already recorded, or it re-fires the moment alertsSent is checked.
const settled = { doorInvited: true, sends: { preArrival: { status: "sent" as const, at: "x", attempts: 1 } }, alertsSent: ["pre-arrival-sent"] };
const titles = (p: Push[]) => p.map((x) => x.title);

describe("runTick: the Shiner timeline end to end", () => {
  it("door reminder, pre-arrival, night-before check, polling, landed messages, exactly once each", async () => {
    const h = harness(makeGuest({ doorInvited: false }));

    await h.tick("2026-09-16T12:00:00Z");
    expect(h.pushes).toHaveLength(0);

    await h.tick("2026-09-17T13:05:00Z");
    await h.tick("2026-09-17T13:10:00Z");
    expect(titles(h.pushes)).toEqual(["Send the Door invite"]);

    await h.tick("2026-09-18T14:05:00Z");
    await h.tick("2026-09-18T14:10:00Z");
    expect(h.emails.map((e) => e.subject)).toEqual(["your atlanta landing plan (so you don't have to think)"]);
    expect(h.fetchFlight).not.toHaveBeenCalled();

    h.flights.push(snap());
    await h.tick("2026-09-20T00:05:00Z");            // 8:05pm ET night before
    await h.tick("2026-09-20T00:10:00Z");            // before departure window: no poll
    expect(h.fetchFlight).toHaveBeenCalledTimes(1);

    h.flights.push(snap({ state: "departed" }), snap({ state: "departed", gate: "T5", concourse: "T" }));
    await h.tick("2026-09-20T09:35:00Z");
    await h.tick("2026-09-20T09:40:00Z");            // 5 min later, 10-min cadence: no poll
    await h.tick("2026-09-20T09:45:00Z");
    expect(h.fetchFlight).toHaveBeenCalledTimes(3);

    h.flights.push(snap({ state: "landed", gate: "T5", concourse: "T", landedAt: "2026-09-20T11:58:00.000Z" }));
    const g = await h.tick("2026-09-20T12:00:00Z");
    expect(h.fetchFlight).toHaveBeenCalledTimes(4);
    expect(g.tracking.state).toBe("landed");

    const landed = h.emails[1];
    expect(landed.subject).toBe("you landed!! here's how to get to me");
    expect(landed.text).toContain("best case scenario");  // concourse.walk-t
    expect(landed.text).toContain("turn RIGHT toward the NORTH side");
    expect(landed.text).toContain("7Q");                  // home placeholders filled
    expect(h.texts).toHaveLength(1);
    expect(h.texts[0].body).toContain("you're in T");
    expect(h.texts[0].body).toContain(`/arrive/${g.token}`);
    const landedPush = h.pushes.find((p) => p.title === "Guest landed")!;
    expect(landedPush.body).toContain("T5");
    expect(landedPush.body).toContain("email: sent");
    expect(landedPush.body).toContain("text: sent");

    await h.tick("2026-09-20T12:05:00Z");
    expect(h.fetchFlight).toHaveBeenCalledTimes(4);
    expect(h.emails).toHaveLength(2);
    expect(h.texts).toHaveLength(1);
    expect(titles(h.pushes).filter((t) => t === "Guest landed")).toHaveLength(1);
  });
});

describe("runTick: alerts", () => {
  it("one delay alert per 30-minute band", async () => {
    const h = harness(makeGuest({ ...settled, tracking: inFlight() }));
    h.flights.push(snap({ state: "departed", estimatedArrival: "2026-09-20T13:00:00.000Z" }));
    await h.tick("2026-09-20T11:10:00Z");
    h.flights.push(snap({ state: "departed", estimatedArrival: "2026-09-20T13:15:00.000Z" }));
    await h.tick("2026-09-20T11:20:00Z");
    h.flights.push(snap({ state: "departed", estimatedArrival: "2026-09-20T13:30:00.000Z" }));
    await h.tick("2026-09-20T11:30:00Z");
    expect(h.pushes.filter((p) => p.title === "Guest flight delayed").map((p) => p.body)).toEqual([
      expect.stringContaining("35 min late"), expect.stringContaining("65 min late"),
    ]);
  });
  it("gate change alerts once, first gate assignment does not", async () => {
    const h = harness(makeGuest({ ...settled, tracking: inFlight() }));
    h.flights.push(snap({ state: "departed", gate: "B12", concourse: "B" }), snap({ state: "departed", gate: "C3", concourse: "C" }), snap({ state: "departed", gate: "C3", concourse: "C" }));
    await h.tick("2026-09-20T11:10:00Z");
    await h.tick("2026-09-20T11:20:00Z");
    await h.tick("2026-09-20T11:30:00Z");
    expect(h.pushes.filter((p) => p.title === "Guest gate change").map((p) => p.body)).toEqual([expect.stringContaining("B12 -> C3")]);
  });
  it("three tracking errors: one high-priority alert, nothing to the guest", async () => {
    const h = harness(makeGuest({ ...settled, tracking: inFlight() }));
    await h.tick("2026-09-20T11:10:00Z");
    await h.tick("2026-09-20T11:20:00Z");
    await h.tick("2026-09-20T11:30:00Z");
    await h.tick("2026-09-20T11:40:00Z");
    const fails = h.pushes.filter((p) => p.title === "Flight tracking failing");
    expect(fails).toHaveLength(1);
    expect(fails[0].priority).toBe("high");
    expect(h.emails).toHaveLength(0);
    expect(h.texts).toHaveLength(0);
  });
  it("cancelled: high alert, no sends, polling stops", async () => {
    const h = harness(makeGuest({ ...settled, tracking: inFlight() }));
    h.flights.push(snap({ state: "cancelled" }));
    await h.tick("2026-09-20T11:10:00Z");
    await h.tick("2026-09-20T11:20:00Z");
    expect(h.fetchFlight).toHaveBeenCalledTimes(1);
    expect(titles(h.pushes)).toEqual(["Guest flight cancelled"]);
    expect(h.emails).toHaveLength(0);
  });
  it("a one-shot alert survives an ntfy failure and is delivered on the next tick", async () => {
    const h = harness(makeGuest({ ...settled, tracking: inFlight() }));
    h.flights.push(snap({ state: "cancelled" }));
    h.sendNtfy.mockImplementationOnce(async () => ({ ok: false, error: "ntfy down" }));
    await h.tick("2026-09-20T11:10:00Z");
    expect(h.pushes).toHaveLength(0); // the override above doesn't record to h.pushes
    await h.tick("2026-09-20T11:20:00Z");
    expect(titles(h.pushes)).toEqual(["Guest flight cancelled"]);
    await h.tick("2026-09-20T11:30:00Z");
    expect(titles(h.pushes)).toEqual(["Guest flight cancelled"]); // not re-delivered once acknowledged
  });
  it("not found on the night-before check, then hourly from 5am ET", async () => {
    const h = harness(makeGuest(settled));
    h.flights.push({ ok: true, snapshot: null }, { ok: true, snapshot: null }, { ok: true, snapshot: null });
    await h.tick("2026-09-20T00:05:00Z");
    expect(titles(h.pushes)).toEqual(["Guest flight not found"]);
    await h.tick("2026-09-20T08:30:00Z");   // 4:30am ET
    await h.tick("2026-09-20T09:05:00Z");   // 5:05am ET
    await h.tick("2026-09-20T09:35:00Z");   // 30 min later
    await h.tick("2026-09-20T10:06:00Z");
    expect(h.fetchFlight).toHaveBeenCalledTimes(3);
    expect(titles(h.pushes)).toEqual(["Guest flight not found"]);
  });
  it("AeroDataBox cap: no fetch, one alert; unset cap alerts too", async () => {
    const h = harness(makeGuest({ ...settled, tracking: inFlight() }), { monthlyCap: 2 });
    await h.counters.increment("aerodatabox:2026-09");
    await h.counters.increment("aerodatabox:2026-09");
    await h.tick("2026-09-20T11:10:00Z");
    await h.tick("2026-09-20T11:20:00Z");
    expect(h.fetchFlight).not.toHaveBeenCalled();
    expect(titles(h.pushes)).toEqual(["AeroDataBox cap reached"]);
    const u = harness(makeGuest({ ...settled, tracking: inFlight() }), { monthlyCap: 0 });
    await u.tick("2026-09-20T11:10:00Z");
    expect(u.fetchFlight).not.toHaveBeenCalled();
    expect(titles(u.pushes)).toEqual(["Flight tracking is off"]);
  });
  it("timeline alerts: no email, no flight, visit over", async () => {
    const h = harness(makeGuest({ doorInvited: true, email: null, flight: null }));
    await h.tick("2026-09-20T01:00:00Z");
    expect(titles(h.pushes).sort()).toEqual(["Guest has no email", "Guest has no flight"]);
    await h.tick("2026-09-26T04:05:00Z");   // Sep 26 00:05 ET = departDate + 3d
    expect(titles(h.pushes)).toContain("Guest visit over");
  });
});

describe("runTick: safety bounds", () => {
  it("no-schedule polling stops the day after the flight date (bounded, so a bad flight number can't burn the cap forever)", async () => {
    const h = harness(makeGuest({ ...settled, tracking: { ...emptyTracking(), lastCheckedAt: "2026-09-20T09:05:00.000Z" } }));
    await h.tick("2026-09-21T05:00:00Z"); // 1am ET the day after the flight date
    expect(h.fetchFlight).not.toHaveBeenCalled();
  });
  it("an expired guest is never polled, even with a live schedule that never resolved", async () => {
    // scheduledArrival far in the future so the ordinary "6h past latest estimate" cutoff doesn't
    // itself block polling -- only the isExpired guard should.
    const h = harness(makeGuest({ ...settled, tracking: inFlight({ scheduledArrival: "2026-09-30T12:25:00.000Z" }) }));
    await h.tick("2026-09-26T05:00:00Z"); // 1am ET, past departDate + 3d
    expect(h.fetchFlight).not.toHaveBeenCalled();
  });
  it("pre-arrival never sends once the flight is cancelled or diverted", async () => {
    const h = harness(makeGuest({ tracking: { ...emptyTracking(), state: "cancelled" } }));
    await h.tick("2026-09-18T14:05:00Z"); // inside the pre-arrival window
    expect(h.emails).toHaveLength(0);
  });
});

describe("runTick: landed sends", () => {
  const landedGuest = (o: Partial<Guest> = {}, t: Partial<Guest["tracking"]> = {}) =>
    makeGuest({ ...settled, ...o, tracking: inFlight({ state: "landed", gate: "B12", concourse: "B", landedAt: "2026-09-20T12:20:00.000Z", lastCheckedAt: "2026-09-20T12:20:00.000Z", ...t }) });

  it("no gate from tracking: the pick-your-concourse version, and the push says so", async () => {
    const h = harness(landedGuest({}, { gate: null, concourse: null }));
    await h.tick("2026-09-20T12:25:00Z");
    expect(h.emails[0].text).toContain("check the letter on your gate");
    expect(h.pushes.find((p) => p.title === "Guest landed")!.body).toContain("no gate");
  });
  it("unknown bag: the text covers both cases", async () => {
    const h = harness(landedGuest({ checkedBag: null }));
    await h.tick("2026-09-20T12:25:00Z");
    expect(h.texts[0].body).toContain("no bag:");
    expect(h.texts[0].body).toContain("checked bag:");
  });
  it("a landing more than 6h old sends nothing", async () => {
    const h = harness(landedGuest({}, { landedAt: "2026-09-20T05:00:00.000Z" }));
    await h.tick("2026-09-20T12:25:00Z");
    expect(h.emails).toHaveLength(0);
    expect(h.texts).toHaveLength(0);
    const late = h.pushes.find((p) => p.title === "Guest landed, nothing sent")!;
    expect(late).toBeTruthy();
    expect(late.priority).toBe("high");
    expect(late.body).toContain("1:00am"); // 05:00Z = 1am ET
  });
  it("landed with no landedAt at all still alerts Zach, no guest send", async () => {
    const h = harness(landedGuest({}, { landedAt: null }));
    await h.tick("2026-09-20T12:25:00Z");
    expect(h.emails).toHaveLength(0);
    expect(h.texts).toHaveLength(0);
    const late = h.pushes.find((p) => p.title === "Guest landed, nothing sent")!;
    expect(late).toBeTruthy();
    expect(late.body).toContain("no landing time");
  });
  it("sms disabled: recorded as skipped, reported, never retried", async () => {
    const h = harness(landedGuest(), { sms: () => ({ ok: false, skipped: true, reason: "sms disabled" }) });
    const g = await h.tick("2026-09-20T12:25:00Z");
    expect(g.sends.landedSms?.status).toBe("skipped");
    expect(h.pushes.find((p) => p.title === "Guest landed")!.body).toContain("text: skipped");
    await h.tick("2026-09-20T12:30:00Z");
    expect(h.texts).toHaveLength(1);
  });
  it("a failing email is tried 3 times across ticks, then alerts once", async () => {
    const h = harness(landedGuest({ phone: null }), { email: () => ({ ok: false, error: "resend 500" }) });
    for (const t of ["12:25", "12:30", "12:35", "12:40", "12:45"]) await h.tick(`2026-09-20T${t}:00Z`);
    expect(h.emails).toHaveLength(3);
    expect(titles(h.pushes).filter((t) => t === "Guest message failed")).toHaveLength(1);
  });
  it("a stuck 'sending' lease is never resent and alerts", async () => {
    const h = harness(landedGuest({ sends: { ...settled.sends, landedEmail: { status: "sending", at: "2026-09-20T12:10:00.000Z", attempts: 1 } } }));
    const g = await h.tick("2026-09-20T12:25:00Z");
    expect(h.emails).toHaveLength(0);
    expect(g.sends.landedEmail).toMatchObject({ status: "failed", attempts: 3 });
    expect(titles(h.pushes)).toContain("Guest message unclear");
    expect(h.texts).toHaveLength(1);
  });
  it("the lease is persisted before the provider is called", async () => {
    const h = harness(landedGuest({ phone: null }));
    let observed: string | undefined;
    h.sendEmail.mockImplementationOnce(async () => {
      observed = (await h.store.get("testy-abc123"))!.sends.landedEmail?.status;
      return { ok: true, id: "em1" };
    });
    await h.tick("2026-09-20T12:25:00Z");
    expect(observed).toBe("sending");
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });
  it("international unknown: sends domestic steps and says it couldn't tell", async () => {
    const h = harness(landedGuest({}, { international: null }));
    await h.tick("2026-09-20T12:25:00Z");
    expect(h.pushes.find((p) => p.title === "Guest landed")!.body).toContain("couldn't tell if the flight was international");
  });
});
