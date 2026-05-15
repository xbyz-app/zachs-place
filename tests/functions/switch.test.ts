import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  process.env.HA_BASE_URL = "https://example.ui.nabu.casa";
  process.env.HA_GUEST_TOKEN = "test-token";
});
afterEach(() => { global.fetch = ORIGINAL_FETCH; });

describe("/api/switch handler", () => {
  it("toggles live_nudes on", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = mockFetch as unknown as typeof fetch;

    const { default: handler } = await import("../../netlify/functions/switch");
    const res = await handler(new Request("https://lab.xbyz.fun/api/switch", {
      method: "POST",
      body: JSON.stringify({ entity: "live_nudes", state: "on" })
    }));

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.ui.nabu.casa/api/services/switch/turn_on",
      expect.objectContaining({
        body: JSON.stringify({ entity_id: "switch.live_nudes" })
      })
    );
  });

  it("toggles lava_lamp off", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = mockFetch as unknown as typeof fetch;

    const { default: handler } = await import("../../netlify/functions/switch");
    await handler(new Request("https://lab.xbyz.fun/api/switch", {
      method: "POST",
      body: JSON.stringify({ entity: "lava_lamp", state: "off" })
    }));

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.ui.nabu.casa/api/services/switch/turn_off",
      expect.objectContaining({
        body: JSON.stringify({ entity_id: "switch.lava_lamp" })
      })
    );
  });

  it("rejects unknown entity", async () => {
    const { default: handler } = await import("../../netlify/functions/switch");
    const res = await handler(new Request("https://lab.xbyz.fun/api/switch", {
      method: "POST",
      body: JSON.stringify({ entity: "stroh_neon", state: "on" })
    }));
    expect(res.status).toBe(400);
  });
});
