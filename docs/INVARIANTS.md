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
| 9 | Ledger hash-chained, length-prefixed payloads | ✅ | `@hetja/ledger` (hashInput) + `medical.ts` chain write under advisory lock |
| 10 | Daily published anchor | ✅ (API) | `ledger.ts` anchor + verify endpoints; worker `anchor_ledger` job |
| 11 | DPDP erasure = PII delete, chain stays valid | 🔶 design | pseudonymous actor IDs in chain; runbook documents erasure |
| 12 | Every documented query EXPLAINs | ✅ | `ops/check-queries.sh` CI gate |
| 13 | Scan landing <40KB gzipped | ✅ | 7.3 KB gzipped; `size:gate` fails build >40KB |
| 14 | AI validation flags, never silently rejects | ✅ | `apps/ai/worker.py` stub → `flagged`; test asserted |
| 15 | Verification gates: provisional feeders auto-paused after 3 serial rejects | ✅ | `lib/trust.ts` gate + `trust.test.ts` (serial rejects pause provisional feeder) |

Legend: ✅ done + tested · 🔄 in flight · 🔶 designed/documented

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
   fresher one, walking the dog's known location backwards. Clock skew is
   clamped to ±15 minutes (a phone's clock can drift or be wrong) and ties
   break on `received_at` only because two clients cannot otherwise be
   ordered. This field is load-bearing for the SOS geofence, so getting it
   backwards has a safety consequence, not just a data-quality one.
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
8. **Medical ledger chaining is on from the first migration.** Retrofitting a
   hash chain over already-unchained history produces a genesis block whose
   only honest meaning is "trust everything written before this point,"
   which defeats the point of a tamper-evident chain for exactly the older
   records an auditor would care about most.
9. **Hash inputs are length-prefixed:**
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
