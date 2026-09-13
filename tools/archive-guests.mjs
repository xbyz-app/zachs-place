#!/usr/bin/env node
// Saves finished visits (departDate + 3 days has passed, ET) to guests/archive/ and
// deletes them from the live store. guests/ is gitignored: this repo is public, and
// these files hold friends' names, emails and phones. They stay on this Mac only.
//
// Usage: GUEST_API_KEY=... npm run archive-guests [-- --dry-run]
import { mkdir, writeFile } from "node:fs/promises";

const SITE = (process.env.SITE_URL ?? "https://guest.xbyz.fun").replace(/\/$/, "");
const KEY = process.env.GUEST_API_KEY;
const DRY = process.argv.includes("--dry-run");
if (!KEY) { console.error("GUEST_API_KEY not set. Try: GUEST_API_KEY=$(npx netlify env:get GUEST_API_KEY) npm run archive-guests"); process.exit(1); }

const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const addDays = (date, n) => { const [y, m, d] = date.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const headers = { Authorization: `Bearer ${KEY}` };

const res = await fetch(`${SITE}/api/guests`, { headers });
if (!res.ok) { console.error(`GET /api/guests failed: ${res.status}`); process.exit(1); }
const { guests } = await res.json();
const done = guests.filter((g) => addDays(g.departDate, 3) <= todayET);
if (done.length === 0) { console.log(`nothing to archive (${guests.length} active)`); process.exit(0); }

await mkdir("guests/archive", { recursive: true });
for (const g of done) {
  const { token, pageUrl, ...record } = g; // the token is dead after expiry anyway; don't keep it
  const file = `guests/archive/${g.departDate}-${g.id}.json`;
  if (DRY) { console.log(`would archive ${file}`); continue; }
  await writeFile(file, JSON.stringify(record, null, 2) + "\n");
  const del = await fetch(`${SITE}/api/guests?id=${encodeURIComponent(g.id)}`, { method: "DELETE", headers });
  if (!del.ok) { console.error(`wrote ${file} but DELETE failed (${del.status}); it's still live`); process.exitCode = 1; continue; }
  console.log(`archived ${file}`);
}
