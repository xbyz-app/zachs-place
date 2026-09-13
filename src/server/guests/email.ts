export type SendResult =
  | { ok: true; id: string }
  | { ok: false; skipped?: false; error: string }
  | { ok: false; skipped: true; reason: string };

export async function sendEmail(msg: { to: string; subject: string; html: string; text: string }): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.GUEST_EMAIL_FROM;
  const replyTo = process.env.ZACH_REPLY_TO;
  if (!key || !from) return { ok: false, error: "RESEND_API_KEY or GUEST_EMAIL_FROM not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: `resend ${res.status}: ${body.message ?? ""}`.trim() };
    if (!body.id) return { ok: false, error: "resend returned no id" };
    return { ok: true, id: body.id };
  } catch (e) {
    return { ok: false, error: `resend unreachable: ${(e as Error).message}` };
  }
}
