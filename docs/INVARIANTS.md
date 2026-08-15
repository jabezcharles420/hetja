# Hetja Invariant Checklist — implementation status

Each of these encodes a defect found in an earlier design, not a preference —
see "Why this exists" below for the specific failure each one closes off.
Encoded as migrations, lint rules or tests so none of them can regress. This
file is now the source of truth for the reasoning; it used to point at an
external build guide that lived outside the repo.

| # | Invariant | Implemented | Verified by |
|---|---|---|---|
| 1 | Slugs random, non-sequential, base32 | ✅ | `packages/db/src/slugs.ts` + tests (500-gen uniqueness, check char) |
| 2 | Anonymous geo: ward / ≥500m cells, ≤2 decimals | ✅ | `packages/contracts/src/geo.ts` + tests; `dogs.ts` route test |
| 3 | identity_hmac only (HMAC-SHA256 pepper), never bare contact info | ✅ | `lib/hmac.ts`; schema has no phone/email column; security-gate grep |
| 4 | LWW on dogs.last_seen_geo by captured_at (±15 min), tie-break received_at | ✅ | `scans.ts` applyLww + `0002_dogs_received_at.sql`; test |
| 5 | scans.client_uuid UNIQUE (offline replay idempotency) | ✅ | unique index + scan replay test (`created:false`) |
| 6 | Rate limits per account/device token, never per IP | ✅ | device tokens as write subject (`device.ts`); SOS caps per token |
| 7 | Anonymous SOS attested + capped (2/day, 5/week) | ✅ | `sos.ts` cap check per device token |
| 8 | medical_records append-only (no UPDATE/DELETE/**TRUNCATE**) | ✅ | `0001` REVOKE UPDATE/DELETE + `0012` REVOKE TRUNCATE and a statement-level `BEFORE TRUNCATE` trigger; tests assert app_user cannot UPDATE/DELETE |
| 9 | Ledger hash-chained, length-prefixed payloads | ✅ | `@hetja/ledger` (hashInput) + `medical.ts` chain write under advisory lock; RFC 6962 Merkle root persisted per append (`0014`) and served as an O(log n) inclusion proof by `GET /api/v1/ledger/proof` |
| 10 | Daily published anchor | 🔄 computed, signed, **not yet published externally** | `ledger.ts` anchor + verify endpoints; worker `anchor_ledger` job, now actually schedulable (see below) and signed with EdDSA via `apps/worker/src/sign-anchor.ts` when `HETJA_LEDGER_SIGNING_JWK` is set. **`ledger_anchors.published_url` is still `''`** — the head is computed, stored and signed, but only ever held by us, and INVARIANT 10's whole point is a head published "somewhere the operator does not solely control". Downgraded from ✅ deliberately. |
| 11 | DPDP erasure = PII delete, chain stays valid | 🔶 design | pseudonymous actor IDs in chain; runbook documents erasure |
| 12 | Every documented query EXPLAINs | ✅ | `ops/check-queries.sh` CI gate |
| 13 | Scan landing <40KB gzipped | ✅ | 7.3 KB gzipped; `size:gate` fails build >40KB |
| 14 | AI validation flags, never silently rejects | ✅ | `apps/ai/worker.py` stub → `flagged`; test asserted |
| 15 | Verification gates: provisional feeders auto-paused after 3 serial rejects | ✅ | `lib/trust.ts` gate + `trust.test.ts` (serial rejects pause provisional feeder) |

Legend: ✅ done + tested · 🔄 in flight · 🔶 designed/documented

### Invariant 10 was marked ✅ against a job that could not run

Worth recording, because it is the most instructive failure found in the
2026-08-14 audit. The row above said `✅ (API)` and cited the worker's
`anchor_ledger` job. Two things were true at once:

1. The job's query was
   `SELECT hash_curr AS hash, count(*)::int AS n FROM medical_records ORDER BY created_at DESC LIMIT 1`
   — an aggregate beside a bare column with no `GROUP BY`. PostgreSQL rejects
   that outright, so every invocation threw and retried to `MAX_ATTEMPTS`.
2. Nothing ever enqueued it. No cron, no systemd timer, no `INSERT … kind='anchor_ledger'`
   anywhere in the repository.

So the invariant most concerned with *being checkable by someone else* was
itself unchecked, for the whole life of the row. Both are fixed — the query, and
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
renumbered — `0001_init.sql` is the first migration in the repo and rewriting
the reasoning in an applied migration's header to fix a citation number would
make the file disagree with what was actually run, for no safety benefit.

So: when you read "INVARIANT 9" in a migration or in CI, it means append-only.
When you read it in `packages/ledger`, it means length-prefixed hashing. Both
rules hold and both are tested; only the citation is ambiguous. New code should
use the canonical numbers above.

The count in `AGENTS.md` was also wrong for a while (it said "fourteen rules"
against a fifteen-row table) — invariant 15 was added during implementation
rather than coming from the original spec.

## Why this exists

The reasoning below used to live only in the build guide, which cites the
spec PDFs directly. Migrated here so it survives independently of them.

1. **Slugs random, never sequential.** A sequential `dogs.id`/`slug` lets
   anyone enumerate every dog in the system by incrementing a number, which
   also enumerates its photo, its last-seen location, and its feeder-written
   micro-story. 40 random bits + a check character closes that off; the check
   character exists purely to catch a mistyped collar entry before it becomes
   a query for the wrong dog.
2. **Public reads never return exact coordinates.** Any unauthenticated
   response — including the heatmap and any future open-data export — snaps
   geo to ward or a ≥500 m grid cell, with no exceptions. A precise last-seen
   point for a dog a feeder cares for is also, functionally, a precise
   location for that feeder; there is no reading of "anonymous" that survives
   exact coordinates being public.
3. **Contact info is HMAC'd, never hashed bare.** This was written when the
   identity channel was a 10-digit Indian mobile number: a plain SHA-256 of
   one is a ~4×10⁹-entry keyspace — small enough to brute-force in seconds on
   commodity hardware, which makes a bare hash equivalent to storing the
   number in the clear. HMAC with a pepper held outside the database
   (KMS/secret manager, never a committed env file) is what actually makes
   it one-way. The reasoning carries over unchanged now that the identity
   channel is email (`feeders.phone_hmac` was renamed to `identity_hmac` in
   migration `0010_identity_email.sql` rather than adding a parallel
   column) — an email address is just as recoverable from a bare hash as a
   phone number was; the fix is the same HMAC, over a different string.
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
   first sentence of this very invariant — a phone offline for hours produced a
   `capturedAt` hours old, so every feed queued offline for more than a quarter
   of an hour was rejected with a permanent 400 on sync. INVARIANT 5's
   idempotent replay had nothing left to replay, and the client, correctly
   treating a 400 as final, discarded the feed and its photo.

   Only the future direction needs a tight bound. `applyLww` keeps the greatest
   `captured_at`, so a fast or lying clock wins last-writer-wins indefinitely
   and pins `last_seen_geo`. A timestamp in the past merely loses that
   comparison, which is the correct outcome for an old observation — it cannot
   walk the location backwards, because losing is exactly what "backwards"
   means here.
5. **`scans.client_uuid` has a UNIQUE index.** It is the only mechanism that
   makes offline replay idempotent: a phone that queues a feed while offline
   and retries the sync on reconnect must produce exactly one row, not one
   per retry. Without the unique index, a flaky connection turns into
   duplicate feed credit and duplicate SOS reports.
6. **Rate limits are per account or per attested device token, never per
   IP.** Indian mobile carriers do large-scale CGNAT — hundreds of real
   subscribers can share one public IP. An IP-based limit either fails to
   stop one abuser (who churns IPs) or collectively locks out an entire
   carrier's user base for that abuser's behavior. A device token is the
   correct rate-limit subject because it identifies one client, not one NAT
   pool.
7. **No unauthenticated unbounded fan-out.** Anonymous SOS reports require an
   attested device token (Play Integrity / App Attest, or a proof-of-work
   fallback on desktop web) and are capped at 2/day and 5/week per token.
   Without this, the SOS fan-out — which pages real people's phones — becomes
   a free mechanism for paging strangers at will.
8. **`medical_records` accepts INSERT and nothing else — no UPDATE, no
   DELETE, no TRUNCATE.** A dog's treatment history is evidence: it is what a
   cruelty prosecution or a municipal audit rests on, and a record that can be
   quietly amended afterwards proves nothing about what was known when. A
   correction is a new row that supersedes an old one, never an edit to the old
   one. TRUNCATE needed naming separately from UPDATE/DELETE because revoking
   those two does not imply it, and because a table's owner holds TRUNCATE
   regardless of GRANTs — that gap was real, and `0012` closes it with both a
   REVOKE and a statement-level `BEFORE TRUNCATE` trigger.
9. **The chain is on from the first migration, and its hash inputs are
   length-prefixed.** Retrofitting a hash chain over already-unchained history
   produces a genesis block whose only honest meaning is "trust everything
   written before this point," which defeats the point of a tamper-evident
   chain for exactly the older records an auditor would care about most. As for
   the hash itself, inputs are length-prefixed:
   `SHA256(len‖hash_prev ‖ len‖payload ‖ len‖vet_id ‖ len‖ts)`. Bare
   concatenation of variable-length fields is ambiguous — e.g. `"ab"+"c"` and
   `"a"+"bc"` concatenate to the same string, so two different medical
   records could produce the same hash by construction rather than by
   genuine collision. Length-prefixing each field removes that ambiguity
   entirely, independent of hash strength.
10. **Publish the ledger head daily.** A hash chain that is computed and
    stored by the same party that could tamper with it proves nothing about
    tampering by that party — the chain only becomes tamper-*evident* once
    its head is published somewhere the operator does not solely control, so
    a later rewrite of history is detectable by comparing against a
    previously-published anchor.
11. **No personal data inside a hashed payload.** DPDP (India's data
    protection law) erasure requires being able to delete a person's PII on
    request. If a hashed ledger payload embedded a phone number or name
    directly, satisfying an erasure request would mean either breaking the
    chain (deleting a row a later hash depends on) or leaving the PII in
    place forever. Chaining over pseudonymous actor IDs instead means the PII
    row can be deleted from `feeders` while the chain — which never held the
    PII itself — stays valid.
12. **Every documented query must run against the committed schema.** An
    earlier design published a flagship SOS query in its docs that referenced
    three columns that did not exist in the actual schema — a query nobody
    had run against real data. Requiring every query in `docs/queries/` to
    pass `EXPLAIN` in CI turns "the docs and the schema silently diverged"
    into a failing build instead of a surprise in production.
13. **Scan landing stays under 40 KB gzipped.** This is the page a stranger
    lands on from scanning a collar with their phone's own camera app, on
    whatever network they happen to have — the entire reason it is a static
    HTML + vanilla TS bundle with zero framework, rather than reusing the
    feeder app's stack. A framework runtime alone would blow the budget
    before a single line of the app's own code ran, on exactly the
    lowest-bandwidth, highest-urgency path in the system.
14. **A failed AI validation flags for review; it never silently rejects.**
    The detector is a Phase-0 stub today and will misclassify real photos.
    Auto-rejecting on a false negative turns a model limitation into a
    feeder being told their real, valid feed didn't count, with no recourse —
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
    clear it) — the point is to stop repeat bad-faith or malfunctioning
    submissions from accumulating before a human looks, not to punish a
    feeder for one bad photo.

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
  a feeder can re-tag a dog — meaning nobody could re-tag during a pilot's
  first weeks, which is exactly when freshly-printed collars fail and need
  replacing. 50 keeps re-tagging reachable during the pilot while still
  being well above the casual-scan noise floor; a Phase-0 escape hatch (a
  field-lead co-signature) covers a feeder who hasn't reached even that.

## Spec corrections (documented deviations)

1. **scans partitioning (0001)**: PG cannot build a UNIQUE index on a
   RANGE-partitioned table unless the partition key is included, which would
   break invariant 5. Resolution: plain table in 0001 (fine to ~5M rows/yr);
   Phase-2 migration will hash-partition by client_uuid or use a dedup guard
   table (see RESEARCH-2 for the analysis).
2. **medical_records payload columns (0004)**: the chain hashes a canonical
   payload — the DB must store exactly what was hashed (`payload`,
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
   distance there — turning one indexed radius lookup into a full scan plus N
   decryptions, on the life-safety path, on a 2 GB box. There are 22 such
   references across `routes/care.ts`, `routes/sos.ts` and the worker's
   escalation job. A change that makes the geofence slower or wrong in order to
   encrypt the data the geofence exists to read is a bad trade at any price.

   *The threat it addresses is already covered elsewhere.* The real risk was
   precise coordinates leaving the box inside a backup handed to a third party.
   `restic` encrypts client-side, so Cloudflare R2 only ever holds ciphertext
   (`ops/backup/restic-backup.sh`). Against an attacker who has the database,
   a symmetric key sitting in `.env.production` on the same box adds very
   little — and INVARIANT 3's actual subject, contact information, is already
   HMAC'd with a pepper held outside the database.

   Not done for `care_providers.phone_e164` either, on separate grounds: that
   is a vet or NGO's **published** directory number, printed so a stranger can
   tap it while standing over an injured dog. Encrypting public information on
   a life-safety read path buys nothing and adds a failure mode.
   `ops/security-gate.sh` names it as an explicit tracked exception and prints
   it on every run, so the decision stays visible rather than becoming
   permanent by being quiet.
