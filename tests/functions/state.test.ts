import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  process.env.HA_BASE_URL = "https://example.ui.nabu.casa";
  process.env.HA_GUEST_TOKEN = "test-token";
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe("/api/state handler", () => {
  it("returns compact JSON with all 4 entity states", async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      const map: Record<string, unknown> = {
        "https://example.ui.nabu.casa/api/states/light.office_tv_light_bars": {
          entity_id: "light.office_tv_light_bars",
          state: "on",
          attributes: { brightness: 200, rgb_color: [255, 150, 80] }
        },
        "https://example.ui.nabu.casa/api/states/switch.live_nudes": {
          entity_id: "switch.live_nudes",
          state: "off",
          attributes: {}
        },
        "https://example.ui.nabu.casa/api/states/switch.lava_lamp": {
          entity_id: "switch.lava_lamp",
          state: "on",
          attributes: {}
        },
        "https://example.ui.nabu.casa/api/states/media_player.zachs_office": {
          entity_id: "media_player.zachs_office",
          state: "playing",
          attributes: { volume_level: 0.3 }
        }
      };
      return Promise.resolve({ ok: true, json: async () => map[url] });
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const { default: handler } = await import("../../netlify/functions/state");
    const res = await handler(new Request("https://lab.xbyz.fun/api/state"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      tv_bars: { state: "on", brightness: 200, rgb_color: [255, 150, 80] },
      sonos: { volume_level: 0.3 },
      live_nudes: { state: "off" },
      lava_lamp: { state: "on" }
    });
  });

  it("returns 503 when HA is unreachable", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("timeout")) as unknown as typeof fetch;
    const { default: handler } = await import("../../netlify/functions/state");
    const res = await handler(new Request("https://lab.xbyz.fun/api/state"));
    expect(res.status).toBe(503);
  });
});
