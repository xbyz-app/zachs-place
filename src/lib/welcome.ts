// Who is staying today, for the guest page greeting. Shared by the Netlify
// function and tests. Must never read process.env (public repo).
import { etParts } from "./arrival/time";

export interface StayRecord {
  firstName: string;
  arriveDate: string; // YYYY-MM-DD (ET)
  departDate: string;
}

/** First names of every guest whose stay covers today in Atlanta, arrival
 * day through departure day inclusive. Earliest arrival first, no repeats. */
export function stayingNames(guests: StayRecord[], now: Date): string[] {
  const today = etParts(now).date;
  const seen = new Set<string>();
  const out: string[] = [];
  const staying = guests
    .filter((g) => g.arriveDate <= today && today <= g.departDate)
    .sort((a, b) => a.arriveDate.localeCompare(b.arriveDate) || a.firstName.localeCompare(b.firstName));
  for (const g of staying) {
    const name = (g.firstName ?? "").trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

/** "Welcome, Shiner." / "Welcome, Sam and Alex." / "Welcome, A, B and C."; null with nobody. */
export function greeting(names: string[]): string | null {
  const n = names.map((s) => s.trim()).filter(Boolean);
  if (n.length === 0) return null;
  const joined = n.length === 1 ? n[0] : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
  return `Welcome, ${joined}.`;
}
