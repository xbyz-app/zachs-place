const TZ = "America/New_York";

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function etParts(d: Date): { date: string; hour: number; minute: number } {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The UTC instant at which the ET wall clock reads `date hour:minute`. */
export function etDateTime(date: string, hour: number, minute = 0): Date {
  const [y, m, d] = date.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d, hour, minute);
  let t = target;
  for (let i = 0; i < 3; i++) {
    const p = etParts(new Date(t));
    const [py, pm, pd] = p.date.split("-").map(Number);
    const seen = Date.UTC(py, pm - 1, pd, p.hour, p.minute);
    if (seen === target) break;
    t += target - seen;
  }
  return new Date(t);
}

export function etHour(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : etParts(d).hour;
}

export function etClock(iso: string): string {
  const { hour, minute } = etParts(new Date(iso));
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")}${hour < 12 ? "am" : "pm"}`;
}
