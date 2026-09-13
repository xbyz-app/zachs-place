import { runTick } from "../../src/server/guests/tick";
import { blobGuestStore, blobCounterStore } from "../../src/server/guests/store";
import { fetchFlight } from "../../src/server/guests/flight";
import { sendEmail } from "../../src/server/guests/email";
import { sendSms } from "../../src/server/guests/sms";
import { sendNtfy } from "../../src/server/guests/ntfy";
import { homeFromEnv } from "../../src/server/guests/home";
import { siteUrl } from "../../src/server/guests/view";
import { etParts } from "../../src/lib/arrival/time";

export default async function handler(): Promise<Response> {
  const now = new Date();
  const counters = blobCounterStore();
  const home = homeFromEnv();
  if (!home.ok) {
    const key = `alert:home-config:${etParts(now).date}`;
    if ((await counters.get(key)) === 0) {
      const r = await sendNtfy({ title: "Guest system misconfigured", priority: "high", body: `${home.error}. guest-tick does nothing until it's fixed.` });
      if (r.ok) await counters.increment(key);
    }
    console.error("[guest-tick]", home.error);
    return new Response(home.error, { status: 500 });
  }
  const cap = Number(process.env.AERODATABOX_MONTHLY_CAP);
  const summary = await runTick({
    store: blobGuestStore(), counters, fetchFlight, sendEmail, sendSms, sendNtfy, now,
    siteUrl: siteUrl(), home: home.home, zachPhone: process.env.ZACH_PHONE ?? null,
    monthlyCap: Number.isFinite(cap) && cap > 0 ? cap : 0,
  });
  console.log("[guest-tick]", JSON.stringify(summary));
  return Response.json(summary);
}

export const config = { schedule: "*/5 * * * *" };
