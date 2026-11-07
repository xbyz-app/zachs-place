# Departing flight tracking: plan

Pipeline phase `-P5ojih0odNJjrWJpoA2` under the guest room refresh project `-P5oGApckOUod5dhkHCg`.
Zach's words (guest page copy review, round 1): "can we add flight tracking for their departing flight when we
have it on file??" The guest arrival spec (`docs/superpowers/specs/2026-09-12-guest-arrival-design.md`) listed
departures as out of scope; this plan adds them on the same machinery.

Decision d_4abdb85d72 (recommended, reversible): page only. Nothing new is sent to the guest; Zach gets ntfy pushes.

## Shape

- **Record.** `departFlight: { number, date } | null` (date = departure date on the ticket, from ATL) and
  `departTracking`. Records written before this change have neither field and read as `null` / empty.
- **API.** `POST`/`PATCH /api/guests` accept `departFlight`. Changing it resets `departTracking` and every `dep:` alert.
- **AeroDataBox.** Same endpoint as arrivals. `normalizeDeparture` picks the leg leaving ATL. Status adds `boarding`
  (Boarding, GateClosed). Landed, en route and diverted all read `departed` (they're gone).
- **Polling (`guest-tick`).** Counts against the same monthly cap. One check from 20:00 ET the night before; then from
  scheduled departure − 4h every 30 min; every 10 min once the expected departure is under 90 min away; stops at
  `departed`/`cancelled` or 3h past the expected departure. With no schedule yet: hourly from 05:00 ET on the date,
  that day only. About 15 calls per flight.
- **Pushes to Zach** (keys prefixed `dep:`): not found, 3 errors in a row, delay ≥ 30 min (per 30-min band),
  gate change, cancellation.
- **Page.** From the day before the flight, a "your flight home" card under the hero: number, destination, gate,
  time in Atlanta, on time / late / boarding / took off / cancelled. The page keeps refreshing every 60 s while the
  departure is live.

## Steps

1. Types + validation (`types.ts`, `validate.ts`), tests.
2. `normalizeDeparture` + `fetchDeparture` (`flight.ts`), tests from a recorded-shape fixture.
3. Tick: `shouldPollDeparture`, `applyDeparture`, wired into `runTick`, tests (timeline + budget + alerts).
4. Page model + `departureLine` / `showDeparture` (`view.ts`, `page.ts`), the card in `arrive/index.astro` +
   `scripts/arrive.ts`, tests.
5. README API section + this plan; build; full test run.
6. PR, merge on green, live check: create a test guest on a real ATL departure via the API, read the served page
   and `/api/guests` after a tick, then delete the guest.
