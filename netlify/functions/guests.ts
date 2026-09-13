import { timingSafeEqual } from "node:crypto";
import { blobGuestStore } from "../../src/server/guests/store";
import { parseCreate, parsePatch, newGuest, applyPatch } from "../../src/server/guests/validate";
import { sendNtfy } from "../../src/server/guests/ntfy";
import { siteUrl, pageUrl } from "../../src/server/guests/view";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

function authorized(req: Request, key: string): boolean {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${key}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export default async function handler(req: Request): Promise<Response> {
  const key = process.env.GUEST_API_KEY;
  if (!key) return json({ error: "GUEST_API_KEY not set" }, 500);
  if (!authorized(req, key)) return json({ error: "unauthorized" }, 401);

  const store = blobGuestStore();
  const site = siteUrl();
  const id = new URL(req.url).searchParams.get("id");

  try {
    switch (req.method) {
      case "GET": {
        const guests = await store.list();
        return json({ guests: guests.map((g) => ({ ...g, pageUrl: pageUrl(site, g) })) });
      }
      case "POST": {
        const p = parseCreate(await req.json().catch(() => undefined));
        if (!p.ok) return json({ errors: p.errors }, 400);
        const g = newGuest(p.value, new Date());
        await store.put(g);
        const url = pageUrl(site, g);
        const r = await sendNtfy({
          title: "Guest added",
          body: `${g.name}, ${g.arriveDate} to ${g.departDate}${g.flight ? `, ${g.flight.number}` : ", no flight yet"}.\n${url}`,
          click: url,
        });
        if (r.ok) { g.alertsSent.push("created"); await store.put(g); }
        else console.warn("[guests] ntfy failed:", r.error);
        return json({ guest: g, pageUrl: url }, 201);
      }
      case "PATCH": {
        if (!id) return json({ error: "id query param required" }, 400);
        const g = await store.get(id);
        if (!g) return json({ error: "not found" }, 404);
        const p = parsePatch(await req.json().catch(() => undefined));
        if (!p.ok) return json({ errors: p.errors }, 400);
        const next = applyPatch(g, p.value);
        if (next.departDate < next.arriveDate) return json({ errors: ["departDate is before arriveDate"] }, 400);
        await store.put(next);
        return json({ guest: next, pageUrl: pageUrl(site, next) });
      }
      case "DELETE": {
        if (!id) return json({ error: "id query param required" }, 400);
        if (!(await store.get(id))) return json({ error: "not found" }, 404);
        await store.remove(id);
        return json({ ok: true });
      }
      default:
        return json({ error: "method not allowed" }, 405);
    }
  } catch (err) {
    console.error("[guests]", err);
    return json({ error: "internal error" }, 500);
  }
}

export const config = { path: "/api/guests" };
