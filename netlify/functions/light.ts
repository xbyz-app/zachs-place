import { callHA, isAllowed } from "./_ha";

const LIGHT_ENTITIES = new Map<string, string>([
  ["tv_bars", "light.office_tv_light_bars"]
]);

interface Body {
  entity?: string;
  brightness?: number;
  rgb_color?: [number, number, number];
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

  const entityId = LIGHT_ENTITIES.get(body.entity ?? "");
  if (!entityId || !isAllowed(entityId)) {
    return new Response(JSON.stringify({ error: "unknown entity" }), { status: 400 });
  }

  const turningOff = body.state === "off";
  const service = turningOff ? "turn_off" : "turn_on";
  const payload: Record<string, unknown> = { entity_id: entityId };
  if (!turningOff) {
    if (body.brightness !== undefined) payload.brightness = body.brightness;
    if (body.rgb_color !== undefined) payload.rgb_color = body.rgb_color;
  }

  try {
    await callHA(`/api/services/light/${service}`, { method: "POST", body: payload });
    return Response.json({ ok: true });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 503 });
  }
}

export const config = { path: "/api/light" };
