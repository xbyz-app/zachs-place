import { callHA, isAllowed } from "./_ha";

const SWITCH_ENTITIES = new Map<string, string>([
  ["live_nudes", "switch.live_nudes"],
  ["lava_lamp", "switch.lava_lamp"]
]);

interface Body {
  entity?: string;
  state?: "on" | "off";
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

  const entityId = SWITCH_ENTITIES.get(body.entity ?? "");
  if (!entityId || !isAllowed(entityId)) {
    return new Response(JSON.stringify({ error: "unknown entity" }), { status: 400 });
  }

  if (body.state !== "on" && body.state !== "off") {
    return new Response(JSON.stringify({ error: "state must be on|off" }), { status: 400 });
  }

  try {
    await callHA(`/api/services/switch/turn_${body.state}`, {
      method: "POST",
      body: { entity_id: entityId }
    });
    return Response.json({ ok: true });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 503 });
  }
}

export const config = { path: "/api/switch" };
