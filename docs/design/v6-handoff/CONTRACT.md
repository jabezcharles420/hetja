# Design v6 (polish): build contract

Two new boards, built on top of v5 (`docs/design/v5-handoff/CONTRACT.md`
still applies where this file does not override it):

| Board | File | Screens |
|---|---|---|
| Polish pass | `Hetja Polish and New Screens.dc.html` (top) | P1 to P13 |
| New screens | same file (bottom) | N10 to N16 |
| Desktop is an invitation | `Hetja Polish v2.dc.html` (top) | D1, D2 |
| Polish v2, "Every dog by name" | same file | V1 to V23 |
| Map and remaining states | same file (bottom) | M1 to M7, L1 to L7 |

Rendered boards: `Hetja_Polish_and_New_Screens.jpg`, `Hetja_Polish_v2.jpg`.
Each card names the live capture it replaces; the captures are the numbered
screens of the export (`apps/web/scripts/export-screens.mjs`, INDEX.md in the
export folder). The grey paragraph under each mock is the designer's
rationale: it is spec, read it. "Copy only" / "Small build" tags are the
designer's effort estimate, not permission to skip.

Same rules as v4 and v5: side by side at 390 x 844, **all** mock copy
verbatim (Rani, Priya, K/W and times are example data), no em dashes, one
loud button per screen, 44 px targets.

## Owner decisions (2026-09-25, second round)

- **Tabs: Home, Map, Scan, Me** (four, as the v6 boards). Alerts is no
  longer a tab: it is reached from Me (a row with an unread count) and from
  push notifications. This replaces the v5 five-tab decision.
- **No languages.** N14 is not built (same decision as v5).
- **N10 first-aid lines ship as designed.**
- **Feeder first names on dogs' pages: yes, with an opt-out.** Public copy
  uses first names only ("Priya", "Arjun"), never surnames or contact details.
  Settings gets "Show my first name on dogs' pages" (on by default); when off,
  that feeder is counted but not named ("Rani has 2 feeders").

## v6 supersedes v5 where they overlap

| Route | v5 screen | v6 screen that wins | Notes |
|---|---|---|---|
| `/sos/[caseId]` | N2 | P9, P10, P11, L4, L5, L6, V21, V22 | Keep v5's decline ("I can't go right now") as P9's quiet link; P10's "I can't make it after all" releases a taken case. |
| `/d/<code>` miss | N8 on /d/ | P8 | SOS stays live on an unknown code and falls back to the visitor's ward. |
| `/scan/code` full miss | N8 | V3 | "Yes, that's Rani" / "Not her. Type it again". |
| `/register/[slug]/ready` | R6 | V14 | Keep R6's real QR and Unverified pill inside V14's layout. |
| `/register/[slug]` (activate) | (live 41 to 46) | P1, P2, P3, P4 | |
| `/register/[slug]/print` | R7 | R7 + P5 merged | P5's material switch picks the output: "Paper, laminated" = the R7 layouts and A4 sheets; "Laser on TPU" = the existing 40 x 40 mm laser sheet (capture 40 "stays as it is") with P5's specs for the print shop. |
| `/register` list | (dashboard) | V12, V13, L3 | V13 is also the enable-registration screen. |
| `/register/new` at the slot limit | (form error) | P6 | Checked on open. |
| `/me` | chrome's v5 Me | V7, V8, V9, L1 | |
| `/login` | chrome's v5 login | V4, V5, V6 | V5 says "It works for 10 minutes": ships as **5 minutes** (the owner's standing OTP decision). |
| Desktop (> 744 px) | v4 Desktop Landing (18) | D1, D2 | Every app route wider than 744 px shows D1 (or D2 on `/d/*`). Reading pages (About, How it works, FAQ, Privacy, Contact, /hetja) still open, in the phone layout centred at 480 px. The desktop SOS form is the mobile one centred at 480 px. |

## Adapted, not verbatim (and why)

| Mock | What ships | Why |
|---|---|---|
| P13 "To: Rani's feeders (2)" SMS with hidden numbers | "Open Messages" opens the phone's SMS app with the message filled in and no recipient; the saved ward vet numbers are offered as recipients. The online auto-send stays. | Hetja never stores feeders' phone numbers (sign-in is email only, INVARIANT 3), and an `sms:` link cannot hide a recipient. |
| V22 "7 feeds logged (you have 3)" | The real responder rule from `lib/sos-eligibility.ts` as the checklist | The designer marked 7 as a placeholder. |
| V13 "About ₹150", "14 days", "Up to two dogs at a time" | Values from the real registration budget and expiry; "About ₹150" ships as written | The designer asked for the figures to be checked. |
| M5 "open now" | Computed where hours are structured (24 x 7 or parseable); otherwise the hours note, never a guess | |
| D1 phone preview | A real public dog (ward-level data only) when one exists, else the v4 sample styling clearly as an illustration | No fake dog presented as real. |
| P8 / F1 dogless SOS | Built: an SOS with no known dog, located to the visitor's ward (location required, Mumbai only), pages ward feeders and vets | Designed twice now (F1, P8). Tight per-device and per-IP limits. |

## Owners

| Area | Builder | v6 screens |
|---|---|---|
| Chrome, auth, Me, desktop, map | chrome | D1, D2, 480 px reading layout, four-tab TabBar, V1, V4, V5, V6, V7, V8, V9, L1, N13 (component, used from Me, M6 and welcome), V23 (component + hook; the care builder calls it after the first feed), M1 to M7, V20, the Settings name opt-out, Alerts row on Me |
| Scan tab | scan | V2, V3 (and keep F1 to F3) |
| Register and print | register | P1 to P6, V12, V13, V14, L3 |
| Dog care | care | P9, P10, P11, L4, L5, L6, V21, V22, V10, V11, L2, N15 (`/me/dogs/[slug]`), N16 (`/me/dogs/[slug]/story`), V23 wiring |
| Collar page and SOS (apps/scan) | scan-app | P7, P8, P12, P13, N10, N11, N12, V15, V16, V17, V18, V19, L7 |
| API, worker, migration 0027 | api | everything below |

## API additions (additive; migration `0027_v6_sos_outcomes_and_names.sql`)

- **Names:** `feeders.show_first_name BOOLEAN NOT NULL DEFAULT TRUE`;
  PATCH `/feeders/me` accepts `showFirstName`. GET `/dogs/:slug` adds
  `feeders: { firstName: string | null }[]` (null for opted-out),
  `lastFedBy: string | null` (first name or null), `feederCount`,
  `scanCount`. GET `/feeders/me` adds `showFirstName`.
- **SOS outcomes (P11):** POST `/sos/cases/:id/resolve` accepts
  `outcome: "taken_to_vet" | "treated_on_spot" | "not_found" | "died"`
  plus optional `vetName`; existing `resolved` / `false_alarm` keep working.
  `died` feeds the N9 memorial flow (a pending passed-away status report).
- **Case lifecycle:** POST `/sos/cases/:id/release` ("I can't make it after
  all": back to open, re-pages, escalation clock unchanged);
  POST `/sos/cases/:id/arrived` ("With Rani" in V21); POST
  `/sos/cases/:id/close-by` ("Tell the reporter you're close").
- **Case page data (P9, L4, L5, V21, V22):** GET `/sos/cases/:id` adds
  `timeline: { at, kind: "raised" | "told" | "escalation_due" | "escalated" | "taken" | "arrived" | "resolved", detail }[]`,
  `feedersTold`, `vetsTold`, `ngosTold`, `escalatesAt`, `distanceM` (from
  the caller's last known position to the case, rounded to 100 m, only for
  eligible responders), `outcome`, `vetName`, and for a non-eligible viewer
  a `forbiddenReason` plus the checklist facts for V22. The exact
  `location` stays acker-only.
- **Reporter side (N10, N11, V19, L7, P12):** GET `/reports/:caseId/status`
  (device token) adds `responderFirstName`, `takenAt`, `closeByAt`,
  `arrivedAt`, `outcome`, `vetName`, `resolvedAt`, `feedersNotifiedNames`
  (first names, opt-out respected), `vetsNotified`. POST
  `/reports/:caseId/updates` `{ note }` ("Send Priya an update", L7 "Add an
  update"), POST `/reports/:caseId/left` ("I had to leave"). POST
  `/reports` on the per-dog limit answers with `openCase: { caseId, raisedAt, responderFirstName, takenAt }`
  when this device already has an open case on the dog (L7).
- **Dogless SOS (P8, F1):** POST `/reports` without `dogSlug`, with a
  required Mumbai `geo`; the case gets a ward and no dog, and pages that
  ward's feeders and vets. `sos_cases.dog_id` becomes nullable and gains
  `ward_id`. Strict limits.
- **Feeding (V11, L2):** POST `/scans/batch` (up to 12 feeds in one call,
  same rules as single feeds); POST `/scans` accepts `note` (<= 280) and
  `tellCoFeeders: true` on an `unwell` outcome, which sends one push to the
  dog's other feeders.
- **Dog week (N15):** GET `/dogs/:slug/week` (feeder of the dog): last 7
  Asia/Kolkata days `{ date, fed: boolean, outcome, byFirstName }[]`,
  `feederNames`, `rabiesDue: { lastGiven, dueDate } | null`,
  `vetRecordCount`.
- **Alerts pause (L1):** `feeders.sos_paused_until TIMESTAMPTZ`; PATCH
  accepts `sosPausedUntil` (ISO or null). Paused feeders are not paged.
- **Registrations (P1, P4, P6, V12):** GET `/registrations` and
  `/registrations/:slug` add `printedAt`, `daysLeft`, `scanCount`,
  `liveSince`, `lastScanAt`, `feederNames`, and the budget's holders
  `{ slug, name, printedAt, daysLeft }[]`. Activation (P2) answers a wrong
  tag with both dogs' names and codes.
- **Map (M1, M2, M6, V20):** the city summary adds `withCollars`,
  `feeders`, `fedToday`, `notLoggedToday`, and SOS rows with dog names and
  a taken flag; the ward detail adds dog first names (ward level only) and
  the not-logged-today dogs with `lastLoggedAt`. Place pins carry enough to
  offset them from ward centres (the client offsets).
