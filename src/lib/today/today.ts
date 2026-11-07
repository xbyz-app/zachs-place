// The Today strip on the guest page: weather, sunset, and what's open in the
// building. Pure functions only, so the Netlify function and the browser share
// them and tests can pin the clock.

export const TZ = "America/New_York";

/** Met.no condition names as Home Assistant reports them, in guest words. */
const CONDITIONS: Record<string, string> = {
  "clear-night": "Clear",
  cloudy: "Cloudy",
  exceptional: "Unusual weather",
  fog: "Foggy",
  hail: "Hail",
  lightning: "Thunderstorms",
  "lightning-rainy": "Thunderstorms",
  partlycloudy: "Partly cloudy",
  pouring: "Heavy rain",
  rainy: "Rain",
  snowy: "Snow",
  "snowy-rainy": "Sleet",
  sunny: "Sunny",
  windy: "Windy",
  "windy-variant": "Windy",
};

export function conditionLabel(condition: string): string | null {
  return CONDITIONS[condition] ?? null;
}

/** "5:34 pm" in Atlanta time. */
export function clockTime(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })
    .format(d)
    .replace(" AM", " am")
    .replace(" PM", " pm");
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

export interface TodayWeather {
  /** "62°" now, or null when the weather entity is unavailable. */
  temp: number | null;
  condition: string | null;
  high: number | null;
  low: number | null;
  /** Percent; only kept when it is worth saying (30% or more). */
  rain: number | null;
  /** "Sunset 5:34 pm", or "Sunrise 7:12 am" once the sun is down. */
  sun: string | null;
}

export interface HAInputs {
  weather: { state: string; attributes: Record<string, unknown> } | null;
  sun: { state: string; attributes: Record<string, unknown> } | null;
  /** The today_forecast attribute of sensor.todays_calendar_events: only this
   * one attribute is ever read, never the calendar events beside it. */
  forecast: Record<string, unknown> | null;
}

export function buildWeather(input: HAInputs): TodayWeather {
  const w = input.weather;
  const live = w && w.state !== "unavailable" && w.state !== "unknown";
  const f = input.forecast ?? {};
  const rain = num(f.precipitation_probability);

  let sun: string | null = null;
  if (input.sun) {
    const down = input.sun.state === "below_horizon";
    const key = down ? "next_rising" : "next_setting";
    const at = typeof input.sun.attributes[key] === "string" ? clockTime(input.sun.attributes[key] as string) : null;
    if (at) sun = `${down ? "Sunrise" : "Sunset"} ${at}`;
  }

  return {
    temp: live ? num(w!.attributes.temperature) : null,
    condition: live ? conditionLabel(w!.state) : null,
    high: num(f.temperature),
    low: num(f.templow),
    rain: rain !== null && rain >= 30 ? rain : null,
    sun,
  };
}

/** Minutes past midnight in Atlanta. */
export function minutesET(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

// The amenity hours from the manual (src/content/manual/12-building-amenities.md):
// everything open 6 a.m. to midnight, quiet hours from 10 p.m. Keep the two in step.
const OPEN = 6 * 60;
const QUIET = 22 * 60;

/** One line on what's open in the building right now (decision d_44e2d448e3). */
export function buildingLine(now: Date): string {
  const t = minutesET(now);
  if (t < OPEN) return "Pool and gym open at 6 a.m. · Quiet hours until then";
  if (t < QUIET) return "Pool and gym open until midnight · Quiet from 10 p.m.";
  return "Quiet hours now · Pool and gym open until midnight";
}
