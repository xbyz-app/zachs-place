# Greet the guest by name: plan

Phase `-P5oljb5CpS8_15K8H-O` of project `-P5oGApckOUod5dhkHCg` (spec in the pat repo:
`docs/superpowers/specs/2026-11-07-guest-room-refresh.md`, which names the stay records as "the guest portal's
guest records").

The guest page hero greets whoever is staying, read from the stay records (`guests` blob store), so the
hand-edited subtitle in `src/pages/guest.astro` is no longer needed.

1. `src/lib/welcome.ts` (pure, shared): `stayingNames(guests, now)` returns the `firstName` of every guest whose
   `arriveDate <= today (ET) <= departDate`, sorted by arrival then name, deduped; `greeting(names)` gives
   "Welcome, Shiner." / "Welcome, Sam and Alex." / "Welcome, A, B and C." and `null` for none.
2. `netlify/functions/welcome.ts` at `/api/welcome`: GET only, returns `{ names: string[] }` and nothing else from
   the record, `Cache-Control: no-store`. Any store error answers `{ names: [] }` (the page falls back to the plain
   welcome, never an error).
3. `src/scripts/welcome.ts`: fetch on load; when a greeting comes back, swap the hero `h1` to it and the subtitle
   to "You're at Zach's place. Make yourself at home." Static HTML stays the evergreen welcome, so no JS or a
   failed fetch shows today's page unchanged.
4. Tests: lib (date edges in ET, ordering, join), function (shape, no leakage, error fallback, 405), script.
5. README: replace the "Guest-specific copy" hand-edit note.

Decision filed: first name shown on the public page during the stay only (recommended), alternative is
token-only greeting.
