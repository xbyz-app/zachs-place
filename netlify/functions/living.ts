import { callHA } from "./_ha";

// Living room controls for guests. Every write goes through one of Pat's own
// scripts or scenes, never a raw light call, so a guest tap is logged, holds
// and respects the CO alarm exactly like a tap on the kitchen tablet.
// No entity id ever comes from the client: the action names a fixed call.

export const LEVELS = ["low", "normal", "bright"] as const;
export const ACTIONS = [...LEVELS, "chill", "off"] as const;
export type LivingAction = typeof ACTIONS[number];

// The open plan, as script.set_living_brightness drives it.
export const OPEN_PLAN_ZONES = ["kitchen", "gallery", "chandelier", "uplighting", "tv_corner", "fan_ring"] as const;
const ZONE_LIGHTS = [
  "light.kitchen",
  "light.gallery_wall",
  "light.chandelier",
  "light.uplighting",
  "light.tv_corner",
  "light.air_circulator_rgb_light"
] as const;

interface HAState { state: string }

/** Which chip reads as active. Off wins when every open-plan light is off,
 * then an active Chill scene, then the Living Space level. A level outside
 * the three chips (Full, set from the tablet) lights none. */
export function livingActive(level: string, scene: string, lightStates: string[]): LivingAction | null {
  const known = lightStates.filter((s) => s === "on" || s === "off");
  if (known.length > 0 && known.every((s) => s === "off")) return "off";
  if (scene === "Chill") return "chill";
  const l = level.toLowerCase();
  return (LEVELS as readonly string[]).includes(l) ? (l as LivingAction) : null;
}

async function readState(): Promise<Response> {
  const [level, scene, ...lights] = (await Promise.all([
    callHA("/api/states/input_select.living_brightness"),
    callHA("/api/states/input_select.current_scene"),
    ...ZONE_LIGHTS.map((e) => callHA(`/api/states/${e}`))
  ])) as HAState[];
  return Response.json({ active: livingActive(level.state, scene.state, lights.map((l) => l.state)) });
}

async function apply(action: LivingAction): Promise<void> {
  if (action === "chill") {
    await callHA("/api/services/scene/turn_on", { method: "POST", body: { entity_id: "scene.chill" } });
    return;
  }
  if (action === "off") {
    await Promise.all(
      OPEN_PLAN_ZONES.map((zone) =>
        callHA("/api/services/script/set_zone_off", { method: "POST", body: { zone } })
      )
    );
    return;
  }
  const level = action.charAt(0).toUpperCase() + action.slice(1);
  await callHA("/api/services/script/set_living_brightness", { method: "POST", body: { level } });
}

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method === "GET") return await readState();
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    let body: { action?: string };
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid json" }, { status: 400 });
    }
    const action = body.action ?? "";
    if (!(ACTIONS as readonly string[]).includes(action)) {
      return Response.json({ error: "unknown action" }, { status: 400 });
    }
    await apply(action as LivingAction);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 503 });
  }
}

export const config = { path: "/api/living" };
