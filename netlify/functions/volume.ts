import { callHA } from "./_ha";

interface Body {
  volume?: unknown;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), { status: 400 });
  }

  const volume = body.volume;
  if (typeof volume !== "number" || volume < 0 || volume > 1) {
    return new Response(JSON.stringify({ error: "volume must be 0.0–1.0" }), { status: 400 });
  }

  try {
    await callHA("/api/services/media_player/volume_set", {
      method: "POST",
      body: { entity_id: "media_player.zachs_office", volume_level: volume }
    });
    return Response.json({ ok: true });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 503 });
  }
}

export const config = { path: "/api/volume" };
