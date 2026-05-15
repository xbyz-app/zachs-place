import { callHA } from "./_ha";

interface HAStateResponse {
  state: string;
  attributes: Record<string, unknown>;
}

export default async function handler(_req: Request): Promise<Response> {
  try {
    const [tvBars, igLogo, liveNudes, lavaLamp, sonos] = await Promise.all([
      callHA("/api/states/light.office_tv_light_bars") as Promise<HAStateResponse>,
      callHA("/api/states/light.ig_logo") as Promise<HAStateResponse>,
      callHA("/api/states/switch.live_nudes") as Promise<HAStateResponse>,
      callHA("/api/states/switch.lava_lamp") as Promise<HAStateResponse>,
      callHA("/api/states/media_player.zachs_office") as Promise<HAStateResponse>
    ]);

    return Response.json({
      tv_bars: {
        state: tvBars.state,
        brightness: tvBars.attributes.brightness ?? null,
        rgb_color: tvBars.attributes.rgb_color ?? null
      },
      ig_logo: {
        state: igLogo.state,
        rgb_color: igLogo.attributes.rgb_color ?? null
      },
      sonos: {
        volume_level: sonos.attributes.volume_level ?? null
      },
      live_nudes: { state: liveNudes.state },
      lava_lamp: { state: lavaLamp.state }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export const config = { path: "/api/state" };
