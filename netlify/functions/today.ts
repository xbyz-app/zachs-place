import { callHA } from "./_ha";
import { buildWeather, type HAInputs } from "../../src/lib/today/today";

// Weather and sunset for the Today strip. Reads three Home Assistant entities
// and returns only the picked fields. sensor.todays_calendar_events also holds
// Zach's own calendar, so only its today_forecast attribute is touched here.

interface HAState { state: string; attributes: Record<string, unknown> }

async function read(entity: string): Promise<HAState | null> {
  try {
    return (await callHA(`/api/states/${entity}`)) as HAState;
  } catch {
    return null;
  }
}

export default async function handler(_req: Request): Promise<Response> {
  const [weather, sun, cal] = await Promise.all([
    read("weather.forecast_home"),
    read("sun.sun"),
    read("sensor.todays_calendar_events"),
  ]);
  if (!weather && !sun && !cal) {
    return Response.json({ error: "HA unreachable" }, { status: 503 });
  }
  const tf = cal?.attributes.today_forecast;
  const input: HAInputs = {
    weather,
    sun,
    forecast: tf && typeof tf === "object" && !Array.isArray(tf) ? (tf as Record<string, unknown>) : null,
  };
  return Response.json(buildWeather(input), {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}

export const config = { path: "/api/today" };
