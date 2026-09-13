# Guest arrival — design

**Date:** 2026-09-12
**Repo:** `zachs-place` (guest.xbyz.fun)
**Status:** approved in brainstorming, not yet planned

## What this is

When a friend flies into Atlanta to stay with Zach, they get two messages and one page:

1. A **pre-arrival email** that answers "what do I do when I land?" before they ask.
2. A **landed text + email** sent the moment their flight lands, with exact directions from *their* concourse, for *their* airline, depending on *whether they checked a bag*.
3. A private **arrival page** with the same directions, Lyft/Uber buttons, and the building walkthrough.

Zach gets ntfy alerts for delays, gate changes, landing, and anything that fails.

The template for voice and content is the text Zach sent Shiner on 2026-08-21 (reproduced at the bottom). Messages must read like that text, not like an airline notification.

## Out of scope

- **Building guest registration** (Emmi's system). Muse will investigate separately. The record has a slot for it (`buildingRegistered`) so it can be added later.
- **Parkade** guest parking.
- **Submitting Twilio carrier registration.** This is a separate task gated on cost approval (see "SMS"). The texting code ships behind a flag.
- **Airports other than ATL**, and departures.

## Components

All in `zachs-place`. The site stays static Astro; the dynamic parts are Netlify Functions plus Netlify Blobs.

| Unit | Purpose |
|---|---|
| `src/lib/arrival/route.ts` | Pure `buildRoute(input) → Step[]`. The routing rules. No I/O. |
| `src/lib/arrival/copy.ts` | Every sentence, in Zach's voice, keyed by step id. The one place to edit wording. |
| `src/lib/arrival/deeplinks.ts` | Lyft/Uber/Maps URLs built from the home coordinates (env, see Privacy). |
| `src/lib/arrival/render.ts` | `Step[]` → SMS text (short), email HTML (full), page model. |
| `netlify/functions/guests.ts` | Intake: `POST` create, `PATCH` update, `GET` list. Bearer `GUEST_API_KEY`. Used by Muse (key kept in its vault) and Claude Code. |
| `netlify/functions/arrive.ts` | `GET ?token=` → the guest's page data (name, flight status, steps). Returns 410 after expiry. No email/phone in the response. |
| `netlify/functions/guest-tick.ts` | Scheduled every 5 min. Runs the timeline (below) for every active guest. |
| `netlify/functions/lib/{flight,email,sms,ntfy,store}.ts` | AeroDataBox, Resend, Twilio, ntfy, and Blobs wrappers. The AeroDataBox and Twilio calls are ported from `xbyz-app` (`flight-status.js`, `_smsSend.js`). |
| `src/pages/arrive/index.astro` + redirect `/arrive/*  /arrive/  200` | Static shell. The client script reads the token from the path and calls `arrive`. |
| `tools/archive-guests.mjs` | Exports ended visits to gitignored `guests/archive/<date>-<id>.json` (local only; the repo is public), then deletes them from Blobs. |

## Privacy: `xbyz-app/zachs-place` is a PUBLIC repo

Added 2026-09-12 after checking visibility.

- **No private values in git or in the JS bundle.** That covers Zach's street address, unit, floor, coordinates, cross street, and phone number. They live in Netlify env (`HOME_ADDRESS`, `HOME_LAT`, `HOME_LNG`, `HOME_STREET`, `HOME_CROSS_STREET`, `HOME_UNIT`, `HOME_UNIT_LETTER`, `HOME_FLOOR`, `ZACH_PHONE`). Copy templates use `{address}`, `{street}`, `{crossStreet}`, `{unit}`, `{unitLetter}`, `{floor}`.
- **Placeholders are filled only on the server:** in emails and SMS, and in the `arrive` response, which returns the filled copy dictionary and prebuilt deep links to a valid token holder. The client bundle contains only templates.
- **Guest data (names, emails, phones, flights) never goes in git.** The archive goes to gitignored `guests/archive/`, local to Zach's Mac.
- **Tests use fake home values set in the test env.** The dist-bundle check reads the real values from the local `.env` at check time, so the check never writes them into the repo.

## Guest record (Blobs store `guests`, key = id, strong consistency)

```ts
type Guest = {
  id: string;
  token: string;                 // 32+ random bytes, base64url; the page URL
  name: string; firstName: string;
  email: string | null; phone: string | null;   // E.164
  arriveDate: string; departDate: string;       // YYYY-MM-DD, America/New_York
  flight: { number: string; date: string } | null;   // "DL1234"
  checkedBag: boolean | null;     // null = unknown, never treated as false
  pickup: 'rideshare' | 'zach';
  doorInvited: boolean;           // Zach sent the Door app invite
  buildingRegistered: boolean;    // reserved for Muse
  tracking: {
    state: 'idle' | 'scheduled' | 'departed' | 'landed' | 'cancelled' | 'diverted' | 'error';
    airline: string | null;       // IATA, derived from flight number
    international: boolean | null;
    concourse: 'T'|'A'|'B'|'C'|'D'|'E'|'F' | null;
    gate: string | null;
    scheduledArrival: string | null; estimatedArrival: string | null; landedAt: string | null;
    lastCheckedAt: string | null; lastError: string | null;
  };
  sends: Record<'preArrival'|'landedSms'|'landedEmail', { status: 'sending'|'sent'|'failed'; at: string; detail?: string }>;
  alertsSent: string[];           // dedupe keys, e.g. "delay:45", "gate:B12"
  createdAt: string;
};
```

`airline` and `concourse` are derived: airline from the flight number prefix, concourse from the first letter of the AeroDataBox arrival gate (or terminal). Posting a guest never sends anything to the guest directly; sends only come from `guest-tick`.

## Routing rules (`buildRoute`)

**Input:** `{ airline, checkedBag, concourse, international, pickup, arrivalLocalTime }`. Every field can be `null`.

### Step 1: off the concourse
- `international` → customs and bags in F, exit through the International Terminal. Step 2 is skipped. In step 3 the North-deck walk is replaced by "follow the Rideshare signs out door A1/A2 to the pickup curb" (atl.com contradicts itself on inner vs outer curb, so don't name one). For `pickup: 'zach'`, meet at the International Terminal arrivals curb. The Lyft/Uber buttons, drive time, and step 4 stay the same.
- `T` → walk to baggage claim, no train ("best case scenario!!").
- `A`–`F` → Plane Train to the **final stop**, domestic baggage claim. (E/F have no International Terminal shortcut. The only evidence for one is a 2016 forum post; we'll revisit if someone tests it.)
- `null` → "Look at your gate. If it starts with T, walk to baggage claim; anything else, take the plane train to the last stop." The page shows the concourse picker.

### Step 2: top of the escalators
- No bag, **or** a bag on a non-Delta airline → turn **RIGHT** to the **North** side.
- Bag on **Delta** → turn **LEFT** to the **South** side, get the bag at Delta claim, then follow the Rideshare signs to North.
- `checkedBag === null` → show both branches, labeled "no bag" and "checked a bag." Never guess.
- A bag on an airline not confirmed North (Avelo, Sun Country, Denver Air, or unknown) → "follow signs for your airline's baggage claim," then the Rideshare signs to North.

### Step 3: the ride
- **3a, `rideshare`:** through North baggage claim, down the escalators between doors N2/N3, out door LN1, across the crosswalk into the parking deck, and follow the orange Rideshare signs. "Call your ride while you're going down the escalator, takes them like 3–4 min" is kept deliberately (Zach's experience beats atl.com's "request once in the zone"). "I'd do Lyft, it's usually way cheaper." Buttons: Lyft, Uber, copy address.
- **3b, `zach`:** go out to the arrivals curb on your side (South if Delta, North otherwise) and text Zach your door number.
- **Drive time:** "15–20 min to me" if arrival is 5–7am or after 8pm local, otherwise "20ish min, longer at rush hour." No invented rush-hour numbers.

### Step 4: the building (the same for everyone)
From the Shiner text, with private values as placeholders (see Privacy): the GPS loops the block into the little delivery garage on {street} (not the resident garage on {crossStreet}). The main door on {street} is locked, so buzz the concierge. "Tell them you're here for Zach in {unit}, you're on the guest list." Concierge sends the elevator to {floor}. Off the elevator, go through the double doors and follow the {unitLetter} signs right; it's the last door on the left. **Door** app unlocks it. "Bed's made, towels out."

The closing line depends on the time: arriving 11pm–8am → "buzz them not me lol i will be asleep … wake me up or just crash, either is fine!!"; otherwise "text me when you're downstairs."

### Sourced facts (verified 2026-09-12; recheck atl.com/rideshare within a week of each visit)
- All domestic rideshare pickups use the North Economy lot, and the route is N2/N3 escalators → LN1 → crosswalk → deck (atl.com/rideshare; Lyft driver help agrees).
- Delta is the only airline at Domestic South; Alaska, American, Frontier, JetBlue, Southwest, Spirit, and United are North (official Domestic Terminal map, Jan 2022).
- Concourse T is walkable to both baggage claims (official Concourse T map).
- North is to the right at the top of the Plane Train escalators (read off the map, and it matches Zach's text).
- The International Terminal has its own rideshare pickup (atl.com/rideshare).
- Old South parking deck demolition began Aug 2026, so pickup may move. That's the reason for the recheck above.

## Timeline (`guest-tick`, every 5 min)

| Trigger | Action |
|---|---|
| Guest created | ntfy Zach: "Shiner added: arrive link." |
| `arriveDate − 3 days` and `!doorInvited` | ntfy Zach: "Send Shiner the Door invite." Sent once. |
| `arriveDate − 2 days` 10:00 ET, or immediately if created later than that | **Pre-arrival email** to guest. ntfy "sent." |
| `flight.date − 1 day` 20:00 ET | One flight check. ntfy only if the schedule changed or the flight isn't found. |
| From scheduled departure − 30 min until landed | Check every 10 min; every 5 min once the estimated arrival is < 30 min away. ntfy on: delay ≥ 30 min (each new 30-min band), gate change, diversion, cancellation. |
| State becomes `landed` | **Landed SMS** (if SMS enabled) + **landed email** with the real concourse. ntfy: "Shiner landed at B12: text + email sent." |
| Landed with no gate | Landed messages use the `concourse: null` route and the page picker. ntfy says the gate was missing. |
| Three consecutive API errors, or no data within 2h of scheduled arrival | ntfy Zach. **Nothing is sent to the guest based on a guess.** |
| `departDate + 3 days` | Token expires (page returns 410). ntfy: "Visit over, run `npm run archive-guests`." |

**No double-sends:** before sending, the tick writes `sends.X = {status:'sending'}` with strong consistency and skips any send that isn't absent or `failed`. A `failed` send is retried at most twice, then ntfy is sent.

**API budget:** about 15–40 AeroDataBox calls per flight. Before enabling tracking, check the plan's monthly quota against `usage/aerodatabox` in xbyz. Every call is counted in a Blobs counter, and ntfy fires at 80% of the configured monthly cap.

## Messages

- **Pre-arrival email:** what landing day looks like, "the second you land I'll text + email you exact steps from your gate," the page link, the address, the Door app ("download it, make an account, and it'll unlock {unit} for you"), "concierge will send you up in the elevator," and Zach's number. Personalized by bag and pickup when known.
- **Landed SMS:** under ~320 characters. For example: "You landed!! You're in B, so plane train to the last stop, top of the escalators turn RIGHT (north). Everything else incl. the Lyft button: <link>"
- **Landed email:** steps 1–4 in full, with buttons.
- **From:** "Zach" via the xbyz Resend integration. Reply-to is Zach's personal Gmail. Sending domain: use a verified xbyz.fun domain if Resend has one, otherwise xbyzexperience.com (check at build time).

## Page (`/arrive/<token>`)

Top to bottom: "Welcome, {firstName}." → live flight status (refetched every 60s while in the air) → "Where are you?" concourse picker, filled from tracking and overridable, re-rendering the steps locally → steps 1–4 → Lyft / Uber / copy address → "Call Zach" (`tel:`) → link to /guest manual. Uses the existing `tokens.css`/`global.css`. `noindex`, no analytics.

## SMS

The texting code ships behind `GUEST_SMS_ENABLED`. Sending from Zach's Twilio number requires US carrier registration (10DLC sole-proprietor, or toll-free verification). Registration is a separate step: read the actual fees from the Twilio console, ask Zach once in one sentence, then submit. Until it's approved, landed = email only, and the ntfy says so.

## Secrets (zachs-place Netlify env)

`GUEST_API_KEY`, `AERODATABOX_API_KEY`, `RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `NTFY_TOPIC`, `ZACH_PHONE`, `ZACH_REPLY_TO`. The AeroDataBox, Resend, and Twilio keys are **second copies** of xbyz keys, so the README's rotation section must list both homes.

## Testing

- **`route.ts`:** a table test over every combination of airline {DL, AA, unlisted, null} × bag {true, false, null} × concourse {T, A, E, F, null} × international × pickup. Assert the **ordered step ids** and the North/South/left/right tokens for each, not just "contains a string." Mutation check: flipping the Delta-bag branch or treating `null` bag as `false` must fail a test.
- **`guest-tick`:** a state machine driven by recorded AeroDataBox fixtures (scheduled → delayed → gate change → landed; landed-without-gate; API errors). Asserts exactly one send per kind and the ntfy dedupe.
- **Deep links:** tested by hand on Zach's iPhone (Lyft and Uber open with the home address prefilled) before the first real guest. Neither vendor's current docs can be trusted on their own.
- **Rehearsal:** create a guest whose email/phone are Zach's own, on a real flight landing that day, and watch the full timeline on production. Then read the sent email and the served page, not the logs.

## Reference: the Shiner text (2026-08-21)

> ok landing instructions so you don't have to think at 6am!!
> - when you land, follow signs to baggage claim/ground transportation (DOMESTIC)
> - your gate is in T right now which is truly best case scenario!! if that holds you don't need the train at all, just walk straight to baggage claim
> - if you end up in a different concourse take the plane train, but take it to the final stop (domestic baggage claim)
> - at the top of the escalators turn RIGHT toward the NORTH side. i know you're on delta but you're not checking a bag so you don't need that side at all, uber/lyft pickup is on the north
> - go thru baggage claim and down the escalator, across the street to the parking deck (there will be signs for uber/lyft)
> - call your ride while you're going down the escalator, takes them like 3-4 min
> - i'd do lyft, it's usually way cheaper
> - 15-20 min to me, no traffic that early
> - for the drop off — i live on a one way street. GPS will have them loop around the block and pull into the little delivery garage on {street} (not the resident garage on {crossStreet}) — way easier to get your bag out in there
> - main door is on {street} st. it'll be locked but there's a screen to buzz the concierge. buzz them not me lol i will be asleep
> - tell them you're here for zach in {unit}. you can tell them you're on the guest list!
> - they'll call the elevator and send you up to {floor}
> - off the elevator look for the double door opening, go through it, then follow the little {unitLetter} signs to the right. all the way down the hall, last door on the left. app unlocks it
> - bed's made, towels out
> - wake me up or just crash, either is fine!!
>
> call me if anything goes sideways, ringer's on
