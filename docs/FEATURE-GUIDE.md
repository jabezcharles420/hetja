# Hetja Feature Guide

Two halves in one place: first, how to use it; second, how it works and
where the code for each piece lives. The companion to
[`docs/HOW-IT-WORKS.md`](HOW-IT-WORKS.md), which explains *why* the system is
shaped this way; this one is the complete *what* and *where*, derived from the
code rather than from memory.

---

## Part 1: Using Hetja

*No file paths, no SQL. This is for someone who has never opened the
repository. Screen numbers match the design mocks.*

### If you find a dog

You do not need an app or an account.

1. **Scan the collar.** Open your phone's own camera, point it at the square
   tag on the collar, and tap the link it offers. Or open hetja.in and tap
   **Scan a collar**: the camera opens by itself, and a torch button appears
   if your phone has one. If the QR is muddy or you have no camera, type the
   nine-character code printed under it into the box at the bottom. Capitals
   and spaces do not matter, and the letters were chosen so "0" and "O" cannot
   be confused. A wrong code tells you so straight away ("No dog with that
   code. Check the letters and try again.").

2. **What you see (the dog's page).** A plain white page that loads fast on a
   cheap phone: the dog's photo (or a coloured circle with its initial), its
   name, its ward (for example `K/W ward · Andheri West`), and three status
   pills: vaccinated, sterilised, and when it was last fed. Each pill has an
   icon and words, so colour is never the only clue. If nobody has recorded a
   vaccination, it says "Vaccination unknown" rather than leaving a gap or
   guessing. Below that is the collar code, with **Copy** and a "Say it" line
   for reading it aloud over the phone, then the short story the dog's feeders
   wrote and how many of them wrote it. You will not see an exact location and
   you will not see anyone's phone number. Those are withheld deliberately.

3. **The one red button: This dog needs help.** Pressing it asks one question,
   "How bad is it?", with three answers:
   - **Hurt, but moving** (limping, a wound, not eating)
   - **Can't get up, or bleeding** (needs a vet now)
   - **Something else** (missing, scared, or being harmed)

   You can add a photo or a note if you like; you do not have to. Then press
   **Send SOS**. It stays greyed out until you pick an answer. The screen
   reminds you that only the ward is shared with feeders, never your exact
   spot.

4. **After you send it.** You see "SOS sent.", how serious you said it was,
   and "Waiting for reply". While you keep that screen open it checks every
   few seconds, and the pill changes when someone has taken the case. Under
   that is a **Call now** list of vets and NGOs near the dog, each with a
   **Call** button. Some of those numbers have never been confirmed with the
   provider; they are listed anyway (a possibly-stale number beats none), and
   when we do not have a precise address we name the neighbourhood instead of
   inventing a distance. At the same time, volunteers who look after dogs
   nearby are woken up. The first one who says they are on the way owns the
   case and everyone else is told to stand down, so five people do not drive
   to the same animal. If Hetja cannot confirm the report, it says so plainly
   and asks you to call someone on the list; with no signal at all, it offers
   a ready-made text message instead.

### Log a feed (screen 06)

*For feeders who have signed in.*

Scan the dog's collar from Me, or tap "Feeding {Name}? Log a feed" on its
page. You can add a photo (optional) and say how it went (optional): **Ate it
all**, **Ate a little**, **Didn't eat** or **Looks unwell**. Then **Log feed**.
The screen tells you what the feed does to your streak, and says "Logged.
{Name} is thrilled, in their own way." when it is done.

- **"Looks unwell" does not raise an SOS.** It suggests one, quietly, and
  leaves the decision to you. It is recorded as a flag for someone to follow up,
  and it never counts against you.
- **Offline is fine.** With no signal the feed is saved on your phone ("It
  sends when you're back online") and replays later, exactly once.
- **Photos are cleaned.** Location and other hidden data are stripped from the
  photo before it is stored.

### Sign in (screens 07 and 08)

Type your email and press **Send code**. Hetja emails you a six-digit code: no
password, no SMS. Type or paste it into the six boxes (your phone may offer to
fill it in); it checks itself as soon as all six digits are there. If nothing
arrives, you can ask for a new code after 30 seconds. Codes last five minutes.

### Me (screen 09)

A greeting that knows the time of day, then:

- **Your streak**: how many days in a row you have fed someone, and four
  badges (First feed, A full week, Monsoon feeder, 28 days), each showing
  how far you are from it if it is still locked.
- **Your trust level**: "New feeder" or "Trusted feeder", a level number and a
  bar showing how far to the next level. Trust grows by one point for each
  logged feed. The levels are the real thresholds: at 40 you can be paged for
  SOS cases, at 60 for the most serious ones.
- **My dogs**: the dogs you feed, with the ones nobody has fed today first.
- **SOS paging**: a switch. With it on, and enough trust, Hetja wakes you when
  a dog near where you feed needs help. With it off, it never does.
- **One button** to scan and log the next unfed dog's feed.

### Register a dog you look after (screens 10 and 11)

*You are the person who feeds or watches over a dog and wants it to carry a
Hetja collar. You can do it yourself, without an operator on the other end.*

1. **New dog.** Sign in, then choose to register a dog. Add a clear face photo
   (strangers use it to check they found the right dog), the dog's name, its
   ward (picked from Mumbai's 24 wards, shown like `K/W · Andheri West`), and
   whether it is vaccinated and sterilised as far as you know. Only the ward is
   ever shown publicly, and your answers about vaccination and sterilisation
   are never shown at all: the public pills only change when a vet records it.
   Press **Save & print collar**. You can have at most two dogs waiting for
   their collars at a time, per account and per phone.

2. **Collar ready.** "{Name} has a code." Print the tag (**Print collar** opens
   the print dialog; choose Save as PDF there if you want a file), laminate it,
   and loop it on a soft collar. Not too tight: two fingers under. The printed
   tag carries the QR, the code, and "Scan me if I look lost".

3. **Attach it, then scan it to switch it on.** Standing next to the dog with
   location turned on, scan the tag once. Until then the dog is invisible
   everywhere: its page does not open for anyone but you, it is not counted on
   the map, and it cannot trigger an SOS. You have **30 days**; you get a quiet
   reminder on day 7 and day 21 if you allowed notifications, and on day 30 the
   registration expires. Scanning the same tag later brings the same dog back;
   a code is never given to a different dog.

4. **Why paging waits for a second scan.** One activation proves someone stood
   next to the dog once, and makes it visible. Waking real volunteers' phones
   needs one more proof: two scans from different people or phones, or one
   from a verified feeder, NGO worker or municipal officer.

### The map (screen 19)

hetja.in/map shows all of Mumbai, and only Mumbai.

- **Each ward is one marker**, placed at the middle of the ward, showing how
  many dogs with collars live there, how many have not been fed today, and
  whether any need help right now. Dogs are shown by ward, never by street.
- **Vets and NGOs get pins**, because they are public places. Only providers
  with a real address get a pin; one we only know the neighbourhood of does
  not, so no pin is ever drawn in the wrong place.
- **Filter chips** at the top: Needs help, Not fed today, Vets, NGOs.
- **Tap a ward** to see its open cases (how serious, and how long ago; nothing
  that identifies anyone), and up to three vets and NGOs nearby with Call
  buttons. If a case there has nobody on it, the button is **I can go and
  help**; it only works for signed-in feeders with SOS paging on and enough
  trust, and it tells you plainly what you are missing if you are not there
  yet. Otherwise the button is **Get alerts for {ward} ward**, which makes it
  your home ward and turns SOS paging on.
- **Tap a pin** to see the place's hours, whether it has an ambulance on call,
  its phone number and a **Call** button.
- The vet and NGO list is Hetja's own, checked with the providers themselves
  and refreshed every month.

### The pages around it

Home (with today's real numbers of dogs with collars and feeds logged), About,
How it works, FAQ (grouped for Feeders, Vets and Everyone), Privacy, and
Contact. `/hetja` is a memorial to the dog the project is named for: a quiet
page with no animation and no bright colour.

### What a responder is asked to do

When your phone buzzes, you see the severity, the dog's last-seen summary and
the same call-an-NGO numbers the stranger saw, plus a single *I'm on my way*
button. The first tap wins: everyone else is told to stand down, and the case
is marked taken, which the stranger's screen then shows. If no one takes it
quickly, the system escalates to the three nearest contracted vets and the
municipal desk. You can later mark a case resolved or a false alarm with a
short note; only you (the one who took it) or a moderator can close it; the
anonymous reporter cannot.

**The honest caveat:** you are only reached if you allowed notifications, and
on iPhone only if you added Hetja to your home screen first. There is no SMS
fallback.

---

## Part 2: How it works

*For you and anyone who will work on this codebase next. Complement to
`HOW-IT-WORKS.md`: that file explains the reasoning; this one lists what
exists and where.*

### 1. The four services

| Service | App | Port (loopback) | Runs as |
|---|---|---|---|
| Web | `apps/web` (Next.js 14 App Router, standalone output) | 3100 | `hetja-web.service`, from `/srv/hetja/releases/current/web` |
| API | `apps/api` (Fastify 5 + zod) | 8080 | `hetja-api.service`, from `.../current/api` |
| Scan | `apps/scan` (static vanilla TS, no framework) | 8081 | `hetja-scan.service`; served at `/d/*` via Caddy. 40 KB gzipped CI budget. |
| Worker | `apps/worker` (Node) | none | `hetja-worker.service`, same env file as the API. Polls Postgres with `FOR UPDATE SKIP LOCKED`. |

All four are built on the GitHub runner and shipped as one release tarball into
the shared box's capped room (`ops/room/README.md`); nothing is built on the
box. Caddy (`ops/caddy/Caddyfile`, under `ops/room/Caddyfile.global`) listens
on 127.0.0.1:80 and is fronted by a Cloudflare Tunnel; the box has no inbound
web port. The production database is **Supabase** (PostgreSQL with PostGIS,
pgvector, pgcrypto) over its session pooler. `ops/supabase/01_schema.sql` is a
hand-maintained schema file that is several migrations behind
`packages/db/migrations` (last synchronised through `0009`); the live project
gets every migration from the deploy workflow and does not depend on it, but it
must be regenerated (`pg_dump --no-privileges`, per `ops/supabase/README.md`)
before anyone bootstraps a fresh project from it.

### 2. Every API route

*Derived from `grep -rn "app.\(get\|post\|patch\)" apps/api/src/routes/` plus
`apps/api/src/server.ts` (`/healthz`, `/`). Auth column: `FEEDER` = Bearer
access token, `DEVICE` = `X-Device-Token` (ALTCHA v2 PoW / Play Integrity
attested, canonicalised via `deviceTokenSubject`), `NONE` = public, `BOTH` =
feeder or device. "What it returns" is the `data` envelope on success unless
noted as `{ok:true}` wrapper.*

| Method & Path | Auth | What it returns / side-effect |
|---|---|---|
| `GET /healthz` | NONE | `{ok:true, service:"hetja-api", time}` |
| `GET /` | NONE | `{service, docs}` |
| `POST /api/v1/auth/otp` | NONE | Issues emailed OTP (6 digits, 5 min, 3 tries, hashed). 429 if throttled. |
| `POST /api/v1/auth/verify` | NONE | Verifies OTP → `{accessToken, refreshToken, feeder}`. |
| `POST /api/v1/auth/refresh` | NONE (refresh token) | New access token. |
| `POST /api/v1/devices/challenge` | NONE | `{challenge}` (ALTCHA v2, HMAC-signed, single-use via `spent_challenges`). |
| `POST /api/v1/devices/token` | NONE + PoW solution | `{token}` (device token). Global bucket on mint. |
| `GET /api/v1/dogs/:slug` | NONE (but `?s=` signature checked when present) | Dog profile: name, ward id and `wardName`, `vaccinated` (`yes`/`unknown`), `sterilised` (`yes`/`no`/`unknown`, never `no` without evidence), `lastFedAt`, `feederCount`, `storyAuthorCount` (counts only), `photoUrl` (never an SOS photo), story, collar status. **404 for `pending_activation` and `expired` dogs** except to their registrator (Bearer = `dogs.registered_by`). 404 on bad slug/sig. |
| `POST /api/v1/dogs` | FEEDER + `enrol` capability | `{slug, collarUrl}`: admin enrolment. Inserts dog + collar via `lib/enrol.ts` `INSERT … ON CONFLICT (slug) DO NOTHING` loop. |
| `POST /api/v1/dogs/:slug/collar` | FEEDER + `enrol` | Re-issues collar for same slug (same `collarUrl` recomputed under current secret); writes a `collar_reissues` row. |
| `GET /api/v1/wards` | NONE | The 24 BMC wards as `{id, code, name}` (`K-West`, `K/W`, `Andheri West`). Static, cacheable for a day. |
| `POST /api/v1/registrations` | FEEDER (`register` cap) + DEVICE | `201 {slug, status:"pending_activation", wardId, registeredAt, expiresAt, collarUrl, budget}`. Optional `vaccinatedReported` / `sterilisedReported` (migration 0025; never read by a public route). Enforces per-account (2) and per-device (2) pending budgets under `pg_advisory_xact_lock(420020)`. |
| `GET /api/v1/registrations` | FEEDER | `{registrations:[{slug,status,wardId,registeredAt?,expiresAt?}]}`: ward+status only. |
| `GET /api/v1/registrations/:slug` | FEEDER (owner or `enrol`) | `{slug,status,wardId,registeredAt,expiresAt,collarUrl}`: signature recomputed now. |
| `POST /api/v1/scans` | FEEDER **or** DEVICE (one required) | `{created, scanId?}`, plus the feeder's streak on a signed-in feed. Handles EXIF-strip, photo persist, LWW `last_seen_geo` (`captured_at` primary, `received_at` tie-break), `feed` trust + streak, optional `feedOutcome` (`ate_all`/`ate_some`/`didnt_eat`/`unwell`, migration 0024, written only on create; `unwell` flags, never opens an SOS or touches `review_status`), pending activation (`status IN (pending_activation,expired) → active`), and corroboration. `client_uuid` UNIQUE → `created:false` on replay. |
| `POST /api/v1/medical_records` | FEEDER + `medical` capability (vet) | Appends to hash chain under advisory lock `420001`; `{id, hash_curr}`. |
| `GET /api/v1/dogs/:slug/medical` | FEEDER | Chronological records for a dog. |
| `GET /api/v1/care?lat=&lng=&kind=&max_km=` | NONE | `{providers:[{id,name,kind,costTier,phoneE164,altPhoneE164,hasAmbulance,is24x7,hoursNote,handlesWildlife,phoneVerifiedAt,geoPrecision,locality,lat,lng,distanceM}]}`. `distanceM` only when `geo_precision='exact'` else `null`+`locality`. Up to 8, ordering `exact → distance → hasAmbulance → cost_tier → is24x7 → name`. LRU 60 s/500. |
| `POST /api/v1/reports` | FEEDER or DEVICE | Creates SOS case: `{created,caseId,tier,fanout,nearbyCare}`. Optional `note` and `photoBase64` (EXIF-stripped, saved only for a case this request opened, outside the dedupe key). Fans out to feeders with geotagged scan ≤2 km last 30d, `sos_opt_in`, `trust_score ≥ floor` (40 minor/serious, 60 critical), max 15. Inserts `sos_notifications(channel='push')` + enqueues `send_sos_push`; enqueues `escalate_sos` (now if no fan-out else +8 min). Requires `sos_eligible_at IS NOT NULL` for fan-out; `nearbyCare` is status-independent. The collar page sends `serious` or `critical` only. |
| `GET /api/v1/reports/:caseId/status` | DEVICE (the filing token) or FEEDER (the filing account) | `{state, ackedAt, escalatedAt, resolvedAt}` and nothing else. Uniform 404 for "not yours" and "no such case"; rate-limited per subject; `no-store`. Polled by the SOS sent screen. |
| `GET /api/v1/sos/cases/:id` | FEEDER (acker, fanned-out, or `moderate`) | Case state `{id,severity,state,tier,openedAt,ackedAt,escalatedAt,resolvedAt,resolution}`. |
| `POST /api/v1/sos/cases/:id/ack` | FEEDER | Conditional `UPDATE … WHERE acked_by IS NULL AND resolved_at IS NULL`: first writer wins, 409 otherwise; stand-down of losers. |
| `POST /api/v1/sos/cases/:id/resolve` | FEEDER (acker or `moderate`) | `{id,state,resolvedAt,resolution}`; idempotent retry if already resolved. |
| `GET /api/v1/heatmap?ward=` | NONE | Aggregated counts per 500 m cell/ward for heatmap. |
| `GET /api/v1/map/wards` | NONE | Every BMC ward: `{id, code, name, lat, lng, dogs, notFedToday, sosOpen, latestSos}`; `lat`/`lng` is the fixed ward centre from `BMC_WARD_CENTROIDS`, never a dog. 60 s cache. |
| `GET /api/v1/map/wards/:wardId` | NONE, or FEEDER for case ids | One ward's counts, open cases (`severity, raisedAt, state, feedersTold, mine`; `caseId` only for a signed-in caller who meets the fan-out's responder rules or holds the case) and up to 3 nearby providers. Anonymous answer cached 60 s; per-caller answer `no-store`. |
| `GET /api/v1/map/places?bbox=&kind=` | NONE | Listed vets/NGOs with an **exact** point in the box (max 2.5° a side, up to 200, `truncated` flag). Locality-precision rows never get a pin. 60 s cache. |
| `GET /api/v1/stats/impact` | NONE | The home page's real counts (dogs with collars, feeds logged). 60 s cache. |
| `GET /api/v1/ledger/anchor` | NONE | Latest `ledger_anchors` row `{head_hash, merkle_root, record_count, published_at, signed}`. |
| `GET /api/v1/ledger/verify` | NONE | Recomputes the chain over exactly the latest anchor's `record_count` prefix and compares; reports growth as `newerRecords`. |
| `GET /api/v1/ledger/proof?hash=` | NONE | Merkle inclusion proof for a record hash. |
| `POST /api/v1/trust/disputes` | FEEDER | Opens dispute `{dispute_state:'open'}`, no delta reversal yet. |
| `POST /api/v1/trust/disputes/:id/resolve` | FEEDER + `moderate` | Resolves dispute: reverses exactly the disputed delta (`reversal`), recomputes score. |
| `GET /api/v1/feeders/:id/trust` | FEEDER (own id only, 403 otherwise) | The caller's own trust. A pure read since 2026-09-07: it writes nothing. |
| `POST /api/v1/feeders/:id/trust/evaluate` | FEEDER | The explicit write path for the INVARIANT 15 verification gate. |
| `GET /api/v1/territories/:feederId` | FEEDER | Territory for a feeder. |
| `POST /api/v1/territories` | FEEDER | Create/update territory. |
| `POST /api/v1/territories/claim` | FEEDER | Claim territory. |
| `GET /api/v1/feeders/me` | FEEDER | Own profile, including `homeWard`, `sosOptIn`, `trustScore`. |
| `PATCH /api/v1/feeders/me` | FEEDER | `{ sosOptIn?, displayName?, homeWard? }` (strict, at least one). `homeWard` is a canonical BMC ward code or `null`; it does not drive paging yet. |
| `GET /api/v1/feeders/me/dogs` | FEEDER | The dogs this feeder feeds, with the feeder's own and the dog's overall last feed. |
| `POST /api/v1/feeders/me/surface` | FEEDER | Self-elect registrator / surfaces. |
| `GET /api/v1/feeders/me/streak` | FEEDER | `{streakDays, lastFeedDate, badges, trustScore, streakStart, trustLevel}`. |
| `POST /api/v1/feeders/me/badges/check` | FEEDER | Badge evaluation. |
| `POST /api/v1/dogs/:slug/stories` | FEEDER | Add story (unique per feeder+dog). |
| `GET /api/v1/dogs/:slug/stories` | NONE | Stories for a dog. |
| `POST /api/v1/metrics/web-vitals` | NONE | Ingest Web Vitals. |
| `GET /api/v1/metrics/web-vitals` | FEEDER + `moderate` | Aggregated vitals. |
| `GET /api/v1/moderation/queue` | FEEDER + `moderate` | Review queue (`pending` scans). |
| `POST /api/v1/moderation/:id/approve` | FEEDER + `moderate` | Approves scan; trust `photo_accepted +10` or `verified_scan +10`. |
| `POST /api/v1/moderation/:id/reject` | FEEDER + `moderate` | Rejects scan; `photo_rejected -5` etc., may auto-pause. |
| `GET /api/v1/push/vapid-public-key` | NONE | VAPID public key. |
| `POST /api/v1/push/subscribe` | FEEDER | Stores `{endpoint, p256dh, auth}`. |
| `POST /api/v1/push/unsubscribe` | FEEDER | Removes subscription. |

### 3. Data model

*Twenty-two domain tables plus `schema_migrations`. `0001_init.sql` creates
the core fifteen; `care_providers` (0008), `otp_codes` (0010),
`push_subscriptions` (0011), `web_vitals` (0013), `refresh_tokens` (0017),
`spent_challenges` (0021) and `collar_reissues` (0023) arrive later; `0024` and
`0025` add columns only. `\dt` counts higher because PostGIS ships
`spatial_ref_sys`. The count query is in `docs/HOW-IT-WORKS.md` §5.*

**Grouped by domain:**

- **Register:** `dogs` (slug UNIQUE, 40 random bits + check char;
  `vaccinated_reported` / `sterilised_reported` from 0025, the registrator's
  self-report, never read by a public route), `collars`
  (`qr_code`, `hmac_sig`, `batch_no`, `material`, `bound_once`, `retired_at`,
  `status`).
- **Observations:** `scans` (`dog_id`, `client_uuid` UNIQUE, `scan_type`,
  `geo GEOGRAPHY(Point,4326)`, `feeder_id`, `device_token`, `captured_at`,
  `received_at`, `review_status`, `ai_validation`, `photo_s3_key`,
  `last_seen_received_at`, and `feed_outcome` from 0024:
  `ate_all`/`ate_some`/`didnt_eat`/`unwell` or NULL).
- **Accounts:** `feeders` (`identity_hmac` UNIQUE, HMAC-SHA256 under
  `HETJA_HMAC_PEPPER`, never bare; `display_name`, `role`, `trust_score` 0-100
  derived from `trust_events`, `verification_tier`, `sos_opt_in`,
  `can_register` kill switch, `streak_days`, `badges`, `last_known_geo`,
  `home_ward`, set from the map's "Get alerts" button).
- **Medical ledger:** `medical_records` (append-only, hash-chained) +
  `ledger_anchors` (`head_hash`, `merkle_root`, `record_count`, `ledger_id`,
  `published_at`, `head_signature`, `published_url`, still `''`).
- **SOS:** `sos_cases` (`severity`, `state` open/acked/escalated/resolved/false_alarm,
  `tier`, `opened_at`, `acked_at/by`, `escalated_at`, `resolved_at`,
  `resolution`), `sos_notifications` (`case_id`, `feeder_id`/`vet_id`,
  `channel` push/sms/bmc, `delivered_at`, `acked_at`, `stood_down`).
- **Care directory:** `care_providers` (`name`, `kind` ngo/govt/charity_hospital/
  private_clinic, `cost_tier`, `phone_e164`, `alt_phone_e164`, `geo`,
  `geo_precision` exact/locality, `locality`, `has_ambulance`, `is_24x7`,
  `ward_id`, `phone_verified_at`, always NULL so far).
- **Contracted partners:** `vets` (`feeder_id`, `geo`, `signing_key_pub NOT NULL`,
  `mou_signed_at`, `retainer_paise`).
- **Territory / geofence:** `geofences`, `feeder_territories`,
  `dog_stories` (unique per dog+feeder), `trust_events` (appended via
  `logTrustEvent`, score via `recomputeScore` from `TRUST_BASELINE`).
- **Ephemeral:** `otp_codes` (hashed, 5 min, 3 tries), `push_subscriptions`,
  `web_vitals`, `jobs` (`kind`, `payload JSONB`, `run_after`, `locked_until`,
  `attempts`, `failed_at`/`last_error` (park, never delete), added 0016),
  `refresh_tokens`.

**Append-only `medical_records`:** enforced by `REVOKE UPDATE,DELETE` (and
`TRUNCATE` + `BEFORE TRUNCATE` trigger) from `app_user` (self-hosted), and by
`BEFORE UPDATE OR DELETE` trigger for every role including owner on Supabase.
Each row stores `payload_len`, `hash_prev`, `hash_curr`, `payload`,
`hash_vet_id`, `hash_ts`; hashes are length-prefixed (INVARIANT 9).

**Ledger hash chain:** `@hetja/ledger` `hashInput` /
`computeHash` length-prefixed, RFC 6962 Merkle root persisted per append
(0014) and served as inclusion proofs.

### 4. The `dogs.status` state machine

```
pending_activation ──(geotagged scan by any feeder or attested device)──▶ active
       │                                                                   │
       ├─(≥30d without activation, worker sweep)──▶ expired ──(geotagged scan)──▶ active
       │                                                                     │
       └─────────────────────────────────────────────────────────────────────┘

active ────────────────────────────────────────────────────────────────▶ lost
active ────────────────────────────────────────────────────────────────▶ deceased | adopted | relocated
(lost / deceased / adopted / relocated are terminal operator states; the happy-path
is pending → active and staying active. Heatmap and ward index carry
`WHERE status='active'` so pending and expired rows are invisible to public reads,
and so do the map's counts. `GET /dogs/:slug` answers 404 for them (except to
their registrator) since 2026-09-24; before that it had no status filter.
`expired` is not reuse: the slug never moves to a different dog; re-activating
the same row is the documented recovery.)
```

Columns that annotate the machine: `dogs.registered_by` (FK → `feeders`, `ON
DELETE SET NULL` so a DPDP erasure can delete the feeder without deleting the
dog), `registered_at` (clock for the 30-day window), `activated_at` +
`activation_scan_id` (provenance, not a FK), `sos_eligible_at` (set once, never
cleared; see “why materialised” in `scans.ts`), `registered_device_id`
(canonical device subject, per-device budget), `activation_reminders_sent`
(0→1 day 7, 1→2 day 21).

### 5. Worker jobs

*Postgres-backed queue, `SELECT … FOR UPDATE SKIP LOCKED`, three transactions
per job (claim → run → settle) so attempt counts survive handler rollback.
`MAX_ATTEMPTS=8`, backoff 5 s × 2^(n-1) capped at 1 h; exhausted rows set
`failed_at` and are never claimed again (park, not delete). Advisory
`pg_try_advisory_xact_lock` (try, not wait) prevents double-enqueue.*

| Kind | Producer (see `JOB_PRODUCERS` in `apps/worker/src/index.ts`) | Schedule / enqueue | What it does | Retry |
|---|---|---|---|---|
| `validate_scan` | **NONE**; see `docs/INVARIANTS.md` | (none: never enqueued; `ai_validation` stays NULL, `review_status` stays `pending`) | Stub would call AI worker | Would retry like any job, but is never queued |
| `escalate_sos` | `apps/api/src/routes/sos.ts` (`POST /api/v1/reports`, immediate or +8 min) | Per SOS case | If case still open/unacked (`state='open' AND acked_by IS NULL FOR UPDATE`), promotes to tier 2, pages 3 nearest contracted vets (`v.geo <-> d.last_seen_geo` when dog geo exists) + BMC desk via `sos_notifications` | Park on 8 |
| `send_sos_push` | `apps/api/src/routes/sos.ts` (`dispatchFanout`) | Per fanned-out SOS case (only when eligible) | VAPID-signed push via `sendPush` → `sendOnePush` wrapper that writes `sos_notifications.delivered_at`; 404/410 deletes the dead `push_subscriptions` row | Park; `PUSH_ENABLED` false → degrade (return, do not crash, `delivered_at` stays null, an honest “not reached”) |
| `retention` | `apps/worker` `enqueueRetentionJobIfDue` (advisory 420011, 24 h `run_after` guard, 5-min throttle) | Daily | Deletes raw photos older than `HETJA_PHOTO_TTL_DAYS` (7) from local directory, validates key `^photos/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$`, `unlink` then `photo_s3_key=NULL`; `s3` backend logs and does nothing | Park |
| `anchor_ledger` | `apps/worker` `enqueueAnchorJobIfDue` (420010, “no anchor in 24 h” from `ledger_anchors`) | Daily | `publishLedgerAnchor`: ordered scan of `medical_records` (`created_at ASC, id ASC`), head = last stored `hash_curr` (not recomputed), Merkle root via `@hetja/ledger`, optional EdDSA signature (`sign-anchor.ts`), inserts `ledger_anchors` with `published_url=''` | Park |
| `expire_stale_registrations` | `apps/worker` `enqueueRegistrationSweepIfDue` (420012, mirror of retention: `failed_at IS NULL AND run_after > now()-24h`) | Daily | One `withTx`, three passes in order: day 7 (`activation_reminders_sent 0→1`), day 21 (`1→2`), expire (`status='pending_activation' AND registered_at≤now()-30d → status='expired', registered_device_id=NULL`, retire collars `retired_at=now(), status='retired'`). Each reminder pass carries `activation_reminders_sent=N-1` so double-run reminds once; reminders handed off as `send_registration_reminder` jobs | Park; `failed_at IS NULL` filter is load-bearing; without it one dead-letter stops expiry forever |
| `send_registration_reminder` | `expire_stale_registrations` handler | Per pending dog on day 7 / 21 | Push to `dogs.registered_by`’s subscribers via `sendPush` (no `sos_notifications` row); payload `tag=registration-<dogId>-<reminder>` and print-page URL; `PUSH_ENABLED` false → degrade | Park |

### 6. The fifteen invariants: what enforces each

| # | Invariant | Enforced by |
|---|---|---|
| 1 | Slugs random, non-sequential, base32 | `packages/db/src/slugs.ts` + 500-gen uniqueness & check-char tests |
| 2 | Anonymous geo: ward / ≥500 m cells, ≤2 decimals | `packages/contracts/src/geo.ts` + tests; `dogs.ts` route test |
| 3 | `identity_hmac` only (HMAC-SHA256 pepper), never bare contact | `lib/hmac.ts`; schema has no bare `phone`/`email` column; `ops/security-gate.sh` grep |
| 4 | LWW on `dogs.last_seen_geo` by `captured_at` (±15 min future, 30 d past), tie-break `received_at` | `scans.ts` `applyLww` + `0002_*` columns; test |
| 5 | `scans.client_uuid` UNIQUE (offline replay idempotency) | Unique index + scan replay test (`created:false`) |
| 6 | Rate limits per account / device token, never per IP | `device.ts` tokens as write subject; `lib/rate-limit.ts` bucket on `/devices/token` |
| 7 | Anonymous SOS attested + capped (2/day, 5/week) | `sos.ts` per-device-token for anon, per-account for feeder-authed; rolling 24 h/7 d windows |
| 8 | `medical_records` append-only (no UPDATE/DELETE/TRUNCATE) | `0001`/`0012` REVOKE + `BEFORE TRUNCATE` trigger; `app_user` UPDATE/DELETE negative test |
| 9 | Ledger hash-chained, length-prefixed payloads | `@hetja/ledger` `hashInput` + `medical.ts` chain write under advisory lock; Merkle root per append (0014), `GET /api/v1/ledger/proof` |
| 10 | Daily published anchor | Worker `anchor_ledger` job + `sign-anchor.ts` EdDSA when key configured; `ledger.ts` serve+verify. **Not yet published externally**: `published_url=''` (see “Deliberately not finished”) |
| 11 | DPDP erasure = PII delete, chain stays valid | Pseudonymous actor IDs in chain; `dogs.registered_by ON DELETE SET NULL`, runbook documents erasure |
| 12 | Every documented query `EXPLAIN`s | `ops/check-queries.sh` CI gate |
| 13 | Scan landing < 40 KB gzipped | `pnpm --filter @hetja/scan size:gate` |
| 14 | AI validation flags, never silently rejects | `apps/ai/worker.py` stub → `flagged`; moderation queue test |
| 15 | Verification gates: provisional feeders auto-paused after 3 serial rejects | `lib/trust.ts` gate + `trust.test.ts` |

*Numbering warning from `docs/INVARIANTS.md`: in migrations and CI “INVARIANT 9”
means append-only (the table’s #8), because the original spec numbered it that
way and the applied migration headers were deliberately not rewritten. New code
uses the canonical numbers above. Trust deltas are `TRUST_BASELINE=30`,
`feed+1`, `verified_scan+10`, `photo_accepted+10`, `sos_ack+20`,
`photo_rejected-5`, `story_rejected-5`, `serial_rejects-15`, `auto_paused 0`,
`reversal 0`, exactly as in `apps/api/src/lib/trust.ts`.*

### 7. Ops

**Gate ladder (same locally and in CI):**

```bash
pnpm install --frozen-lockfile
pnpm --filter @hetja/ledger build; pnpm --filter @hetja/contracts build; pnpm --filter @hetja/db build
pnpm -r typecheck
bash ops/security-gate.sh       # no DB
bash ops/contrast-gate.sh       # the 21 v4 text/background pairs, AA
bash ops/check-queries.sh       # every docs/queries/*.sql EXPLAINs against a *_test DB
pnpm --filter @hetja/scan build && pnpm --filter @hetja/scan size:gate
# tests (api/worker/db need a `*_test` database; the suite refuses anything else;
# the WSL recipe is AGENTS.md §f):
pnpm test                       # = pnpm -r --workspace-concurrency=1 test
```

**Deploy pipeline (`push → main`, `.github/workflows/deploy.yml`):**

```
push → Gate    (typecheck, tests, security, EXPLAIN, 40 KB, contrast, Caddy cache, systemd)
     → Migrate (destructive-change gate, read-only Supabase report, apply to Supabase)
     → Deploy  (build everything ON THE RUNNER, one tarball, scp as `hetja`,
                hetja-deploy <id>: unpack, validate, flip releases/current, stamp;
                root path unit restarts hetja-*; health-check up to 180 s,
                roll back to the previous release if unhealthy; public check via Cloudflare)
```

- Nothing is built on the box: it is shared with an agent that has priority
  (`ops/room/README.md`).
- Migrations reach **one** database, Supabase. Only additive migrations flow
  unattended; anything destructive needs a `-- MIGRATION-APPROVED:` marker and
  a human.
- Rollback covers **code, not schema**: `current` flips back, but an applied
  migration stays applied. Safe only because unattended migrations are
  additive.
- The monthly vet/NGO refresh is a separate manual workflow,
  `care-import.yml`: dry-run by default, apply only with a typed confirmation,
  retires missing rows (`listed = false`) instead of deleting them, and refuses
  to retire more than a quarter of a source at once.

**Verify (on the box, as root; the same checks `hetja-deploy` runs):**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/healthz                                   # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/                                          # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/                                          # 200
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: hetja.in" "http://127.0.0.1:80/api/v1/heatmap?ward=A" # 200
systemctl status hetja.target 'hetja-*'
systemd-cgtop -1 | grep hetja
```

### 8. Deliberately not finished

*In the register `HOW-IT-WORKS.md` §9 uses. Honest, not aspirational.*

- **`apps/shell` does not exist.** The native wrapper is empty, so iOS push is
  unreliable (iOS requires add-to-home-screen before Web Push works). The UI
  says so rather than implying a safety net that is not there.

- **The first-aid card is behind a flag pending a vet’s sign-off.** It is
  `FIRST_AID_ENABLED=false` until a practising vet approves the wording, because bad
  first-aid advice given to a frightened stranger can kill a dog faster than
  doing nothing. Shipping a plausible-looking card with unapproved instructions
  would be a green check on a broken feature.

- **`validate_scan` has no producer.** Nothing enqueues it, so `ai_validation`
  stays `NULL`, `review_status` stays `pending` forever, and INVARIANT 15’s
  gate (provisional auto-pause after 3 serial rejects) can never fire from real
  AI output. Recorded in `JOB_PRODUCERS` as `NONE -- see docs/INVARIANTS.md`
  rather than pretended. The mechanical guard fails if a handler lacks a
  producer, so this cannot be forgotten again.

- **`published_url` is `''`, so INVARIANT 10 is not satisfied.** The daily
  ledger anchor is computed, Merkle-rooted and signed when a key is configured,
  but only ever held by us, and the invariant’s whole point is a head
  *published somewhere the operator does not solely control*. A row in our own
  database is not that. Publishing to a third party (notarisation service,
  public gist, OTS timestamp) is the remaining half; the ledger package’s
  `anchorMessage()` exists to give it a deterministic payload.

- **`s3` storage throws.** `STORAGE_BACKEND=s3` has no delete path in this
  build: the retention handler logs and returns, so photos are retained
  forever when that backend is selected. The `local` path is the only one that
  actually deletes. Implementing s3 before relying on the TTL is a prerequisite,
  not a follow-up.

- **Most care coordinates are locality estimates and no phone number is
  verified.** About 81 of 93 providers carry `geo_precision='locality'` and a
  `locality` label rather than a measured address, so their `distanceM` is
  `null` by contract (never a confident 0 m). Every `phone_verified_at` is
  `NULL`; nobody has called these numbers. Geocoding from a real address and
  calling each number are the only honest ways to close those gaps; there is no
  shortcut.

- **The old box's four databases were `SQL_ASCII` / `C` collation**, which
  bites Devanagari dog or feeder names on ordering and case-folding. Supabase,
  now production, has not been re-checked; changing collation is a
  dump-and-restore, so it is recorded rather than fixed.

- **Production connects as Supabase's `postgres` user**, so the `app_user`
  REVOKEs the tests reproduce do not bind the live API; INVARIANT 8 there rests
  on the trigger in `ops/supabase/03_hardening.sql`. Check it exists.

- **No backups run for the room.** The restic and `pg_dump` timers belonged
  to the old box; uploaded photos in `/srv/hetja/photos` are not backed up.

- **The SOS sent screen gives no head count**, because the API does not return
  one, and **a feeder's home ward does not drive paging yet** (the map's "Get
  alerts" stores it; the fan-out still uses recent feeds within 2 km).

- **The re-tag route is not a separate endpoint yet.** A replacement tag keeps
  the same slug and the print page keeps returning the same `collarUrl`, so a
  reprint works; there is no dedicated retag API beyond that.

- **The git history still contains the old working title in commit messages.**
  Rewriting it invalidates every SHA, so it happens once, last, and not before.

---

*The rule underneath: the system is allowed to know less than it wants to, but
it is not allowed to claim more than it knows. A measurement we don’t have is
not reported as zero (§10 of `HOW-IT-WORKS.md`).*
