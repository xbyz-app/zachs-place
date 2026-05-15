import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  process.env.HA_BASE_URL = "https://example.ui.nabu.casa";
  process.env.HA_GUEST_TOKEN = "test-token";
});
afterEach(() => { global.fetch = ORIGINAL_FETCH; });

describe("/api/light handler", () => {
  it("calls light.turn_on with brightness + rgb_color", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = mockFetch as unknown as typeof fetch;

    const { default: handler } = await import("./light");
    const res = await handler(new Request("https://lab.xbyz.fun/api/light", {
      method: "POST",
      body: JSON.stringify({ entity: "tv_bars", brightness: 200, rgb_color: [255, 150, 80] })
    }));

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.ui.nabu.casa/api/services/light/turn_on",
      expect.objectContaining({
        body: JSON.stringify({ entity_id: "light.office_tv_light_bars", brightness: 200, rgb_color: [255, 150, 80] })
      })
    );
  });

  it("calls light.turn_off when state is off", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = mockFetch as unknown as typeof fetch;

    const { default: handler } = await import("./light");
    await handler(new Request("https://lab.xbyz.fun/api/light", {
      method: "POST",
      body: JSON.stringify({ entity: "tv_bars", state: "off" })
    }));

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.ui.nabu.casa/api/services/light/turn_off",
      expect.objectContaining({
        body: JSON.stringify({ entity_id: "light.office_tv_light_bars" })
      })
    );
  });

  it("rejects unknown entity with 400", async () => {
    const { default: handler } = await import("./light");
    const res = await handler(new Request("https://lab.xbyz.fun/api/light", {
      method: "POST",
      body: JSON.stringify({ entity: "kitchen_chandelier", brightness: 100 })
    }));
    expect(res.status).toBe(400);
  });

  it("rejects non-POST with 405", async () => {
    const { default: handler } = await import("./light");
    const res = await handler(new Request("https://lab.xbyz.fun/api/light", { method: "GET" }));
    expect(res.status).toBe(405);
  });
});
