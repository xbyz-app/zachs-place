# Guest site: living room light controls

Pipeline phase `-P5ojiSlQIccMcyEpkm5` (project `-P5oGApckOUod5dhkHCg`, guest room + home routines refresh).
The spec (`pat/docs/superpowers/specs/2026-11-07-guest-room-refresh.md`) has no section for this phase; it was
added after approval. Button set filed as decision `d_f564d0c139` (recommendation taken: Low / Normal / Bright,
Chill, Off).

## Goal

A guest can set the living room lights from the guest page instead of walking to the kitchen tablet.

## Shape

- New section "Living room" under "Your room" on `/guest`: five chips — Low, Normal, Bright, Chill, Off.
- New function `netlify/functions/living.ts` at `/api/living`:
  - `GET` reads `input_select.living_brightness`, `input_select.current_scene` and the six open-plan zone lights,
    and returns `{ active: "low"|"normal"|"bright"|"chill"|"off" }`.
  - `POST {action}`:
    - `low|normal|bright` → `script.set_living_brightness {level}` — the tablet's Living Space master. It scales
      every open-plan zone along its own band, holds until Bedtime / departure / Normal, and carries the CO guard.
    - `chill` → `scene.turn_on scene.chill` (living-space scope; never touches bedroom or office).
    - `off` → `script.set_zone_off {zone}` for kitchen, gallery, chandelier, uplighting, tv_corner, fan_ring.
      Not `script.living_area_off`: that also kills the guest bath plugs and misses the floor lamp and fan ring.
  - Everything else is a 400. No entity ids come from the client.
- Separate endpoint from `/api/state` so a living-room read failure never takes the office tiles offline.
- Every write goes through Pat's own scripts, so intent logging, holds, kitchen green cue and CO guard all apply
  exactly as for a tablet tap.

## Steps

1. `living.ts` + tests (`tests/functions/living.test.ts`): each action maps to the right HA call; unknown action
   400; HA down 503; GET derives `active`.
2. `LivingTile.astro` + wiring in `controls.ts` (`livingActive()` pure helper, tested).
3. Section in `guest.astro`.
4. `npm test`, `npm run build`, PR, merge on green.
5. Live check: GET `/api/living` on the prod site, then POST `normal` (the curve's own value; harmless) and read
   back `input_select.living_brightness` in HA.
