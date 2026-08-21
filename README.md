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
