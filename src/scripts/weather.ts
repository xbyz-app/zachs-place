type Day = { date: string; label: string; high: number | null; low: number | null };
type Weather = {
  now: { label: string; temp: number | null; unit: string };
  days: Day[];
};

const REFRESH_MS = 15 * 60 * 1000;

/** "Today", "Tomorrow", then the weekday. `date` is YYYY-MM-DD in Atlanta time;
 * the first day the server sends is always today there. */
export function dayName(date: string, index: number): string {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  // Noon UTC keeps the weekday stable in every US time zone.
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

export function range(d: Day): string {
  if (d.high === null && d.low === null) return "";
  if (d.low === null) return `High ${d.high}°`;
  if (d.high === null) return `Low ${d.low}°`;
  return `${d.high}° / ${d.low}°`;
}

function render(root: HTMLElement, w: Weather): void {
  const temp = root.querySelector<HTMLElement>("[data-weather-temp]");
  const label = root.querySelector<HTMLElement>("[data-weather-label]");
  const days = root.querySelector<HTMLElement>("[data-weather-days]");
  if (!temp || !label || !days) return;
  temp.textContent = w.now.temp === null ? "" : `${w.now.temp}${w.now.unit.replace("F", "").replace("C", "")}`;
  label.textContent = w.now.label;
  days.replaceChildren(
    ...w.days.map((d, i) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "day";
      name.textContent = dayName(d.date, i);
      const what = document.createElement("span");
      what.textContent = d.label;
      const r = document.createElement("span");
      r.className = "range";
      r.textContent = range(d);
      li.append(name, what, r);
      return li;
    })
  );
  days.hidden = w.days.length === 0;
  root.hidden = false;
}

async function load(root: HTMLElement): Promise<void> {
  try {
    const res = await fetch("/api/weather");
    if (!res.ok) return;
    render(root, (await res.json()) as Weather);
  } catch {
    // Leave the card as it was; weather is a nicety.
  }
}

if (typeof document !== "undefined") {
  const root = document.querySelector<HTMLElement>("[data-weather]");
  if (root) {
    void load(root);
    window.setInterval(() => void load(root), REFRESH_MS);
  }
}
