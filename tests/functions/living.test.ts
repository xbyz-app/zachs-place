import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_FETCH = global.fetch;
const BASE = "https://example.ui.nabu.casa";

beforeEach(() => {
  process.env.HA_BASE_URL = BASE;
  process.env.HA_GUEST_TOKEN = "test-token";
});
afterEach(() => { global.fetch = ORIGINAL_FETCH; });

function okFetch() {
  const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  global.fetch = f as unknown as typeof fetch;
  return f;
}

async function post(action: unknown) {
  const { default: handler } = await import("../../netlify/functions/living");
  return handler(new Request("https://guest.xbyz.fun/api/living", {
    method: "POST",
    body: JSON.stringify({ action })
  }));
}

function calls(f: ReturnType<typeof vi.fn>) {
  return f.mock.calls.map(([url, init]) => [url, JSON.parse((init as RequestInit).body as string)]);
}

describe("/api/living POST", () => {
  it.each([["low", "Low"], ["normal", "Normal"], ["bright", "Bright"]])(
    "%s goes through the Living Space master",
    async (action, level) => {
      const f = okFetch();
      const res = await post(action);
      expect(res.status).toBe(200);
      expect(calls(f)).toEqual([[`${BASE}/api/services/script/set_living_brightness`, { level }]]);
    }
  );

  it("chill turns on the Chill scene", async () => {
    const f = okFetch();
    await post("chill");
    expect(calls(f)).toEqual([[`${BASE}/api/services/scene/turn_on`, { entity_id: "scene.chill" }]]);
  });

  it("off turns off each open-plan zone through set_zone_off, nothing else", async () => {
    const f = okFetch();
    await post("off");
    const urls = calls(f).map(([u]) => u);
    expect(new Set(urls)).toEqual(new Set([`${BASE}/api/services/script/set_zone_off`]));
    expect(calls(f).map(([, b]) => b.zone).sort()).toEqual(
      ["chandelier", "fan_ring", "gallery", "kitchen", "tv_corner", "uplighting"]
    );
  });

  it.each(["full", "movie", "light.chandelier", "", 7])("rejects %s", async (action) => {
    const f = okFetch();
    const res = await post(action);
    expect(res.status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("returns 503 when HA is unreachable", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("timeout")) as unknown as typeof fetch;
    const res = await post("bright");
    expect(res.status).toBe(503);
  });
});

describe("/api/living GET", () => {
  function stateFetch(level: string, scene: string, lights: string) {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      let state = lights;
      if (url.endsWith("input_select.living_brightness")) state = level;
      if (url.endsWith("input_select.current_scene")) state = scene;
      return Promise.resolve({ ok: true, json: async () => ({ state, attributes: {} }) });
    }) as unknown as typeof fetch;
  }

  it("reports the level when lights are on", async () => {
    stateFetch("Bright", "Off", "on");
    const { default: handler } = await import("../../netlify/functions/living");
    const res = await handler(new Request("https://guest.xbyz.fun/api/living"));
    expect(await res.json()).toEqual({ active: "bright" });
  });
});

describe("livingActive", () => {
  it("off when every known light is off, even under a scene", async () => {
    const { livingActive } = await import("../../netlify/functions/living");
    expect(livingActive("Bright", "Chill", ["off", "off", "unavailable"])).toBe("off");
  });
  it("chill beats the level", async () => {
    const { livingActive } = await import("../../netlify/functions/living");
    expect(livingActive("Normal", "Chill", ["on", "off"])).toBe("chill");
  });
  it("Full lights no chip; all-unavailable is not off", async () => {
    const { livingActive } = await import("../../netlify/functions/living");
    expect(livingActive("Full", "Off", ["on"])).toBeNull();
    expect(livingActive("Low", "Off", ["unavailable"])).toBe("low");
  });
});
