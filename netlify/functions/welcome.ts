import { blobGuestStore } from "../../src/server/guests/store";
import { stayingNames } from "../../src/lib/welcome";

// Public: the guest page is reached by anyone with the link, so this answers
// with first names only, and only for a stay that covers today.
const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") return Response.json({ error: "method not allowed" }, { status: 405, headers: HEADERS });
  try {
    const names = stayingNames(await blobGuestStore().list(), new Date());
    return Response.json({ names }, { headers: HEADERS });
  } catch (err) {
    console.error("[welcome]", err);
    return Response.json({ names: [] }, { headers: HEADERS });
  }
}

export const config = { path: "/api/welcome" };
