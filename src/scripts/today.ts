// Fills the Today strip (src/components/TodayStrip.astro).
import { buildingLine, type TodayWeather } from "../lib/today/today";

export function metaLine(w: TodayWeather): string {
  const parts: string[] = [];
  if (w.high !== null && w.low !== null) parts.push(`High ${w.high}° · Low ${w.low}°`);
  else if (w.high !== null) parts.push(`High ${w.high}°`);
  if (w.rain !== null) parts.push(`${w.rain}% rain`);
  if (w.sun) parts.push(w.sun);
  return parts.join(" · ");
}

function q<T extends HTMLElement>(sel: string): T | null {
  return document.querySelector<T>(sel);
}

function renderBuilding() {
  const el = q("[data-today-building]");
  if (el) el.textContent = buildingLine(new Date());
}

async function loadWeather() {
  try {
    const res = await fetch("/api/today");
    if (!res.ok) return;
    const w = (await res.json()) as TodayWeather;
    const row = q("[data-today-weather]");
    if (row && w.temp !== null) {
      q("[data-today-temp]")!.textContent = `${w.temp}°`;
      q("[data-today-cond]")!.textContent = w.condition ?? "";
      row.hidden = false;
    }
    const meta = q("[data-today-meta]");
    const line = metaLine(w);
    if (meta && line) {
      meta.textContent = line;
      meta.hidden = false;
    }
  } catch {
    // Weather is a nice-to-have: the building line stays either way.
  }
}

if (typeof document !== "undefined" && q("[data-today]")) {
  renderBuilding();
  void loadWeather();
  setInterval(renderBuilding, 60_000);
}
