import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import handler, { shape, label, localDate } from "../../netlify/functions/weather";

const ORIGINAL_FETCH = global.fetch;
const BASE = "https://example.ui.nabu.casa";

const STATE = {
  entity_id: "weather.forecast_home",
  state: "clear-night",
  attributes: { temperature: 53.4, temperature_unit: "°F" }
};
const FORECAST = [
  { datetime: "2026-11-06T17:00:00+00:00", condition: "rainy", temperature: 60, templow: 50 },
  { datetime: "2026-11-07T17:00:00+00:00", condition: "partlycloudy", temperature: 65, templow: 49 },
  { datetime: "2026-11-08T17:00:00+00:00", condition: "sunny", temperature: 66, templow: 44 },
  { datetime: "2026-11-09T17:00:00+00:00", condition: "cloudy", temperature: 61, templow: 47 },
  { datetime: "2026-11-10T17:00:00+00:00", condition: "rainy", temperature: 58, templow: 45 }
];

beforeEach(() => {
  process.env.HA_BASE_URL = BASE;
  process.env.HA_GUEST_TOKEN = "test-token";
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe("label", () => {
  it("names HA conditions in plain words", () => {
    expect(label("partlycloudy")).toBe("Partly cloudy");
    expect(label("clear-night")).toBe("Clear");
    expect(label("some-new-thing")).toBe("some new thing");
  });
});

describe("localDate", () => {
  it("uses Atlanta's calendar, not UTC", () => {
    // 02:00 UTC on Nov 8 is still the evening of Nov 7 in Atlanta.
    expect(localDate(new Date("2026-11-08T02:00:00Z"))).toBe("2026-11-07");
  });
});

describe("shape", () => {
  it("returns now plus today and the next two days, dropping past days", () => {
    const w = shape(STATE, FORECAST, new Date("2026-11-07T11:00:00Z"));
    expect(w.now).toEqual({ condition: "clear-night", label: "Clear", temp: 53, unit: "°F" });
    expect(w.days.map((d) => d.date)).toEqual(["2026-11-07", "2026-11-08", "2026-11-09"]);
    expect(w.days[0]).toEqual({ date: "2026-11-07", condition: "partlycloudy", label: "Partly cloudy", high: 65, low: 49 });
  });

  it("copes with an empty forecast and a missing temperature", () => {
    const w = shape({ state: "sunny", attributes: {} }, [], new Date("2026-11-07T11:00:00Z"));
    expect(w.now.temp).toBeNull();
    expect(w.days).toEqual([]);
  });
});

describe("/api/weather handler", () => {
  it("reads the HA state and daily forecast with the guest token", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("get_forecasts")
          ? { changed_states: [], service_response: { "weather.forecast_home": { forecast: FORECAST } } }
          : STATE
    }));
    global.fetch = mockFetch as unknown as typeof fetch;

    const res = await handler(new Request("https://guest.xbyz.fun/api/weather"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=600");
    const body = await res.json();
    expect(body.now.label).toBe("Clear");
    expect(body.days.length).toBeGreaterThan(0);

    expect(mockFetch).toHaveBeenCalledWith(`${BASE}/api/states/weather.forecast_home`, expect.objectContaining({ method: "GET" }));
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE}/api/services/weather/get_forecasts?return_response`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ entity_id: "weather.forecast_home", type: "daily" }) })
    );
  });

  it("still shows current conditions when the forecast call fails", async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) =>
      url.includes("get_forecasts")
        ? { ok: false, status: 500, text: async () => "boom" }
        : { ok: true, json: async () => STATE }
    ) as unknown as typeof fetch;

    const res = await handler(new Request("https://guest.xbyz.fun/api/weather"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.now.temp).toBe(53);
    expect(body.days).toEqual([]);
  });

  it("returns 503 when the weather entity is unavailable", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: "unavailable", attributes: {} })
    }) as unknown as typeof fetch;

    const res = await handler(new Request("https://guest.xbyz.fun/api/weather"));
    expect(res.status).toBe(503);
  });
});
