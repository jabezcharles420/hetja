# Hetja Invariant Checklist — implementation status

Every invariant from the blueprint v1.1 build guide, with where it lives and
how it is verified. Updated as the build progresses.

| # | Invariant | Implemented | Verified by |
|---|---|---|---|
| 1 | Slugs random, non-sequential, base32 | ✅ | `packages/db/src/slugs.ts` + tests (500-gen uniqueness, check char) |
| 2 | Anonymous geo: ward / ≥500m cells, ≤2 decimals | ✅ | `packages/contracts/src/geo.ts` + tests; `dogs.ts` route test |
| 3 | phone_hmac only (HMAC-SHA256 pepper), never bare phone | ✅ | `lib/hmac.ts`; schema has no phone column; security-gate grep |
| 4 | LWW on dogs.last_seen_geo by captured_at (±15 min), tie-break received_at | ✅ | `scans.ts` applyLww + `0002_dogs_received_at.sql`; test |
| 5 | scans.client_uuid UNIQUE (offline replay idempotency) | ✅ | unique index + scan replay test (`created:false`) |
| 6 | Rate limits per account/device token, never per IP | ✅ | device tokens as write subject (`device.ts`); SOS caps per token |
| 7 | Anonymous SOS attested + capped (2/day, 5/week) | ✅ | `sos.ts` cap check per device token |
| 8 | medical_records append-only (REVOKE UPDATE/DELETE) | ✅ | `0001` REVOKE + tests asserting app_user cannot UPDATE/DELETE |
| 9 | Ledger hash-chained, length-prefixed payloads | ✅ | `@straynet/ledger` (hashInput) + `medical.ts` chain write under advisory lock |
| 10 | Daily published anchor | ✅ (API) | `ledger.ts` anchor + verify endpoints; worker `anchor_ledger` job |
| 11 | DPDP erasure = PII delete, chain stays valid | 🔶 design | pseudonymous actor IDs in chain; runbook documents erasure |
| 12 | Every documented query EXPLAINs | ✅ | `ops/check-queries.sh` CI gate |
| 13 | Scan landing <40KB gzipped | ✅ | 7.3 KB gzipped; `size:gate` fails build >40KB |
| 14 | AI validation flags, never silently rejects | ✅ | `apps/ai/worker.py` stub → `flagged`; test asserted |
| 15 | Verification gates: provisional feeders auto-paused after 3 serial rejects | ✅ | `lib/trust.ts` gate + `trust.test.ts` (serial rejects pause provisional feeder) |

Legend: ✅ done + tested · 🔄 in flight · 🔶 designed/documented

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
