import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildWeather, buildingLine, clockTime } from "../../src/lib/today/today";
import { metaLine } from "../../src/scripts/today";

const ORIGINAL_FETCH = global.fetch;
const BASE = "https://example.ui.nabu.casa/api/states/";

const STATES: Record<string, unknown> = {
  "weather.forecast_home": { state: "partlycloudy", attributes: { temperature: 61.6 } },
  "sun.sun": {
    state: "above_horizon",
    attributes: { next_setting: "2026-11-07T22:36:00+00:00", next_rising: "2026-11-08T12:00:00+00:00" },
  },
  "sensor.todays_calendar_events": {
    state: "2",
    attributes: {
      today_events: [{ summary: "Private dinner", start: "2026-11-07T19:00:00-05:00" }],
      today_forecast: { temperature: 68.2, templow: 49.9, precipitation_probability: 40, condition: "rainy" },
    },
  },
};

beforeEach(() => {
  process.env.HA_BASE_URL = "https://example.ui.nabu.casa";
  process.env.HA_GUEST_TOKEN = "test-token";
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

function mockHA(states: Record<string, unknown>) {
  global.fetch = vi.fn().mockImplementation((url: string) => {
    const body = states[url.replace(BASE, "")];
    if (!body) return Promise.resolve({ ok: false, status: 404, text: async () => "" });
    return Promise.resolve({ ok: true, json: async () => body });
  }) as unknown as typeof fetch;
}

describe("/api/today", () => {
  it("returns weather, high/low, rain and sunset", async () => {
    mockHA(STATES);
    const { default: handler } = await import("../../netlify/functions/today");
    const res = await handler(new Request("https://guest.example.test/api/today"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      temp: 62,
      condition: "Partly cloudy",
      high: 68,
      low: 50,
      rain: 40,
      sun: "Sunset 5:36 pm",
    });
  });

  it("never sends Zach's calendar events", async () => {
    mockHA(STATES);
    const { default: handler } = await import("../../netlify/functions/today");
    const text = await (await handler(new Request("https://guest.example.test/api/today"))).text();
    expect(text).not.toContain("Private dinner");
  });

  it("still answers when one entity is missing", async () => {
    mockHA({ "sun.sun": STATES["sun.sun"] });
    const { default: handler } = await import("../../netlify/functions/today");
    const res = await handler(new Request("https://guest.example.test/api/today"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.temp).toBeNull();
    expect(body.sun).toBe("Sunset 5:36 pm");
  });

  it("503s when Home Assistant is unreachable", async () => {
    mockHA({});
    const { default: handler } = await import("../../netlify/functions/today");
    const res = await handler(new Request("https://guest.example.test/api/today"));
    expect(res.status).toBe(503);
  });
});

describe("buildWeather", () => {
  it("shows sunrise once the sun is down", () => {
    const w = buildWeather({
      weather: null,
      sun: { state: "below_horizon", attributes: { next_rising: "2026-11-08T12:00:00+00:00" } },
      forecast: null,
    });
    expect(w.sun).toBe("Sunrise 7:00 am");
  });

  it("drops a small rain chance and an unavailable weather entity", () => {
    const w = buildWeather({
      weather: { state: "unavailable", attributes: { temperature: 50 } },
      sun: null,
      forecast: { precipitation_probability: 10 },
    });
    expect(w.temp).toBeNull();
    expect(w.condition).toBeNull();
    expect(w.rain).toBeNull();
  });
});

describe("clockTime", () => {
  it("formats in Atlanta time", () => {
    expect(clockTime("2026-07-01T00:45:00+00:00")).toBe("8:45 pm");
    expect(clockTime("nope")).toBeNull();
  });
});

describe("buildingLine", () => {
  // November = EST (UTC-5).
  it("before 6 a.m.", () => {
    expect(buildingLine(new Date("2026-11-07T09:30:00Z"))).toMatch(/open at 6 a\.m\./);
  });
  it("during the day", () => {
    expect(buildingLine(new Date("2026-11-07T19:00:00Z"))).toBe(
      "Pool and gym open until midnight · Quiet from 10 p.m.",
    );
  });
  it("after 10 p.m.", () => {
    expect(buildingLine(new Date("2026-11-08T03:30:00Z"))).toMatch(/^Quiet hours now/);
  });
});

describe("metaLine", () => {
  it("joins what it has", () => {
    expect(metaLine({ temp: 62, condition: "Sunny", high: 68, low: 50, rain: 40, sun: "Sunset 5:36 pm" })).toBe(
      "High 68° · Low 50° · 40% rain · Sunset 5:36 pm",
    );
    expect(metaLine({ temp: null, condition: null, high: null, low: null, rain: null, sun: null })).toBe("");
  });
});
