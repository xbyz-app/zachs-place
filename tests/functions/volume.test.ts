import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORIGINAL_FETCH = global.fetch;

beforeEach(() => {
  process.env.HA_BASE_URL = "https://example.ui.nabu.casa";
  process.env.HA_GUEST_TOKEN = "test-token";
});
afterEach(() => { global.fetch = ORIGINAL_FETCH; });

describe("/api/volume handler", () => {
  it("sets volume on office Sonos", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = mockFetch as unknown as typeof fetch;

    const { default: handler } = await import("../../netlify/functions/volume");
    const res = await handler(new Request("https://lab.xbyz.fun/api/volume", {
      method: "POST",
      body: JSON.stringify({ volume: 0.45 })
    }));

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.ui.nabu.casa/api/services/media_player/volume_set",
      expect.objectContaining({
        body: JSON.stringify({ entity_id: "media_player.zachs_office", volume_level: 0.45 })
      })
    );
  });

  it("rejects out-of-range volume", async () => {
    const { default: handler } = await import("../../netlify/functions/volume");
    const res = await handler(new Request("https://lab.xbyz.fun/api/volume", {
      method: "POST",
      body: JSON.stringify({ volume: 1.5 })
    }));
    expect(res.status).toBe(400);
  });

  it("rejects non-number volume", async () => {
    const { default: handler } = await import("../../netlify/functions/volume");
    const res = await handler(new Request("https://lab.xbyz.fun/api/volume", {
      method: "POST",
      body: JSON.stringify({ volume: "loud" })
    }));
    expect(res.status).toBe(400);
  });
});
