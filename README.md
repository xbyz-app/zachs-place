# zachs-place

Guest portal at `lab.xbyz.fun/guest` — house manual + Office/Guest-Bath controls for visitors at Zach's place.

## Local dev

```bash
. ~/.nvm/nvm.sh && nvm use
npx netlify dev
```

Open http://localhost:8888/guest.

## Deploy

Auto-deploys from `main` on Netlify. Env vars required:

- `HA_BASE_URL` — Nabu Cloud URL (e.g. `https://abc123.ui.nabu.casa`)
- `HA_GUEST_TOKEN` — LLAT minted from the HA Guest user

## Design spec

See `pat/docs/superpowers/specs/2026-05-15-guest-portal-design.md` in the `pat` repo.
