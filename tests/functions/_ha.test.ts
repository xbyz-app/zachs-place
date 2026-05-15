import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callHA, ENTITY_ALLOWLIST, isAllowed } from "../../netlify/functions/_ha";

const ORIGINAL_FETCH = global.fetch;

describe("ENTITY_ALLOWLIST", () => {
  it("contains exactly the 4 guest-permitted entities", () => {
    expect(ENTITY_ALLOWLIST).toEqual([
      "light.office_tv_light_bars",
      "switch.live_nudes",
      "switch.lava_lamp",
      "media_player.zachs_office"
    ]);
  });
});

describe("isAllowed", () => {
  it("returns true for allowlisted entities", () => {
    expect(isAllowed("light.office_tv_light_bars")).toBe(true);
    expect(isAllowed("switch.live_nudes")).toBe(true);
  });
  it("returns false for anything else", () => {
    expect(isAllowed("light.kitchen_chandelier")).toBe(false);
    expect(isAllowed("switch.entry_lamp")).toBe(false);
    expect(isAllowed("")).toBe(false);
  });
});

describe("callHA", () => {
  beforeEach(() => {
    process.env.HA_BASE_URL = "https://example.ui.nabu.casa";
    process.env.HA_GUEST_TOKEN = "test-token";
  });
  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    delete process.env.HA_BASE_URL;
    delete process.env.HA_GUEST_TOKEN;
  });

  it("GETs with Bearer auth", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: "on" })
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const result = await callHA("/api/states/light.office_tv_light_bars");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.ui.nabu.casa/api/states/light.office_tv_light_bars",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token"
        })
      })
    );
    expect(result).toEqual({ state: "on" });
  });

  it("POSTs JSON with Bearer auth", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({})
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    await callHA("/api/services/light/turn_on", {
      method: "POST",
      body: { entity_id: "light.office_tv_light_bars", brightness: 128 }
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.ui.nabu.casa/api/services/light/turn_on",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "application/json"
        }),
        body: JSON.stringify({ entity_id: "light.office_tv_light_bars", brightness: 128 })
      })
    );
  });

  it("throws HaUnreachable when HA returns non-ok", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "bad gateway"
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    await expect(callHA("/api/states/light.office_tv_light_bars")).rejects.toThrow("HA unreachable");
  });

  it("throws HaUnreachable when fetch itself rejects", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    await expect(callHA("/api/states/light.office_tv_light_bars")).rejects.toThrow("HA unreachable");
  });

  it("throws if env vars are missing", async () => {
    delete process.env.HA_BASE_URL;
    await expect(callHA("/api/states/x")).rejects.toThrow("HA_BASE_URL not set");
  });
});
