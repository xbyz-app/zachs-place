export interface NtfyMessage { title: string; body: string; click?: string; priority?: "default" | "high" }

// Header values must be Latin1 or fetch throws before sending; keep them printable ASCII.
const ascii = (s: string) => s.replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "?");

// A 2xx means ntfy ACCEPTED the message, not that a phone received it.
export async function sendNtfy(msg: NtfyMessage): Promise<{ ok: true } | { ok: false; error: string }> {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return { ok: false, error: "NTFY_TOPIC not set" };
  try {
    const headers: Record<string, string> = { Title: ascii(msg.title), Tags: "house" };
    if (msg.priority) headers.Priority = msg.priority;
    if (msg.click) headers.Click = ascii(encodeURI(msg.click));
    const res = await fetch(`https://ntfy.sh/${topic}`, { method: "POST", headers, body: msg.body, signal: AbortSignal.timeout(3000) });
    return res.ok ? { ok: true } : { ok: false, error: `ntfy ${res.status}` };
  } catch (e) {
    return { ok: false, error: `ntfy unreachable: ${(e as Error).message}` };
  }
}
