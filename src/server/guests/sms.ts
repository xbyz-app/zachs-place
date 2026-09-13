import type { SendResult } from "./email";

// Texts need US carrier registration (10DLC / toll-free) before Twilio will deliver them.
// Until that's approved, GUEST_SMS_ENABLED stays unset and every text is recorded as skipped.
export async function sendSms(msg: { to: string; body: string }): Promise<SendResult> {
  if (process.env.GUEST_SMS_ENABLED !== "true") return { ok: false, skipped: true, reason: "sms disabled (GUEST_SMS_ENABLED)" };
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { ok: false, error: "Twilio env vars missing" };
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: from, To: msg.to, Body: msg.body }).toString(),
      signal: AbortSignal.timeout(5000),
    });
    const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) return { ok: false, error: `twilio ${res.status}: ${body.message ?? ""}`.trim() };
    return { ok: true, id: body.sid ?? "unknown" };
  } catch (e) {
    return { ok: false, error: `twilio unreachable: ${(e as Error).message}` };
  }
}
