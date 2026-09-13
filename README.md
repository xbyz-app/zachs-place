# zachs-place

Guest portal at `guest.xbyz.fun/guest` — house manual + Office/Guest-Bath controls for visitors at Zach's place.

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

## Editing the house manual

Each section of the manual is one markdown file in `src/content/manual/`, with
`title` / `icon` / `order` frontmatter. `order` drives the accordion sequence —
the filename prefix is cosmetic, so keep the two in step and **never let two
sections share an `order`**, or their relative position is undefined.

`icon` must name a key in `src/components/Icon.astro`. An unknown name renders
an empty `<svg>` rather than failing the build, so check the page after adding
one.

Two ways to edit:

```bash
npm run manual     # http://localhost:4399
```

A three-pane editor — section list, markdown, live preview styled like the real
page — that writes straight to the `.md` files. It **autosaves every edited
section** ~700ms after you stop typing and flushes pending saves when you switch
sections; ⌘S forces a save. Reorder with the ▲▼ arrows (renumbers both the
`order` field and the filenames), and add or delete sections from the buttons.

Point it somewhere harmless when testing it:

```bash
MANUAL_DIR=/tmp/scratch-manual PORT=4400 npm run manual
```

Or just edit the markdown files directly — nothing about the editor is required.

### Guest-specific copy

The hero subtitle in `src/pages/guest.astro` is sometimes personalised for whoever
is visiting. When it is, the evergreen line is parked in a comment directly above
it — swap it back when they leave.

## Design spec

See `pat/docs/superpowers/specs/2026-05-15-guest-portal-design.md` in the `pat` repo.
Guest feedback (vibe tile + `/feedback` survey, shipped 2026-05-18): `pat/docs/superpowers/specs/2026-05-18-guest-feedback-design.md`.

## Netlify Forms

`/guest` and `/feedback` post to two Netlify Forms (`guest-vibe`, `guest-feedback`). Notification emails go to `zach@xbyzexperience.com` (configured per-form in the Netlify dashboard, not in code).

Two gotchas worth remembering:

- **POST target.** Submissions must POST to the current page path (or any path that doesn't redirect). The `netlify.toml` has `/` → `/guest` as a 302 redirect, which strips POST bodies — so `fetch("/", { method: "POST", … })` silently loses the submission. `src/scripts/feedback.ts` uses `window.location.pathname` for this reason.
- **Astro + form detection.** Astro's `data-astro-cid-*` attributes can confuse Netlify's deploy-time form parser. The plain-HTML stubs at `public/__forms.html` are the canonical fix — keep field names in sync with `src/components/Feedback.astro` and `src/pages/feedback.astro`.

Also: form detection has to be turned on once per project at **Forms → Enable form detection**. Without that toggle, forms in the HTML are ignored even with `data-netlify="true"`.

## Guest arrival

Friends flying into ATL get a pre-arrival email, then a text + email the moment they land with
directions from their concourse, and a private page at `guest.xbyz.fun/arrive/<token>`.
Spec: `docs/superpowers/specs/2026-09-12-guest-arrival-design.md`.

**This repo is public.** Home address, unit, floor, coordinates and phone live only in Netlify env.
Copy in `src/lib/arrival/copy.ts` uses `{placeholders}`. Guest data never goes in git.

### Adding a guest (Muse or Claude Code)

```bash
curl -X POST https://guest.xbyz.fun/api/guests \
  -H "Authorization: Bearer $GUEST_API_KEY" -H "Content-Type: application/json" \
  -d '{"name":"Full Name","firstName":"What Zach calls them","email":"them@example.com","phone":"+14045550100",
       "arriveDate":"2026-10-01","departDate":"2026-10-04","flight":{"number":"DL1234","date":"2026-10-01"},
       "checkedBag":null,"pickup":"rideshare","doorInvited":false}'
```

- `checkedBag`: `true`/`false`/`null`. Leave it `null` until you know; the messages cover both cases.
- `flight.date` is the departure date on their ticket.
- Unknown fields are rejected on purpose.
- Update: `PATCH /api/guests?id=<id>` with any subset (e.g. `{"doorInvited":true}`). Changing `flight` restarts tracking.
- List: `GET /api/guests`. Remove: `DELETE /api/guests?id=<id>`.

### What happens (all times ET)

- **Added:** ntfy with the page link.
- **3 days out:** ntfy reminder if the Door invite isn't marked sent.
- **2 days out, 10am:** pre-arrival email.
- **Night before, 8pm:** first flight check.
- **From 30 min before departure:** checks every 10 min (5 min near landing). Alerts on delays, gate changes, cancellations, and diversions.
- **Landed:** text + email to the guest, ntfy to Zach.
- **Anything uncertain:** nothing goes to the guest, and Zach gets an ntfy.

### Env (zachs-place site)

| Var | Notes |
|---|---|
| `GUEST_API_KEY` | Bearer key for `/api/guests`. Muse keeps a copy in its vault. |
| `HOME_ADDRESS`, `HOME_LAT`, `HOME_LNG`, `HOME_STREET`, `HOME_CROSS_STREET`, `HOME_UNIT`, `HOME_UNIT_LETTER`, `HOME_FLOOR` | Private. Filled into copy on the server only. |
| `ZACH_PHONE`, `ZACH_REPLY_TO` | Call button and email reply-to. |
| `RESEND_API_KEY`, `GUEST_EMAIL_FROM` | **Second copy** of the xbyz Resend key. |
| `AERODATABOX_API_KEY` | **Second copy** of the xbyz key. |
| `AERODATABOX_MONTHLY_CAP` | Calls allowed per month from this site. Unset or 0 = tracking off. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | **Second copy** of the xbyz Twilio creds. |
| `GUEST_SMS_ENABLED` | Must be exactly `true` to send texts. Leave unset until carrier registration is approved. |
| `NTFY_TOPIC` | Zach's guest alerts topic. |
| `SITE_URL` | `https://guest.xbyz.fun` |

**Rotating a key:** the Resend, AeroDataBox and Twilio keys live in BOTH xbyz-app (Netlify + `.env.local` + GitHub Actions where used) AND here. Update both, or this site silently stops sending.

### After a visit

`GUEST_API_KEY=$(npx netlify env:get GUEST_API_KEY) npm run archive-guests` saves ended visits to
gitignored `guests/archive/` on this Mac and deletes them from the live store.
