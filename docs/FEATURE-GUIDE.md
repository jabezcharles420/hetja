# Hetja Feature Guide

Two halves in one place: first, how to use it; second, how it works and
where the code for each piece lives. The companion to
[`docs/HOW-IT-WORKS.md`](HOW-IT-WORKS.md), which explains *why* the system is
shaped this way — this one is the complete *what* and *where*, derived from the
code rather than from memory.

---

## Part 1 — Using Hetja

*No file paths, no SQL. This is for someone who has never opened the repository.*

### If you find a dog

You do not need an app or an account.

1. **Scan the collar.** Open your phone's own camera, point it at the square
   tag on the collar, and tap the link it offers. If your browser or phone
   cannot read QR codes, you can also type the nine-character code printed
   under the square — the letters were chosen so “0” and “O” cannot be confused.

2. **What you see.** A page with the dog's name and photo, whether it has been
   vaccinated and sterilised, when it was last seen, and the short story the
   person who looks after it wrote. You will not see an exact location and you
   will not see anyone's phone number on this screen — those are withheld
   deliberately.

3. **The one big button.** If the dog is hurt, there is a single primary
   action: *this dog is hurt*. Pressing it does two things at once, and neither
   waits for the other.

   - You immediately get a list of the nearest places that can help — shelters,
     government veterinary posts, charity hospitals and private clinics — each
     with a phone number you can tap to call, whether they have an ambulance,
     whether they are open through the night, and what they charge. Some of
     those numbers have never been dialed by us: they are shown as “unconfirmed”
     rather than hidden (a possibly-stale number beats none, but you are told
     which it is). When we do not have a precise address for a clinic, we tell
     you the neighbourhood instead of fabricating “0 m away”.

   - In parallel, the system opens an SOS case and wakes up the volunteers who
     have said they will help nearby. The first one who says “I’m on my way”
     owns the case and everyone else is told to stand down, so five people do not
     drive to the same animal.

4. **If you cannot get a browser to scan.** The button on the scan page for
   “use my camera” will explain, in plain language, whether your browser can
   use a camera, whether permission was denied, or whether you should just type
   the code.

### Registrator — from sign-up to a tag on a dog

*You are the person who feeds or watches over a dog and wants it to carry a
Hetja collar. The whole flow is built so you can do it yourself, without an
operator on the other end.*

1. **Sign up and become a registrator.** Create an account with your email —
   you will be sent a six-digit code, no password — and mark yourself as a
   registrator in your profile. This is a self-elected role; the operator can
   switch off registration for one account without touching your profile or your
   history.

2. **Register the dog you look after.** On the register page, enter the ward
   the dog lives in and, if you know it, its name, sex, rough age and
   temperament. You can register at most two dogs at a time that have not yet
   been attached — the limit is per account *and* per phone, so ten email
   aliases on one phone do not buy ten more tags. You will get back a signed
   link for that dog; that link is exactly what goes into the QR.

3. **Print the tag.** Open the print page for that dog and print the sheet. It
   is the collar specification in [`MAKING-A-COLLAR.md`](MAKING-A-COLLAR.md) —
   a TPU tag, laser-etched, 40 × 40 mm, with the QR and the nine-character
   fallback printed beneath it. The sheet hides everything else on paper so you
   do not waste a sheet of TPU on a navigation bar. The signature in the link
   is required: without it the collar cannot be forged and scanners cannot be
   scraped by enumeration.

4. **Attach it, then scan it to activate.** Put the collar on the dog with a
   two-finger fit and a breakaway section. Then, standing next to the dog, scan
   that same tag with your phone while location is enabled. That scan is what
   moves the registration out of its inert state.

   - While a registration is **pending** it is invisible on every public surface:
     it does not appear on the heatmap, in ward searches, or in the public
     directory, and it cannot trigger an SOS fan-out. That is deliberate — the
     anti-abuse control is physical presence, not a review queue.
   - You have **30 days from registration** to attach and scan. On day 7 and
     day 21 you will get a quiet reminder push if you have allowed notifications.
     On day 30 the registration **expires**: the collar is retired and the link
     between the request and the dog is cleared. The slug itself is never reused
     for a different dog; if you scan that same tag on day 32 it reactivates the
     same row rather than minting a new one. “Never reused” forbids assigning a
     tag to a *different* animal, not the same dog catching up a month late.

5. **Why the SOS fan-out waits for a second scan.** A single activation proves
   someone stood next to the animal once and is enough to make the dog visible.
   Paging real volunteers — waking people’s phones — requires one more proof of
   presence: either two scans from different people or phones, or one scan from a
   verified feeder, NGO worker or municipal officer. Until that corroboration is
   reached the dog is visible but the fan-out is held. The same “set once, never
   cleared” column gates paging so a later retention sweep or review-status change
   cannot silently turn the safety net off.

### Feeder — what you do after the tag is live

1. **Logging feeds, with photos.** Each time you feed or check on the dog, log a
   feed with a geotagged photo. The photo is stripped of metadata on the server
   before it is stored (an un-stripped photo published a feeder’s exact location
   to every viewer). If the photo cannot be decoded, the feed is rejected
   honestly rather than accepted with a silently missing image. Feeds earn trust
   slowly — one point at a time — and that trust is what later allows you to be
   paged or to re-tag a dog.

2. **Offline behaviour.** If you are offline, feeds queue on your phone and
   replay when you are back. Each queued feed carries an idempotency key so a
   flaky connection does not turn into duplicate credit or duplicate cases. A
   feed queued for longer than fifteen minutes into the future is rejected —
   but a feed queued for hours or days in the past is accepted, because
   offline time is exactly when the gap happens. A permanent rejection (a bad
   photo, a malformed payload) is dropped and reported; a transient failure is
   retried.

3. **Streaks and badges.** Consecutive days of feeding build a streak, which is a
   small, deliberate incentive to visit. Badges are checked and awarded
   periodically. Both are presentation over the same feed events that already
   carry trust — they never mint trust themselves, so farming a badge cannot
   bypass the trust economics.

4. **Opting in to emergencies.** A feeder can say “wake me for SOS cases near
   dogs I know”. Paging is geofenced and rate-limited (a real phone number’s
   notifications are not a toy), and it only pages feeders whose own recent feed
   history puts them near the dog and who have enough trust for the severity
   being reported.

5. **What a responder is asked to do.** When your phone vibrates, you see the
   severity, the dog’s last-seen summary, and the same call-an-NGO numbers the
   stranger saw, plus a single *I’m on my way* button. The first tap wins
   atomically — everyone else is told to stand down, and the case is marked
   acked. If no one acks quickly, the system escalates to the three nearest
   contracted vets and the municipal desk. You can later mark a case resolved or
   false-alarm with a short note; only you (the acker) or a moderator can close
   a case you own — the anonymous reporter cannot.

---

## Part 2 — How it works

*For you and anyone who will work on this codebase next. Complement to
`HOW-IT-WORKS.md` — that file explains the reasoning; this one lists what
exists and where.*

### 1. The four services

| Service | App | Port (loopback) | Deploys from |
|---|---|---|---|
| Web | `apps/web` (Next.js 14 App Router) | 3100 | **Release** — built on the GitHub runner, shipped as `/srv/hetja/releases/<ts>-<sha>/` with `current` symlinked. Built on the box it OOM-kills the live services (see `AGENTS.md` §g). |
| API | `apps/api` (Fastify 5 + zod) | 8080 | **Checkout** — `tsc` built on the box from `/root/hetja` at the deployed SHA, restarted via `hetja-api.service`. |
| Scan | `apps/scan` (static vanilla TS, no framework) | 8081 | **Release** — like `web`; served at `/d/*` via Caddy. 40 KB gzipped CI budget. |
| Worker | `apps/worker` (Node) | — (no port) | **Checkout** — `tsc` on the box, same checkout as `api` (`hetja-worker.service`). Polls Postgres with `FOR UPDATE SKIP LOCKED`. |

Caddy (`ops/caddy/Caddyfile`) is the only thing reachable from outside and is
fronted by a Cloudflare Tunnel — the box has no inbound ports open. The
authoritative database is local PostgreSQL (PostGIS, pgvector, pgcrypto);
Supabase holds a hardened mirror schema whose `ops/supabase/01_schema.sql` is
hand-maintained and is currently several migrations behind
`packages/db/migrations` — last synchronized through
`0009_care_geo_precision.sql`; it does not include `0010_identity_email.sql`
through `0020_sos_network_indexes.sql` and later (authoritative schema is
`packages/db/migrations/*.sql`). It serves no reads (see `docs/HOW-IT-WORKS.md`
§7), so the drift does not break production but must be reconciled before
repointing (regenerate via `pg_dump --no-privileges` per
`ops/supabase/README.md` § "Schema differences").

### 2. Every API route

*Derived from `grep -rn "app.\(get\|post\|patch\)" apps/api/src/routes/` plus
`apps/api/src/server.ts` (`/healthz`, `/`). Auth column: `FEEDER` = Bearer
access token, `DEVICE` = `X-Device-Token` (ALTCHA v2 PoW / Play Integrity
attested, canonicalised via `deviceTokenSubject`), `NONE` = public, `BOTH` =
feeder or device. “What it returns” is the `data` envelope on success unless
noted as `{ok:true}` wrapper.*

| Method & Path | Auth | What it returns / side-effect |
|---|---|---|
| `GET /healthz` | NONE | `{ok:true, service:"hetja-api", time}` |
| `GET /` | NONE | `{service, docs}` |
| `POST /api/v1/auth/otp` | NONE | Issues emailed OTP (6 digits, 5 min, 3 tries, hashed). 429 if throttled. |
| `POST /api/v1/auth/verify` | NONE | Verifies OTP → `{accessToken, refreshToken, feeder}`. |
| `POST /api/v1/auth/refresh` | NONE (refresh token) | New access token. |
| `POST /api/v1/devices/challenge` | NONE | `{challenge}` (ALTCHA v2, HMAC-signed, single-use). |
| `POST /api/v1/devices/token` | NONE + PoW solution | `{token}` (device token). Global bucket on mint. |
| `GET /api/v1/dogs/:slug` | NONE (but `?s=` signature checked) | Dog + coarsened geo, story, collar status. 404 on bad slug/sig. |
| `POST /api/v1/dogs` | FEEDER + `enrol` capability | `{slug, collarUrl}` — admin enrolment. Inserts dog + collar via `lib/enrol.ts` `INSERT … ON CONFLICT (slug) DO NOTHING` loop. |
| `POST /api/v1/dogs/:slug/collar` | FEEDER + `enrol` | Re-issues collar for same slug (same `collarUrl` recomputed under current secret). |
| `POST /api/v1/registrations` | FEEDER (`register` cap) + DEVICE | `201 {slug, status:"pending_activation", wardId, registeredAt, expiresAt, collarUrl, budget}`. Enforces per-account (2) and per-device (2) pending budgets under `pg_advisory_xact_lock(420020)`. |
| `GET /api/v1/registrations` | FEEDER | `{registrations:[{slug,status,wardId,registeredAt?,expiresAt?}]}` — ward+status only. |
| `GET /api/v1/registrations/:slug` | FEEDER (owner or `enrol`) | `{slug,status,wardId,registeredAt,expiresAt,collarUrl}` — signature recomputed now. |
| `POST /api/v1/scans` | FEEDER **or** DEVICE (one required) | `{created, scanId?}`. Handles EXIF-strip, photo persist, LWW `last_seen_geo` (`captured_at` primary, `received_at` tie-break), `feed` trust + streak, pending activation (`status IN (pending_activation,expired) → active`), and corroboration. `client_uuid` UNIQUE → `created:false` on replay. |
| `POST /api/v1/medical_records` | FEEDER + `medical` capability (vet) | Appends to hash chain under advisory lock `420001`; `{id, hash_curr}`. |
| `GET /api/v1/dogs/:slug/medical` | FEEDER | Chronological records for a dog. |
| `GET /api/v1/care?lat=&lng=&kind=&max_km=` | NONE | `{providers:[{id,name,kind,costTier,phoneE164,altPhoneE164,hasAmbulance,is24x7,hoursNote,handlesWildlife,phoneVerifiedAt,geoPrecision,locality,lat,lng,distanceM}]}`. `distanceM` only when `geo_precision='exact'` else `null`+`locality`. Up to 8, ordering `exact → distance → hasAmbulance → cost_tier → is24x7 → name`. LRU 60 s/500. |
| `POST /api/v1/reports` | FEEDER or DEVICE | Creates SOS case: `{created,caseId,tier,fanout,nearbyCare}`. Fans out to feeders with geotagged scan ≤2 km last 30d, `sos_opt_in`, `trust_score ≥ floor` (40 minor/serious, 60 critical), max 15. Inserts `sos_notifications(channel='push')` + enqueues `send_sos_push`; enqueues `escalate_sos` (now if no fan-out else +8 min). Requires `sos_eligible_at IS NOT NULL` for fan-out; `nearbyCare` is status-independent. |
| `GET /api/v1/sos/cases/:id` | FEEDER (acker, fanned-out, or `moderate`) | Case state `{id,severity,state,tier,openedAt,ackedAt,escalatedAt,resolvedAt,resolution}`. |
| `POST /api/v1/sos/cases/:id/ack` | FEEDER | Conditional `UPDATE … WHERE acked_by IS NULL` — first writer wins, 409 otherwise; stand-down of losers. |
| `POST /api/v1/sos/cases/:id/resolve` | FEEDER (acker or `moderate`) | `{id,state,resolvedAt,resolution}`; idempotent retry if already resolved. |
| `GET /api/v1/heatmap?ward=` | NONE | Aggregated counts per coarse cell/ward for heatmap. |
| `GET /api/v1/ledger/anchor` | NONE | Latest `ledger_anchors` row `{head_hash, merkle_root, record_count, published_at, signed}`. |
| `GET /api/v1/ledger/verify?n=` | NONE | Recomputes chain head and Merkle root over first *n* records, compares to stored values. |
| `GET /api/v1/ledger/proof?hash=` | NONE | Merkle inclusion proof for a record hash. |
| `POST /api/v1/trust/disputes` | FEEDER | Opens dispute `{dispute_state:'open'}` — no delta reversal yet. |
| `POST /api/v1/trust/disputes/:id/resolve` | FEEDER + `moderate` | Resolves dispute: reverses exactly the disputed delta (`reversal`), recomputes score. |
| `GET /api/v1/trust/feeder/:id` | FEEDER | `{score, tier, events}`. |
| `GET /api/v1/territories/:feederId` | FEEDER | Territory for a feeder. |
| `POST /api/v1/territories` | FEEDER | Create/update territory. |
| `POST /api/v1/territories/claim` | FEEDER | Claim territory. |
| `GET /api/v1/feeders/me` | FEEDER | Own profile. |
| `PATCH /api/v1/feeders/me` | FEEDER | Update own profile. |
| `POST /api/v1/feeders/me/surface` | FEEDER | Self-elect registrator / surfaces. |
| `GET /api/v1/feeders/me/streak` | FEEDER | `{streakDays, lastFeedDate}`. |
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

*Nineteen domain tables plus `schema_migrations`, in the running database.
`0001_init.sql` creates the core fifteen; `care_providers` (0008),
`otp_codes` (0010), `push_subscriptions` (0011) and `web_vitals` (0013) arrive
later. `\dt` counts higher because PostGIS ships `spatial_ref_sys`.*

**Grouped by domain:**

- **Register:** `dogs` (slug UNIQUE, 40 random bits + check char), `collars`
  (`qr_code`, `hmac_sig`, `batch_no`, `material`, `bound_once`, `retired_at`,
  `status`).
- **Observations:** `scans` (`dog_id`, `client_uuid` UNIQUE, `scan_type`,
  `geo GEOGRAPHY(Point,4326)`, `feeder_id`, `device_token`, `captured_at`,
  `received_at`, `review_status`, `ai_validation`, `photo_s3_key`,
  `last_seen_received_at`).
- **Accounts:** `feeders` (`identity_hmac` UNIQUE — HMAC-SHA256 under
  `HETJA_HMAC_PEPPER`, never bare; `display_name`, `role`, `trust_score` 0-100
  derived from `trust_events`, `verification_tier`, `sos_opt_in`,
  `can_register` kill switch, `streak_days`, `badges`, `last_known_geo`).
- **Medical ledger:** `medical_records` (append-only, hash-chained) +
  `ledger_anchors` (`head_hash`, `merkle_root`, `record_count`, `ledger_id`,
  `published_at`, `head_signature`, `published_url` — still `''`).
- **SOS:** `sos_cases` (`severity`, `state` open/acked/escalated/resolved/false_alarm,
  `tier`, `opened_at`, `acked_at/by`, `escalated_at`, `resolved_at`,
  `resolution`), `sos_notifications` (`case_id`, `feeder_id`/`vet_id`,
  `channel` push/sms/bmc, `delivered_at`, `acked_at`, `stood_down`).
- **Care directory:** `care_providers` (`name`, `kind` ngo/govt/charity_hospital/
  private_clinic, `cost_tier`, `phone_e164`, `alt_phone_e164`, `geo`,
  `geo_precision` exact/locality, `locality`, `has_ambulance`, `is_24x7`,
  `ward_id`, `phone_verified_at` — always NULL so far).
- **Contracted partners:** `vets` (`feeder_id`, `geo`, `signing_key_pub NOT NULL`,
  `mou_signed_at`, `retainer_paise`).
- **Territory / geofence:** `geofences`, `feeder_territories`,
  `dog_stories` (unique per dog+feeder), `trust_events` (appended via
  `logTrustEvent`, score via `recomputeScore` from `TRUST_BASELINE`).
- **Ephemeral:** `otp_codes` (hashed, 5 min, 3 tries), `push_subscriptions`,
  `web_vitals`, `jobs` (`kind`, `payload JSONB`, `run_after`, `locked_until`,
  `attempts`, `failed_at`/`last_error` — park, never delete — added 0016),
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
`WHERE status='active'` so pending and expired rows are invisible to public reads.
`expired` is not reuse: the slug never moves to a different dog; re-activating
the same row is the documented recovery.)
```

Columns that annotate the machine: `dogs.registered_by` (FK → `feeders`, `ON
DELETE SET NULL` so a DPDP erasure can delete the feeder without deleting the
dog), `registered_at` (clock for the 30-day window), `activated_at` +
`activation_scan_id` (provenance, not a FK), `sos_eligible_at` (set once, never
cleared — see “why materialised” in `scans.ts`), `registered_device_id`
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
| `validate_scan` | **NONE** — see `docs/INVARIANTS.md` | (none — never enqueued; `ai_validation` stays NULL, `review_status` stays `pending`) | Stub would call AI worker | Would retry like any job, but is never queued |
| `escalate_sos` | `apps/api/src/routes/sos.ts` (`POST /api/v1/reports`, immediate or +8 min) | Per SOS case | If case still open/unacked (`state='open' AND acked_by IS NULL FOR UPDATE`), promotes to tier 2, pages 3 nearest contracted vets (`v.geo <-> d.last_seen_geo` when dog geo exists) + BMC desk via `sos_notifications` | Park on 8 |
| `send_sos_push` | `apps/api/src/routes/sos.ts` (`dispatchFanout`) | Per fanned-out SOS case (only when eligible) | VAPID-signed push via `sendPush` → `sendOnePush` wrapper that writes `sos_notifications.delivered_at`; 404/410 deletes the dead `push_subscriptions` row | Park; `PUSH_ENABLED` false → degrade (return, do not crash, `delivered_at` stays null — honest “not reached”) |
| `retention` | `apps/worker` `enqueueRetentionJobIfDue` (advisory 420011, 24 h `run_after` guard, 5-min throttle) | Daily | Deletes raw photos older than `HETJA_PHOTO_TTL_DAYS` (7) from local directory, validates key `^photos/[A-Za-z0-9_-]+\.[A-Za-z0-9]+$`, `unlink` then `photo_s3_key=NULL`; `s3` backend logs and does nothing | Park |
| `anchor_ledger` | `apps/worker` `enqueueAnchorJobIfDue` (420010, “no anchor in 24 h” from `ledger_anchors`) | Daily | `publishLedgerAnchor`: ordered scan of `medical_records` (`created_at ASC, id ASC`), head = last stored `hash_curr` (not recomputed), Merkle root via `@hetja/ledger`, optional EdDSA signature (`sign-anchor.ts`), inserts `ledger_anchors` with `published_url=''` | Park |
| `expire_stale_registrations` | `apps/worker` `enqueueRegistrationSweepIfDue` (420012, mirror of retention — `failed_at IS NULL AND run_after > now()-24h`) | Daily | One `withTx`, three passes in order: day 7 (`activation_reminders_sent 0→1`), day 21 (`1→2`), expire (`status='pending_activation' AND registered_at≤now()-30d → status='expired', registered_device_id=NULL`, retire collars `retired_at=now(), status='retired'`). Each reminder pass carries `activation_reminders_sent=N-1` so double-run reminds once; reminders handed off as `send_registration_reminder` jobs | Park; `failed_at IS NULL` filter is load-bearing — without it one dead-letter stops expiry forever |
| `send_registration_reminder` | `expire_stale_registrations` handler | Per pending dog on day 7 / 21 | Push to `dogs.registered_by`’s subscribers via `sendPush` (no `sos_notifications` row); payload `tag=registration-<dogId>-<reminder>` and print-page URL; `PUSH_ENABLED` false → degrade | Park |

### 6. The fifteen invariants — what enforces each

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
| 10 | Daily published anchor | Worker `anchor_ledger` job + `sign-anchor.ts` EdDSA when key configured; `ledger.ts` serve+verify. **Not yet published externally** — `published_url=''` (see “Deliberately not finished”) |
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
`reversal 0` — exactly `apps/api/src/lib/trust.ts`.*

### 7. Ops

**Gate ladder (same locally and in CI):**

```bash
pnpm install --frozen-lockfile
pnpm --filter @hetja/ledger build; pnpm --filter @hetja/contracts build; pnpm --filter @hetja/db build
pnpm -r typecheck
./ops/security-gate.sh          # 7 checks, no DB
./ops/check-queries.sh          # every docs/queries/*.sql EXPLAINs against hetja_test
pnpm --filter @hetja/scan size:gate
# tests (needs a `*_test` database — the suite refuses anything else):
psql --as postgres: create role app_user, extensions postgis/vector/pgcrypto
PGHOST=/var/run/postgresql PGUSER=postgres pnpm --filter @hetja/db migrate
psql: GRANTs + REVOKE UPDATE,DELETE,TRUNCATE ON medical_records FROM app_user
PGHOST=127.0.0.1 PGDATABASE=hetja_test PGUSER=app_user pnpm -r test
```

**Deploy pipeline (`push → main`):**

```
push → Gate (typecheck, tests, security-gate, check-queries, 40 KB, destructive-change gate)
     → Migrate (destructive-change gate then apply to Supabase)
     → Deploy (build web+scan ON THE RUNNER, rsync release, build api+worker ON THE BOX
               from this SHA, apply migrations to the production local DB, flip current,
               restart, health-check, assert HEAD==deployed SHA)
```

- Web + scan are built on the runner to avoid OOM on the 2/3 GB box; api + worker
  are `tsc` on the box from the checkout. Both halves must ship or the API
  goes stale green. Runner assertions check the checkout HEAD.
- Migrations reach **two** databases (Supabase from the runner, local production
  from `deploy-remote.sh`); only additive migrations flow unattended, guarded by
  a `-- MIGRATION-APPROVED:` marker.
- Rollback covers **code, not schema**: `current` flips and the checkout resets,
  but an applied migration stays applied. Safe only because unattended migrations
  are additive.

**Verify ladder (on the box, from `AGENTS.md` §f):**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/                          # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/                          # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/healthz                   # 200
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8080/api/v1/heatmap?ward=A"   # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/d/<slug>                  # 200, text/html
systemctl is-active hetja-api hetja-web hetja-worker hetja-scan                          # active ×4
# care directory (wave 9):
curl -s "http://127.0.0.1:8080/api/v1/care?lat=19.076&lng=72.877" | head -c 300            # {"ok":true,"data":{"providers":[…
```

### 8. Deliberately not finished

*In the register `HOW-IT-WORKS.md` §9 uses. Honest, not aspirational.*

- **`apps/shell` does not exist.** The native wrapper is empty, so iOS push is
  unreliable (iOS requires add-to-home-screen before Web Push works). The UI
  says so rather than implying a safety net that is not there.

- **The first-aid card is behind a flag pending a vet’s sign-off.** It is
  `FIRST_AID_ENABLED=false` until a practising vet approves the wording — bad
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
  ledger anchor is computed, Merkle-rooted and signed when a key is configured
  — but only ever held by us, and the invariant’s whole point is a head
  *published somewhere the operator does not solely control*. A row in our own
  database is not that. Publishing to a third party (notarisation service,
  public gist, OTS timestamp) is the remaining half; the ledger package’s
  `anchorMessage()` exists to give it a deterministic payload.

- **`s3` storage throws.** `STORAGE_BACKEND=s3` has no delete path in this
  build — the retention handler logs and returns, so photos are retained
  forever when that backend is selected. The `local` path is the only one that
  actually deletes. Implementing s3 before relying on the TTL is a prerequisite,
  not a follow-up.

- **Most care coordinates are locality estimates and no phone number is
  verified.** About 81 of 93 providers carry `geo_precision='locality'` and a
  `locality` label rather than a measured address, so their `distanceM` is
  `null` by contract (never a confident 0 m). Every `phone_verified_at` is
  `NULL` — nobody has called these numbers. Geocoding from a real address and
  calling each number are the only honest ways to close those gaps; there is no
  shortcut.

- **All four databases are `SQL_ASCII` / `C` collation.** The Supabase mirror’s
  `glibc` collation on the live box is `C`; moving to Devanagari dog or feeder
  names will bite on ordering and case-folding. It is recorded rather than
  fixed: changing collation is a dump-and-restore.

- **The re-tag route is not a separate endpoint yet.** A replacement tag keeps
  the same slug and the print page keeps returning the same `collarUrl`, so a
  reprint works; there is no dedicated retag API beyond that.

- **The git history still contains the old working title in commit messages.**
  Rewriting it invalidates every SHA, so it happens once, last, and not before.

---

*The rule underneath: the system is allowed to know less than it wants to, but
it is not allowed to claim more than it knows. A measurement we don’t have is
not reported as zero (§10 of `HOW-IT-WORKS.md`).*
