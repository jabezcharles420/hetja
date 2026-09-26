# Hetja Invariant Checklist: implementation status

Each of these encodes a defect found in an earlier design, not a preference:
see "Why this exists" below for the specific failure each one closes off.
Encoded as migrations, lint rules or tests so none of them can regress. This
file is now the source of truth for the reasoning; it used to point at an
external build guide that lived outside the repo.

| # | Invariant | Implemented | Verified by |
|---|---|---|---|
| 1 | Slugs random, non-sequential, base32 | ✅ | `packages/db/src/slugs.ts` + tests (500-gen uniqueness, check char) |
| 2 | Anonymous geo: ward / ≥500m cells, ≤2 decimals | ✅ | `packages/contracts/src/geo.ts` + tests; `dogs.ts` route test |
| 3 | identity_hmac only (HMAC-SHA256 pepper), never bare contact info **of feeders and reporters** (v7: vets' and NGOs' professional numbers are public, see the v7 section) | ✅ | `lib/hmac.ts`; schema has no feeder phone/email column; security-gate grep with a named allowlist |
| 4 | LWW on dogs.last_seen_geo by captured_at (±15 min), tie-break received_at | ✅ | `scans.ts` applyLww + `0002_dogs_received_at.sql`; test |
| 5 | scans.client_uuid UNIQUE (offline replay idempotency) | ✅ | unique index + scan replay test (`created:false`) |
| 6 | Rate limits per account/device token, never per IP (documented exceptions, each paired with a subject or global bucket: device-token minting, the two v5 finding reads, v5 tag reports, the v6 dogless SOS, and v7's health and professionals reads and problem reports; see #6 below and the v7 section) | ✅ | device tokens as write subject (`device.ts`); SOS caps per token; per-subject limiters in `lib/rate-limit.ts` |
| 7 | Anonymous SOS attested + capped (2/day, 5/week) | ✅ | `sos.ts` cap check, per device token for anon callers, per account for feeder-authed ones; global mint bucket on `/devices/token` (`lib/rate-limit.ts`) |
| 8 | medical_records append-only (no UPDATE/DELETE/**TRUNCATE**) | ✅ | `0001` REVOKE UPDATE/DELETE + `0012` REVOKE TRUNCATE and a statement-level `BEFORE TRUNCATE` trigger; tests assert app_user cannot UPDATE/DELETE |
| 9 | Ledger hash-chained, length-prefixed payloads | ✅ | `@hetja/ledger` (hashInput) + `medical.ts` chain write under advisory lock; RFC 6962 Merkle root persisted per append (`0014`) and served as an O(log n) inclusion proof by `GET /api/v1/ledger/proof` |
| 10 | Daily published anchor | 🔄 computed, signed, **not yet published externally** | `ledger.ts` anchor + verify endpoints; worker `anchor_ledger` job, now actually schedulable (see below) and signed with EdDSA via `apps/worker/src/sign-anchor.ts` when `HETJA_LEDGER_SIGNING_JWK` is set. **`ledger_anchors.published_url` is still `''`**. The head is computed, stored and signed, but only ever held by us, and INVARIANT 10's whole point is a head published "somewhere the operator does not solely control". Downgraded from ✅ deliberately. |
| 11 | DPDP erasure = PII delete, chain stays valid | 🔶 design | pseudonymous actor IDs in chain; runbook documents erasure |
| 12 | Every documented query EXPLAINs | ✅ | `ops/check-queries.sh` CI gate |
| 13 | Scan landing <40KB gzipped | ✅ | 33,260 B gzipped on 2026-09-24 (was 7.3 KB before design v4; 13,611 B of it is the Inter subset); `size:gate` fails build >40KB |
| 14 | AI validation flags, never silently rejects | ✅ | `apps/ai/worker.py` stub → `flagged`; test asserted |
| 15 | Verification gates: provisional feeders auto-paused after 3 serial rejects | ✅ | `lib/trust.ts` gate, **enforced** by `routes/scans.ts` (a paused feeder's scan answers 403 `FEEDER_PAUSED`); `trust.test.ts` + `scans.test.ts` |

Legend: ✅ done + tested · 🔄 in flight · 🔶 designed/documented

### Invariant 10 was marked ✅ against a job that could not run

Worth recording, because it is the most instructive failure found in the
2026-08-14 audit. The row above said `✅ (API)` and cited the worker's
`anchor_ledger` job. Two things were true at once:

1. The job's query was
   `SELECT hash_curr AS hash, count(*)::int AS n FROM medical_records ORDER BY created_at DESC LIMIT 1`,
   which is an aggregate beside a bare column with no `GROUP BY`. PostgreSQL rejects
   that outright, so every invocation threw and retried to `MAX_ATTEMPTS`.
2. Nothing ever enqueued it. No cron, no systemd timer, no `INSERT … kind='anchor_ledger'`
   anywhere in the repository.

So the invariant most concerned with *being checkable by someone else* was
itself unchecked, for the whole life of the row. Both are fixed: the query, and
a worker-side idempotent scheduler that needs no scheduler state because the
published anchor is itself the record of the last run. The status is now 🔄
rather than ✅ because publishing to somewhere we do not control is still
missing, which is the part that makes the anchor mean anything.

The general lesson, and the reason this note exists rather than a silent status
edit: a ✅ in this table is a claim, and a claim about a scheduled job is only as
good as evidence that the job has run. `apps/worker` had **zero** tests before
this audit, which is exactly how a query that PostgreSQL refuses to parse
survived in a life-safety-adjacent codebase.

### A numbering warning, before you grep

**The table above is the canonical numbering.** But if you `grep "INVARIANT 9"`
you will find it used for two different rules, and the older usage is the more
common one:

| Rule | Canonical (this table) | Also called, in code | Where |
|---|---|---|---|
| `medical_records` append-only | **8** | *9* | `0001_init.sql:151`, `0012_ledger_truncate_and_ownership.sql:3`, `ops/supabase/03_hardening.sql`, `ops/supabase/cutover.sh`, `ci.yml`, `deploy.yml`, `AGENTS.md §f`, `apps/api/vitest.setup.ts`, `docs/HOW-IT-WORKS.md` |
| Hash inputs length-prefixed | **9** | *9* | `packages/ledger`, `0004_ledger_payload.sql` |

`apps/api/src/routes/medical.ts` and `medical.test.ts` use the canonical
numbering (8 = append-only, 9 = length-prefixed); almost everything older uses
9 for append-only. Those historical comments have deliberately **not** been
renumbered: `0001_init.sql` is the first migration in the repo and rewriting
the reasoning in an applied migration's header to fix a citation number would
make the file disagree with what was actually run, for no safety benefit.

So: when you read "INVARIANT 9" in a migration or in CI, it means append-only.
When you read it in `packages/ledger`, it means length-prefixed hashing. Both
rules hold and both are tested; only the citation is ambiguous. New code should
use the canonical numbers above.

The count in `AGENTS.md` was also wrong for a while (it said "fourteen rules"
against a fifteen-row table); invariant 15 was added during implementation
rather than coming from the original spec.

### New public surfaces in design v4 (2026-09-24), checked against 2, 3 and 6

Design v4 and the map added public reads. None changes an invariant; each was
built to sit inside one, and is recorded here so the next reviewer does not
have to re-derive it.

- **`GET /api/v1/dogs/:slug`** now returns `wardName`, `lastFedAt`,
  `feederCount` and `storyAuthorCount`. Counts and ward-level values only:
  never an identity (3), never a position finer than the ward (2).
- **`GET /api/v1/wards`** is a static list of the 24 BMC wards (2: a ward is as
  fine as any public surface names a place).
- **`GET /api/v1/map/wards`, `/map/wards/:wardId`, `/map/places`** aggregate
  dogs and SOS cases per ward and place each ward at a fixed, hand-placed
  centre that is the same for every request (2). Open cases carry severity,
  time and state only: no note, reporter, photo or position. The only phone
  numbers are organisations' published numbers (3). Case ids are withheld from
  anyone who could not already be paged for the case.
- **`GET /api/v1/reports/:caseId/status`** answers only the device token or
  account that filed the report, returns state and timestamps and nothing
  about who responded (3), and is rate-limited per device subject, never per
  IP (6). (Design v6 changed "nothing about who responded": see the v6
  section below.)
- **Registration's self-reported vaccinated and sterilised answers**
  (`dogs.vaccinated_reported`, `dogs.sterilised_reported`, migration 0025) are
  read by no public route.

One real defect was found and fixed in the same pass: **pending and expired
dogs were publicly readable by slug.** `routes/registrations.ts` promised that
a self-serve registration "stays invisible to every public surface" until its
tag is scanned, but `GET /api/v1/dogs/:slug` had no status filter, so anyone
holding the slug could read a `pending_activation` or `expired` dog. It now
answers 404 for both, except to the registrator who filed it
(`dogs.ts`, `NON_PUBLIC_STATUSES`; `dogs.test.ts`).

### New surfaces in design v5 (2026-09-25), checked against 1, 2, 3, 6 and 8

- **`GET /api/v1/dogs/lookup`** and **`GET /api/v1/wards/:wardId/dogs`**
  (`routes/finding.ts`) return DogCards: slug, name, ward, portrait, markings,
  a last-seen time. Ward level only (2). They hand out slugs by design, so the
  bound on enumerating the register through them (1) is the rate limiting in
  #6 above, including a global bucket each; at most 5 and 30 cards. Active and
  lost dogs only.
- **`GET /api/v1/dogs/:slug`** adds flags (`verified`, `tagUnderReview`,
  `sturdierCollarSuggested`) and, for a deceased dog only, `memorial.feederNames`:
  the names of the signed-in feeders who fed them. v5 specified first name and
  initial; since v6 it is the first name only, with the opt-out below. Through
  v5 that was the one public read naming people, by the owner's decision
  (CONTRACT.md, N9). Every other v5 surface that shows a person does so to a
  signed-in account, in the public form (`lib/public-name.ts`: first name and
  initial), never contact data (3): mostly feeders of the same dog (alerts, My
  dogs, tag history, status reports), but also feeders who chose the dog's
  ward (a not-seen alert names the reporter) and responders paged for a case
  (`respondingName` on `GET /sos/cases/:id`).
- **`GET /api/v1/sos/cases/:id`** returns the dog's EXACT last position only to
  the responder who acked the case; a paged responder sees the ward (2).
- **Tag reports** are anonymous (device token) and can put a tag under review,
  which withholds feed trust on the dog. They cannot pause SOS, change
  `sos_eligible_at` or touch the fan-out. The reporter's device is stored only
  as a SHA-256 of the canonical device id, for the 24 h dedupe.
- **The vet checkup** (`POST /dogs/:slug/checkups`) appends through the one
  chain writer (`appendMedicalRecord`, routes/medical.ts), one record per
  checkup, so it stays append-only and hash-chained (8, 9).
- **`DELETE /api/v1/feeders/me`** anonymises rather than deletes (11's shape):
  name, identity HMAC, consent, wards, sessions and push subscriptions go;
  dogs, scans and ledger references stay.

### New surfaces in design v6 (2026-09-25), checked against 2, 3, 6 and 7

- **Feeders' first names on public pages (3), with an opt-out.** By the
  owner's decision, `GET /api/v1/dogs/:slug` now carries
  `feeders: { firstName }[]` and `lastFedBy`, the memorial names, the dog
  week and the reporter's status page name feeders. Public copy is the FIRST
  WORD of the display name only (`lib/public-name.ts` `firstName`): never a
  surname, an initial, an account id or contact data. Every feeder can switch
  it off ("Show my first name on dogs' pages", `feeders.show_first_name`,
  default on); on those surfaces an opted-out feeder is counted ("Rani has 2
  feeders") and never named, and the profile cache is dropped when anyone
  changes it. The setting is scoped to dogs' pages as its label says: the
  signed-in surfaces listed in the v5 section still show the public name
  (first name and initial) to other signed-in feeders whatever it is set to. This
  is a deliberate widening of what INVARIANT 3 protects (it was counts only
  through v5, first name and initial for a memorial): a first name alone,
  beside a ward, is the most that is ever public.
- **Dogless SOS (7, 2, 6).** `POST /api/v1/reports` without a dog needs a
  point inside Mumbai; the case is located to the nearest ward centre and is
  paged exactly like a dog at that point: for a `critical` report, feeders
  who chose that ward and feeders with no wards who fed within 2 km of it;
  for a `minor` or `serious` one, the feeders who chose that ward (see the
  minor/serious bullet below). At escalation the vets nearest the point get
  notification rows, which count as told only once delivered.
  Every INVARIANT 7 rule for a dog report applies unchanged, plus
  `doglessReportPerSubject` (burst 2, then 3 a day per account or device),
  `doglessReportPerIp` (burst 3, then 6 a day per address: the fifth
  IP-keyed limit, after minting, the two finding reads and tag reports,
  recorded under #6 as it requires) and one open dogless case per reporter
  per ward. The point is stored on the case (`sos_cases.geo`), given
  only to the responder who takes it, and never logged. A paged responder
  sees the ward and, if eligible, a distance rounded to 100 m from their own
  last scan.
- **The reporter's status page** (`GET /reports/:caseId/status`, the filing
  device's token or account only) now names the responder and the paged
  feeders by first name (opt-out respected) and counts vets. Never who
  anyone is beyond that, never where the responder is.
- **Alerts pause** (`feeders.sos_paused_until`, at most 30 days): a paused
  feeder has no responder standing (`lib/sos-eligibility.ts` `canRespond`,
  fixed in the pre-deploy review): not paged by any fan-out, nor by the
  re-page after a release, not handed case ids on the map, not admitted to a
  case page by standing (V22 answers `forbiddenReason: "paused"`). A case they
  were ALREADY paged for stays takeable if they open it deliberately (the
  `notified` ground of `mayAck`): a pause stops new pages, it does not take
  back a page they have. Consent (`sos_opt_in`) is unchanged by it.
- **Every SOS tells the dog's own feeders; taking it still needs the floor**
  (pre-deploy review). At filing, whatever the severity, the dog's registrator
  and feeders with a feed in the last 60 days (opted in, not paused, live) are
  told: a push and an Alerts entry, counted as told, WHATEVER their trust, so
  "Priya and Arjun know" is true for a new feeder too. Those at the severity's
  trust floor are ordinary responders; those below it get a `notify_only` row
  (migration 0028), which is NOT a ground to take the case (`mayAck`
  `notified` counts responder rows only), is not re-paged after a release, and
  never holds off escalation: a critical case whose only rows are notify-only
  escalates at once, exactly as with nobody paged. Opening the case from that
  push answers 403 with the V22 checklist plus the summary the reporter shares
  (dog, severity, ward, time), never the note, photo or spot. Critical keeps
  the city-wide responder fan-out (`docs/queries/sos_fanout.sql`); a minor or
  serious report pages no one else (dogless: the feeders who chose that ward,
  at the floor). Before this, a serious report told no feeder at all, while
  the copy said "Tells Priya, Arjun and a vet nearby".
- **"Told" means told.** The case page and the reporter's page count a paged
  feeder as told (the alert is in their account's Alerts list) and a vet or
  NGO only once a notification was actually delivered. Tier-2 escalation
  writes sms/bmc rows that nothing sends yet, so today those count as zero.

### New surfaces in design v7 (2026-09-26), checked against 2, 3, 6, 7, 8, 9 and 11

Design v7 is the Admin, Vet and NGO portals (docs/design/v7-portals/CONTRACT.md).
Migration `0029_v7_portals.sql` is additive only. Each rule below is new, and
each is tested in `apps/api/src/routes/v7.test.ts` or `apps/worker/src/v7.test.ts`.

- **INVARIANT 3, rescoped (owner decision, 2026-09-25).** A verified vet's
  public phone (`vet_profiles.phone_e164`) and an active NGO's
  (`ngos.phone_e164`) are PUBLIC professional contacts, shown where care
  providers are: the SOS answer (`professionals`), the map ward detail,
  `GET /wards/:wardId/professionals` and `GET /dogs/:slug/vets`. They exist
  to be called, like the care directory's published numbers, and they sit on
  the same named allowlist in `ops/security-gate.sh`. Everyone else is
  unchanged: a feeder's or a reporter's contact details are never stored
  except as an HMAC and never shown. Invitations (vet, team, NGO member) keep
  only the identity HMAC of the address; the address is used for one optional
  email and dropped, and is never audited or logged (tested).
- **Owner bootstrap.** `HETJA_OWNER_EMAILS` is turned into identity HMACs at
  boot (typed and canonical forms, as sign-in resolves them), and only those
  HMACs are compared (`lib/admin.ts`). The addresses are never written to the
  database or a log, but they are not erased from memory: they stay in the
  API's loaded config and in `/srv/hetja/shared/api.env`, as every secret
  does. Admin roles are LIVE reads, never JWT claims, like `feeders.role`
  (`lib/require-role.ts`); the pre-v7 `feeders.role = admin` counts as Owner.
  Every admin WRITE asks for a PERMISSION (`ROLE_PERMISSIONS`), and a role
  without it gets 403 `ADMIN_FORBIDDEN`; a few reads (`/admin/me`, `today`,
  `search`, `care`, `documents/:id`) take any admin role and filter or check
  the permission inline.
- **The audit log is append-only for everyone, the Owner included** (A6).
  `audit_log` has SELECT and INSERT for `app_user` only, a REVOKE of
  UPDATE, DELETE and TRUNCATE, a row trigger refusing UPDATE and DELETE and a
  statement trigger refusing TRUNCATE for every role, and no foreign keys (an
  ON DELETE SET NULL would itself be an UPDATE). Admin decisions, vet
  signatures, corrections and withdrawals, NGO decisions and dispatches, and
  every document opened by an admin write a row, in the same transaction as
  the change for nearly all of them (`lib/audit.ts`). Since the pre-deploy
  review this includes avatar file uploads, NGO ambulance and bed updates,
  dispatch accept and decline, drive edits, drive dogs added and updated, a
  vet declining a sign request, a vet editing their own profile, and every
  private photo opened (tested). Four are audited just after their change
  rather than in the same transaction (an NGO member change, removing a
  passkey, a vet profile edit, a drive edit). `scrubDetail` drops any
  key that could carry contact data, a position or file bytes. The CSV export
  neutralises spreadsheet formulas and is itself audited. AGENTS.md section f's
  recipe must re-apply `REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM
  app_user` after its `GRANT ALL`, as it does for `medical_records`.
- **Documents stay private** (owner decision). Certificates, photo IDs and a
  vet's vaccine-sticker photo are validated by magic bytes (PDF up to 5 MiB;
  JPEG/PNG/WebP through the photo decoder, which caps them at 2 MiB and
  strips metadata), encrypted with AES-256-GCM under `HETJA_DOCS_KEY` with the
  document id as associated data, written under `DOCS_LOCAL_DIR` (0700, never
  the photos directory Caddy serves; production `/srv/hetja/shared/documents`),
  and no file name is stored. Certificates, photo IDs and NGO registrations
  are streamed only to admins with the matching permission, audited on every
  open, and deleted by the worker 30 days after the decision (an unattached
  upload after a day). Two photos live in the same encrypted store, never in
  the public photos directory: a signed record's vaccine sticker and a sign
  request's clinic slip. Each is shown only to verified vets, the dog's
  feeders and admins holding a moderation permission (`vets` or `reports`;
  an avatar editor or a ward lead cannot open one), every open is audited,
  and each has a stated retention: a vaccine sticker is deleted 30 days after
  its record is signed (a signed record is final; a correction is a new
  record), a clinic slip 30 days after its request is decided (kept while
  the request is open). The worker's `sweep_v7` does the deleting. The
  photos are working evidence for the signing vet, not part of the ledger:
  the ledger row keeps the hash and the signature, and the photo goes.
  `POST /documents` authenticates before the body is read; `/vet/record-photos`
  reads its photo-sized body first and authenticates in the handler.
- **INVARIANTs 8 and 9: vet signatures append, never update.** A signature is
  a new `medical_records` row through `appendMedicalRecord` (the one chain
  writer), with new nullable columns: `record_source`, `signed_by`,
  `credential_id`, `assertion`, `record_hash`, `correction_reason`,
  `drive_dog_id`, `noted_by` (no foreign keys, for the same reason as the
  audit log). The passkey challenge IS the record hash,
  `sha256(canonicalJSON({ v: 1, signer, record }))`. The record hash, the
  signer and the credential id are inside the hashed payload, with
  `hash_vet_id = vet:<feederId>`, so none of them can be changed without
  breaking the chain. The assertion itself is stored in its own column,
  outside the chained payload: it can be re-verified against the chained hash
  and the credential's public key, but the chain alone does not protect the
  column's bytes. Challenges are single use and expire in five minutes; a changed
  draft, a reused challenge and an assertion without user verification are
  refused (tested). A correction is a new row with `corrects_record_id` and a
  reason, a withdrawal a row of type `withdrawal`, and only the signer may do
  either. Confirming a feeder note is a new signed row that supersedes it.
  INVARIANT 11: the hashed payload holds pseudonymous account ids only.
- **A suspended vet** (A2) cannot sign, and their vet pages
  (`vet_escalation`, `admin_assign`) are no ground to take a case
  (`lib/sos-eligibility.ts` `pageIsGround`, one rule for the ack route and
  the case page). They lose only the vet grounds: with ordinary feeder
  standing (paging on, the trust floor, a feed nearby or the ward) they can
  still take a case like any feeder. Their past signatures stay valid unless
  an admin flags them: `POST /admin/vets/:id/flag-signatures` (any status,
  audited, reversible) or removing the vet with `signatures: flag`, either of
  which marks ALL of that vet's signed records `flagged` on the health list.
  The vet's dog view answers `canSign: false` with `vetStatus` and
  `signingBlockedReason` so the app hides the signing buttons.
- **SOS routing to professionals, one rule** (`lib/sos-eligibility.ts` and
  `packages/db/src/sos-routing.ts`, shared by the API and the worker):
  feeders as before; at filing, the active NGO covering the ward (a paused one
  gets nothing), whose coordinators are paged; after 15 minutes with nobody
  taking it (at once when the NGO passes, or when no NGO covers the ward and
  no feeder could be told; an NGO with no coordinator still waits the 15
  minutes), every verified vet whose wards include the case's ward and who
  takes SOS, inside their SOS hours, government vets first, at most 15. An
  admin can assign a vet until someone has taken the case. A dispatched NGO
  member is paged for that case, so the ordinary case page admits them and the
  ordinary "I'm going" takes it (and marks the dispatch accepted). A verified
  vet covering the ward who takes SOS may take a case by that standing
  (`vetCoversWard`, which also needs `sos_available`), never a suspended one. "Told" still means told: vet and NGO pages count only
  once delivered. The N3 list gives each member's distance to the case,
  rounded to 100 m, from their own last scan; no member's position and no
  dog's position before an ack is ever returned (INVARIANT 2).
- **D13 moderation tools.** A suspended account (`feeders.suspended_at`) gets
  403 `ACCOUNT_SUSPENDED` on every write except the ways out (release a case,
  unsubscribe, delete the account) and reporting an emergency; it is never
  paged, never handed a case, holds no admin role, and its held cases are
  released on suspension. A blocked device (`blocked_devices`, SHA-256 of the
  canonical device id, never the id or the token; admins see a 16-hex
  reference) is refused scans, tag reports, problem reports and registrations
  with 403 `DEVICE_BLOCKED`; its SOS report is still accepted and still
  answered with the numbers to call, but pages nobody and escalates at once
  (INVARIANT 7's purpose). A photo taken down (`scans.photo_hidden_at`) has
  its FILE deleted from the public photos directory at once and its pointer
  cleared, so its old `/photos/<key>` URL stops working immediately; the scan
  and the feed stay (pre-deploy review; before, the file stayed reachable
  until the 7-day retention).
- **Privilege on accounts that hold admin roles** (pre-deploy review: a
  Moderator could suspend the Owner, and a suspended account holds no admin
  role, locking the Owner out). `lib/admin.ts` `guardAccountAction`, applied
  to suspending an account, blocking a device (for every account that used
  it), removing a team member and changing their role: nobody acts on their
  own account (409 `CANNOT_TARGET_SELF`); an account holding ANY admin role
  can be acted on only by an Owner (403 `OWNER_REQUIRED`); an Owner set in
  `HETJA_OWNER_EMAILS` can never be suspended, removed or demoted through the
  API (403 `CONFIG_OWNER`: change it in the secret); and an Owner is never
  the last active one (409 `LAST_OWNER`). The last rule is defensive: since
  only an active Owner may act on an Owner, and never on themselves, one
  always remains. A paused NGO gets no new routing and cannot dispatch
  (403 `NGO_PAUSED`).
- **INVARIANT 6: three more anonymous-path limits, each paired.**
  `healthReadPerSubject` (burst 30, then one every 2 s) with
  `healthReadGlobal` (20000 a day) on `GET /dogs/:slug/health`;
  `professionalsReadPerSubject` (burst 30, then one every 2 s) on the two
  professional lists; and "Report a problem"'s `problemReportPerIp` (burst 10,
  then 20 an hour) on top of `problemReportPerSubject` (per device or
  account) and `problemReportPerDog`. The reads key on the device when a valid
  `x-device-token` is presented and on the address only when there is none,
  exactly like the v5 finding reads; a refusal is a read refused, never an
  SOS, a scan or a sign-in. Every other v7 limiter is per account
  (`lib/rate-limit.ts`, "Design v7").
- **Merges never rewrite the ledger** (A5). The merged dog's scans move onto
  the kept dog (`scans.merged_from_dog_id` keeps where each came from); its
  medical records stay on it and are read with the kept dog's; its slug and
  collar answer the kept dog's page with `mergedFrom`; the "feeder of a dog"
  rule counts the merged dog's registrator; last-seen takes the merged dog's
  position only when its `last_seen_at` is newer (a plain comparison, without
  INVARIANT 4's future-skew window or `received_at` tie-break). Duplicate suggestions come from
  reports and same-ward names (a normalised trigram comparison in JS, the
  contract's fallback; no pg_trgm dependency).


The reasoning below used to live only in the build guide, which cites the
spec PDFs directly. Migrated here so it survives independently of them.

1. **Slugs random, never sequential.** A sequential `dogs.id`/`slug` lets
   anyone enumerate every dog in the system by incrementing a number, which
   also enumerates its photo, its last-seen location, and its feeder-written
   micro-story. 40 random bits + a check character closes that off; the check
   character exists purely to catch a mistyped collar entry before it becomes
   a query for the wrong dog.
2. **Public reads never return exact coordinates.** Any unauthenticated
   response (including the heatmap and any future open-data export) snaps
   geo to ward or a ≥500 m grid cell, with no exceptions. A precise last-seen
   point for a dog a feeder cares for is also, functionally, a precise
   location for that feeder; there is no reading of "anonymous" that survives
   exact coordinates being public.
3. **Contact info is HMAC'd, never hashed bare.** This was written when the
   identity channel was a 10-digit Indian mobile number: a plain SHA-256 of
   one is a ~4×10⁹-entry keyspace, small enough to brute-force in seconds on
   commodity hardware, which makes a bare hash equivalent to storing the
   number in the clear. HMAC with a pepper held outside the database
   (KMS/secret manager, never a committed env file) is what actually makes
   it one-way. The reasoning carries over unchanged now that the identity
   channel is email (`feeders.phone_hmac` was renamed to `identity_hmac` in
   migration `0010_identity_email.sql` rather than adding a parallel
   column): an email address is just as recoverable from a bare hash as a
   phone number was; the fix is the same HMAC, over a different string.

   **Rescoped in design v7 (owner decision, 2026-09-25): this protects
   feeders and reporters.** The reason is that a person who feeds dogs, or
   who reported one, must not become findable through Hetja. A vet or an
   NGO taking part as a professional is the opposite case: their number is
   published so a stranger can call it, like the care directory's. So a
   verified vet's and an active NGO's phone are stored in the clear
   (`phone_e164`) and shown publicly; everything else about a person,
   including a vet's own sign-in address, stays HMAC-only. The v7 section
   above lists every surface.
4. **Offline conflict resolution uses `captured_at`, never `received_at`.**
   A feeder's phone can be offline for hours; if the server resolved
   `last_seen_geo` by the order photos arrive rather than the order they were
   taken, a late-arriving-but-earlier observation could silently overwrite a
   fresher one, walking the dog's known location backwards. Ties break on
   `received_at` only because two clients cannot otherwise be ordered. This
   field is load-bearing for the SOS geofence, so getting it backwards has a
   safety consequence, not just a data-quality one.

   The clock-skew clamp is **asymmetric**: at most 15 minutes into the future,
   up to 30 days into the past. This rule previously read "±15 minutes" and was
   implemented as `Math.abs(now - capturedAt) <= 15min`, which contradicted the
   first sentence of this very invariant: a phone offline for hours produced a
   `capturedAt` hours old, so every feed queued offline for more than a quarter
   of an hour was rejected with a permanent 400 on sync. INVARIANT 5's
   idempotent replay had nothing left to replay, and the client, correctly
   treating a 400 as final, discarded the feed and its photo.

   Only the future direction needs a tight bound. `applyLww` keeps the greatest
   `captured_at`, so a fast or lying clock wins last-writer-wins indefinitely
   and pins `last_seen_geo`. A timestamp in the past merely loses that
   comparison, which is the correct outcome for an old observation. It cannot
   walk the location backwards, because losing is exactly what "backwards"
   means here.
5. **`scans.client_uuid` has a UNIQUE index.** It is the only mechanism that
   makes offline replay idempotent: a phone that queues a feed while offline
   and retries the sync on reconnect must produce exactly one row, not one
   per retry. Without the unique index, a flaky connection turns into
   duplicate feed credit and duplicate SOS reports.
6. **Rate limits are per account or per attested device token, never per
   IP.** Indian mobile carriers do large-scale CGNAT; hundreds of real
   subscribers can share one public IP. An IP-based limit either fails to
   stop one abuser (who churns IPs) or collectively locks out an entire
   carrier's user base for that abuser's behavior. A device token is the
   correct rate-limit subject because it identifies one client, not one NAT
   pool.

   **The first IP-keyed limit, and why it is allowed (hardening batch 1,
   2026-09-25).** `POST /api/v1/devices/token` is where a device subject is
   CREATED, so there is no device or account to key on yet. Its only bound was
   the global mint bucket (200/day), which one client could drain in about
   twenty seconds of solving and so switch off anonymous SOS for every stranger
   in the city until the next day (audit A-07). `deviceMintPerIp`
   (`lib/rate-limit.ts`: burst 10, then 10 an hour) now keys minting on the
   client address, IPv4 as is and IPv6 by its /64, checked after the proof of
   work verifies and the challenge is spent and before the global bucket. It
   does not reintroduce the CGNAT lockout this rule exists to prevent: it gates
   only minting, which a real phone does once and then keeps the token; the
   budget is generous for a shared address; and nothing else (reports, scans,
   sign-in) is keyed on the address. It relies on `TRUST_PROXY=1` (set by the
   deploy workflow) so `request.ip` is the forwarded client rather than the
   loopback proxy; without it every request would share one bucket, which fails
   closed. Any second IP-keyed limit needs its own entry here.

   **Design v5 IP-keyed limits (2026-09-25).** Three more, each for a request
   that may carry no device or account at all, and each paired with a subject
   or global bucket (`lib/rate-limit.ts`):
   - `lookupPerSubject` (`GET /api/v1/dogs/lookup`) and `wardDogsPerSubject`
     (`GET /api/v1/wards/:wardId/dogs`): keyed on the device when the request
     presents a valid `x-device-token`, and on the address (`ipBucketKey`)
     only when it presents none, which is how the web pages call them. Burst
     10, then one a minute. These reads hand out slugs by design (F2 partial
     code, F3 find by ward), so what bounds walking the register through them
     is `lookupGlobal` / `wardDogsGlobal` (3000 a day each); the per-address
     bucket only stops one client draining that. Refusal is a read refused,
     never a report or a sign-in, so a shared CGNAT address costs nothing that
     matters on the life-safety path.
   - `tagReportPerIp` (`POST /api/v1/dogs/:slug/tag-reports`): on top of the
     per-device (`tagReportPerSubject`) and per-dog (`tagReportPerDog`) limits,
     never instead of them. Burst 10, then 20 an hour. Device tokens are
     minted, 10 an hour per address, and each fresh one would otherwise bring
     a fresh budget for paging a dog's feeders.
   None of the three gates SOS, a scan or sign-in.

   **Design v6: a fifth, and the only one on an SOS path (2026-09-25).**
   `doglessReportPerIp` (burst 3, then 6 a day per address) bounds the SOS
   with no known dog, which needs no dog and so has less to key on. It sits on
   top of `doglessReportPerSubject` and INVARIANT 7's caps, never instead of
   them, and it gates only the dogless path: an SOS about a known dog is never
   keyed on the address. It is set generously because a real reporter files
   one, and a refused one is still shown the nearest vets to call. The full
   entry is in the v6 section at the top of this file.

   Every other limiter added in the same batch is per account or per device:
   scans (burst 30, then 1 a minute), scan photos (40 a day; over budget the
   scan is kept and answered `photoAccepted: false`), SOS reports (burst 6, then
   1 per 10 minutes, on top of INVARIANT 7's case caps, which are unchanged),
   stories (5 a day), SOS acks (burst 5, then 10 a day), registrations (6 a week
   of any status, per account and per device). Every 429 logs
   `{ event: "rate_limited", limiter, subjectKind }` and never the subject.
7. **No unauthenticated unbounded fan-out.** Anonymous SOS reports require an
   attested device token (Play Integrity / App Attest, or a proof-of-work
   fallback on desktop web) and are capped at 2/day and 5/week per token.
   Without this, the SOS fan-out (which pages real people's phones) becomes
   a free mechanism for paging strangers at will.

    The caps are **rolling** windows as of wave 7 (2026-08-24): `sos.ts` counted
    rows with `received_at >= now() - interval '1 day' / '7 days'`. Since the
    2026-09-07 fix pass it counts the CASES the subject opened
    (`sos_cases.opened_at` in the same rolling windows, joined to the opening
    scan), because counting scans let a held report re-open a case each time
    one was closed (docs/BUGS.md). They were
    **calendar** windows for most of the system's life
    (`received_at >= date_trunc('day'|'week', now())`), which let a token file
    two reports at 23:58 IST and two more at 00:01; the route's comment claimed
    "rolling" the whole time, so the comment was wrong about its own code until
    the code was made to match it. Wave 7 also added what INVARIANT 6 always
    required but this route never had: a per-ACCOUNT cap for feeder-authed
    callers (previously exempt from every cap), and a global token-bucket on
    `/devices/token` mints (`lib/rate-limit.ts`), because token minting was
    itself uncapped and a native solver clears the PoW in ~0.09 s.
8. **`medical_records` accepts INSERT and nothing else: no UPDATE, no
   DELETE, no TRUNCATE.** A dog's treatment history is evidence: it is what a
   cruelty prosecution or a municipal audit rests on, and a record that can be
   quietly amended afterwards proves nothing about what was known when. A
   correction is a new row that supersedes an old one, never an edit to the old
   one. TRUNCATE needed naming separately from UPDATE/DELETE because revoking
   those two does not imply it, and because a table's owner holds TRUNCATE
   regardless of GRANTs. That gap was real, and `0012` closes it with both a
   REVOKE and a statement-level `BEFORE TRUNCATE` trigger.
9. **The chain is on from the first migration, and its hash inputs are
   length-prefixed.** Retrofitting a hash chain over already-unchained history
   produces a genesis block whose only honest meaning is "trust everything
   written before this point," which defeats the point of a tamper-evident
   chain for exactly the older records an auditor would care about most. As for
   the hash itself, inputs are length-prefixed:
   `SHA256(len‖hash_prev ‖ len‖payload ‖ len‖vet_id ‖ len‖ts)`. Bare
   concatenation of variable-length fields is ambiguous: e.g. `"ab"+"c"` and
   `"a"+"bc"` concatenate to the same string, so two different medical
   records could produce the same hash by construction rather than by
   genuine collision. Length-prefixing each field removes that ambiguity
   entirely, independent of hash strength.
10. **Publish the ledger head daily.** A hash chain that is computed and
    stored by the same party that could tamper with it proves nothing about
    tampering by that party. The chain only becomes tamper-*evident* once
    its head is published somewhere the operator does not solely control, so
    a later rewrite of history is detectable by comparing against a
    previously-published anchor.
11. **No personal data inside a hashed payload.** DPDP (India's data
    protection law) erasure requires being able to delete a person's PII on
    request. If a hashed ledger payload embedded a phone number or name
    directly, satisfying an erasure request would mean either breaking the
    chain (deleting a row a later hash depends on) or leaving the PII in
    place forever. Chaining over pseudonymous actor IDs instead means the PII
    row can be deleted from `feeders` while the chain (which never held the
    PII itself) stays valid.
12. **Every documented query must run against the committed schema.** An
    earlier design published a flagship SOS query in its docs that referenced
    three columns that did not exist in the actual schema, a query nobody
    had run against real data. Requiring every query in `docs/queries/` to
    pass `EXPLAIN` in CI turns "the docs and the schema silently diverged"
    into a failing build instead of a surprise in production.
13. **Scan landing stays under 40 KB gzipped.** This is the page a stranger
    lands on from scanning a collar with their phone's own camera app, on
    whatever network they happen to have. That is the entire reason it is a static
    HTML + vanilla TS bundle with zero framework, rather than reusing the
    feeder app's stack. A framework runtime alone would blow the budget
    before a single line of the app's own code ran, on exactly the
    lowest-bandwidth, highest-urgency path in the system.
14. **A failed AI validation flags for review; it never silently rejects.**
    The detector is a Phase-0 stub today and will misclassify real photos.
    Auto-rejecting on a false negative turns a model limitation into a
    feeder being told their real, valid feed didn't count, with no recourse;
    flagging for human review preserves a path to "actually fine" that a
    silent rejection destroys. This is also why the moderation queue's
    throughput has to be a measured, owned metric before flagging is turned
    on for real: a flag nobody looks at is a silent rejection with extra
    steps.
15. **Verification gates: provisional feeders auto-paused after 3 serial
    rejects.** Added during implementation, not in the original spec: a
    provisional (unverified) feeder whose last three scans were all
    rejected or flagged is paused rather than left free to keep submitting.
    `role` is left unchanged and the pause is reversible (a human review can
    clear it). The point is to stop repeat bad-faith or malfunctioning
    submissions from accumulating before a human looks, not to punish a
    feeder for one bad photo.

    **Defect found and fixed (recorded 2026-09-07).** For the whole life of
    this row the pause was a flag nothing read. `applyVerificationGate` wrote
    an `auto_paused` trust event from inside `GET /feeders/:id/trust`, a read
    that inserted rows (docs/BUGS.md P3), and no write path ever consulted it:
    a paused feeder's next `POST /api/v1/scans` was accepted like any other, so
    "paused rather than left free to keep submitting" described nothing the
    code did. Now `routes/scans.ts` evaluates the gate before accepting a
    feeder-authed scan and refuses a paused account with 403 `FEEDER_PAUSED`
    (the offline queue treats that as final and tells the feeder); the flag is
    written there and by the explicit `POST /feeders/:id/trust/evaluate`, and
    the GET is a pure read again. SOS reporting is deliberately NOT gated: an
    emergency report from a paused account is still an emergency. "A human
    review can clear it" remains true in the same shape as before: the gate
    re-derives from the last three scans' `review_status`, so passing one of
    them (or promoting the account's `verification_tier`) lifts the pause.

Two more decisions worth carrying over even though they aren't numbered rows
in the table above:

- **Anti-abuse ships before gamification, non-negotiable ordering.**
  Streaks and leaderboards create a direct incentive to farm scans. Shipping
  rate limits, device attestation and the trust engine first means that by
  the time there is anything worth farming, the farming is already capped.
  Reversing the order means retrofitting abuse controls onto a system
  already being gamed, against real users who have already banked the
  rewards.
- **The re-tag trust gate is 50, not 75.** At the trust engine's `+1` per
  verified scan, a gate of 75 works out to roughly 45 scans of tenure before
  a feeder can re-tag a dog, meaning nobody could re-tag during a pilot's
  first weeks, which is exactly when freshly-printed collars fail and need
  replacing. 50 keeps re-tagging reachable during the pilot while still
  being well above the casual-scan noise floor; a Phase-0 escape hatch (a
  field-lead co-signature) covers a feeder who hasn't reached even that.

  **Defect found and fixed (recorded 2026-08-22).** Both the argument and the
  gate it defends assume trust accrues roughly a point per action. The shipped
  catalog was nothing like that: `TRUST_BASELINE = 30` and
  `TRUST_EVENTS.feed = 60` (`apps/api/src/lib/trust.ts`: `verified_scan` was
  +10, not +1, and `feed` dwarfed everything else), so **one** logged feed took
  a brand-new feeder from 30 to 90. That cleared every trust threshold in the
  system in one step (the 40/60 SOS fan-out floors in `sos.ts` and this 50
  re-tag gate alike), which made the "45 scans of tenure" arithmetic above a
  description of a catalog that did not exist.

  **Recalibrated the same day.** `feed` is now **+1**, making it the smallest
  positive unit and every gate a count of ordinary actions from the 30
  baseline:

  | Gate | Trust | Credited feeds required | Fastest possible (since 2026-09-25) |
  |---|---|---|---|
  | SOS fan-out and ack floor, minor/serious (`lib/sos-eligibility.ts`) | 40 | 10 | 2 days (8 + 2) |
  | Re-tag gate (this section) | 50 | 20 | 3 days (8 + 8 + 4) |
  | SOS fan-out and ack floor, critical (`lib/sos-eligibility.ts`) | 60 | 30 | 4 days (8 + 8 + 8 + 6) |

  **"Credited" changed on 2026-09-25 (hardening batch 1, audit A-02).** The
  table used to count feed SCANS, and every created feed scan was credited, so
  "10 feeds" meant ten HTTP requests: a shell loop reached the critical floor
  in thirty. A feed scan now earns its +1 only if the dog is `active`, this
  feeder has no credited feed of THIS dog on the same Mumbai calendar day (by
  server time, so a backdated `capturedAt` buys nothing), and fewer than
  `FEED_TRUST_DAILY_CAP = 8` credited feeds in the rolling last 24 hours
  (`lib/trust.ts` `feedTrustCreditAllowed`). The scan itself is always
  recorded. The same batch made these floors gate the ACK as well as the page
  (`POST /sos/cases/:id/ack` answers 403 `SOS_ACK_FORBIDDEN` unless the caller
  was paged for the case, is a moderator, or is opted in at the floor for its
  severity; a non-moderator holding 2 open acks gets 409
  `SOS_TOO_MANY_OPEN_ACKS`), and stopped feeds that reached the server more
  than 72 h after capture from moving the streak or earning the night/monsoon
  badges (`lib/gamification.ts` `BACKDATE_LIMIT_HOURS`). The cap of 8 awaits
  the owner's confirmation (audit report D14).

   This restores the "+1 per action" economics the paragraph above reasons
  from: a feed scan is self-reported (review_status starts `'pending'`), so it
  earns less than any verification-backed event, and a rescue ack
  (`sos_ack +20`) stays worth twenty routine feeds. Full catalog now
  (exactly `apps/api/src/lib/trust.ts` `TRUST_EVENTS`): `TRUST_BASELINE=30`,
  `feed +1`, `verified_scan +10`, `photo_accepted +10`, `sos_ack +20`,
  `photo_rejected -5`, `story_rejected -5`, `serial_rejects -15`,
  `auto_paused 0`, `reversal 0` (`TRUST_MIN=0`, `TRUST_MAX=100`,
  `SERIAL_REJECT_PAUSE_THRESHOLD=3`). Because scores are derived
  (`recomputeScore()` replays `trust_events` from `TRUST_BASELINE`), the
  correction needed no migration; and zero feeder rows existed in production,
  so nothing rescaled mid-flight.

  Two adjacent holes closed in the same pass, both of which also made gates
  decorative:

  - **`POST /api/v1/trust/events` is gone.** It let any feeder mint any
    catalog delta for themselves, for their own feeder id, with no admin check
    and no relation to a real scan: one request reached trust 90, two hit the
    clamp of 100. Every legitimate producer logs server-side
    (`scans.ts`, `moderation.ts`, the dispute path), so an HTTP write path had
    only illegitimate callers.
  - **Disputes no longer self-reverse.** Opening a dispute sets
    `dispute_state='open'` and nothing else; the delta reversal moved into
    `resolveDispute()`, which requires an admin. Previously the feeder a
    penalty constrained could negate that penalty with one more call.
    Resolution *restores* exactly the disputed delta and awards nothing on
    top; an extra credit would reward collecting penalties to dispute them.

## Spec corrections (documented deviations)

1. **scans partitioning (0001)**: PG cannot build a UNIQUE index on a
   RANGE-partitioned table unless the partition key is included, which would
   break invariant 5. Resolution: plain table in 0001 (fine to ~5M rows/yr);
   Phase-2 migration will hash-partition by client_uuid or use a dedup guard
   table (see RESEARCH-2 for the analysis).
2. **medical_records payload columns (0004)**: the chain hashes a canonical
   payload, so the DB must store exactly what was hashed (`payload`,
   `hash_vet_id`, `hash_ts`) so verification is possible.
3. **vets.feeder_id (0003)**: the vet registry must link to a feeder account
   so API callers resolve to their clinic + signing key.
4. **Field-level encryption of coordinates is not implementable against this
   schema, and is not needed.** The enhancement stack (§G.5, Top-25 #14)
   recommends `tweetnacl-js` `secretbox` over `care_providers.phone`,
   `dogs.exact_lat/lng` and device tokens, to close "the gap between
   INVARIANT 3 and the columns INVARIANT 3 doesn't cover". Evaluated
   2026-08-14 and **rejected**, for three separate reasons.

   *The columns it names do not exist.* There is no `dogs.exact_lat/lng`.
   Precise position lives in `dogs.last_seen_geo` and `feeders.last_known_geo`,
   both `GEOGRAPHY(Point,4326)`.

   *Encrypting them would break the SOS fan-out.* Those columns carry GIST
   indexes (`dogs_geo_gix`, `feeders_sos_gix`, and `care_geo_gix` on
   `care_providers.geo`), and the responder query is
   `ST_DWithin(f.last_known_geo, $1::geography, 2000)`. You cannot run a
   spatial predicate against a ciphertext, and you cannot index one. The only
   alternative is to decrypt every candidate row in the application and compute
   distance there, turning one indexed radius lookup into a full scan plus N
   decryptions, on the life-safety path, on a 2 GB box. There are 22 such
   references across `routes/care.ts`, `routes/sos.ts` and the worker's
   escalation job. A change that makes the geofence slower or wrong in order to
   encrypt the data the geofence exists to read is a bad trade at any price.

   *The threat it addresses is already covered elsewhere.* The real risk was
   precise coordinates leaving the box inside a backup handed to a third party.
   `restic` encrypts client-side, so Cloudflare R2 only ever holds ciphertext
   (`ops/backup/restic-backup.sh`). Against an attacker who has the database,
   a symmetric key sitting in `.env.production` on the same box adds very
   little, and INVARIANT 3's actual subject, contact information, is already
   HMAC'd with a pepper held outside the database.

   Not done for `care_providers.phone_e164` either, on separate grounds: that
   is a vet or NGO's **published** directory number, printed so a stranger can
   tap it while standing over an injured dog. Encrypting public information on
   a life-safety read path buys nothing and adds a failure mode.
   `ops/security-gate.sh` names it as an explicit tracked exception and prints
   it on every run, so the decision stays visible rather than becoming
   permanent by being quiet.
