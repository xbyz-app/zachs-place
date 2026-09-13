import { blobGuestStore, findByToken } from "../../src/server/guests/store";
import { homeFromEnv } from "../../src/server/guests/home";
import { isExpired, pageModel } from "../../src/server/guests/view";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: HEADERS });

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
  const token = new URL(req.url).searchParams.get("token") ?? "";
  try {
    const g = await findByToken(blobGuestStore(), token);
    if (!g) return json({ error: "not found" }, 404);
    if (isExpired(g, new Date())) return json({ error: "expired" }, 410);
    const home = homeFromEnv();
    if (!home.ok) {
      console.error("[arrive]", home.error);
      return json({ error: "misconfigured" }, 500);
    }
    return json(pageModel(g, home.home, process.env.ZACH_PHONE ?? null));
  } catch (err) {
    console.error("[arrive]", err);
    return json({ error: "internal error" }, 500);
  }
}

export const config = { path: "/api/arrive" };
