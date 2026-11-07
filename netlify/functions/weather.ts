import { callHA } from "./_ha";

// Weather comes from Home Assistant's own home forecast (met.no), read with the
// guest token. The repo is public, so no coordinates ever reach git or the page.
const ENTITY = "weather.forecast_home";
const TZ = "America/New_York";

const LABELS: Record<string, string> = {
  "clear-night": "Clear",
  cloudy: "Cloudy",
  exceptional: "Wild out there",
  fog: "Foggy",
  hail: "Hail",
  lightning: "Thunderstorms",
  "lightning-rainy": "Thunderstorms",
  partlycloudy: "Partly cloudy",
  pouring: "Pouring",
  rainy: "Rain",
  snowy: "Snow",
  "snowy-rainy": "Sleet",
  sunny: "Sunny",
  windy: "Windy",
  "windy-variant": "Windy"
};

interface HAState {
  state: string;
  attributes: Record<string, unknown>;
}

interface HAForecastDay {
  datetime: string;
  condition?: string;
  temperature?: number;
  templow?: number;
  precipitation_probability?: number;
}

interface HAForecastResponse {
  service_response?: Record<string, { forecast?: HAForecastDay[] }>;
}

export interface WeatherDay {
  date: string;
  condition: string;
  label: string;
  high: number | null;
  low: number | null;
}

export interface Weather {
  now: { condition: string; label: string; temp: number | null; unit: string };
  days: WeatherDay[];
}

export function label(condition: string): string {
  return LABELS[condition] ?? condition.replace(/-/g, " ");
}

/** Calendar date of an instant in the apartment's time zone, as YYYY-MM-DD. */
export function localDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

/** Shape HA's state + daily forecast into what the page shows: now, then today
 * and the next two days. Forecast days dated before today are dropped. */
export function shape(state: HAState, forecast: HAForecastDay[], now: Date = new Date()): Weather {
  const today = localDate(now);
  const days = forecast
    .map((f) => ({ f, date: localDate(new Date(f.datetime)) }))
    .filter(({ date }) => date >= today)
    .slice(0, 3)
    .map(({ f, date }) => ({
      date,
      condition: f.condition ?? "",
      label: label(f.condition ?? ""),
      high: num(f.temperature),
      low: num(f.templow)
    }));
  return {
    now: {
      condition: state.state,
      label: label(state.state),
      temp: num(state.attributes.temperature),
      unit: typeof state.attributes.temperature_unit === "string" ? state.attributes.temperature_unit : "°F"
    },
    days
  };
}

export default async function handler(_req: Request): Promise<Response> {
  try {
    const [state, forecast] = await Promise.all([
      callHA(`/api/states/${ENTITY}`) as Promise<HAState>,
      // A forecast failure still shows the current conditions.
      (callHA("/api/services/weather/get_forecasts?return_response", {
        method: "POST",
        body: { entity_id: ENTITY, type: "daily" }
      }) as Promise<HAForecastResponse>).catch(() => ({}) as HAForecastResponse)
    ]);
    if (state.state === "unavailable" || state.state === "unknown") throw new Error("weather unavailable");
    const days = forecast.service_response?.[ENTITY]?.forecast ?? [];
    return Response.json(shape(state, days), {
      headers: { "Cache-Control": "public, max-age=600" }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 503,
      headers: { "Content-Type": "application/json" }
    });
  }
}

export const config = { path: "/api/weather" };
