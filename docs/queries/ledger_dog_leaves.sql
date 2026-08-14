-- Per-dog ledger leaves, in chain order. INVARIANT 9/10.
--
-- This is the query the Merkle tree is built over, in two places that MUST
-- agree byte for byte: `DOG_LEDGER_SQL` in apps/api/src/routes/medical.ts (which
-- computes and persists `medical_records.merkle_root` on every append, under the
-- chain advisory lock) and the same constant in apps/api/src/routes/ledger.ts
-- (which serves `GET /api/v1/ledger/proof`). An inclusion proof is only
-- checkable against a root computed over the same leaves in the same order, so a
-- divergence between the two would surface to an auditor as "tampered" on
-- untampered data — the worst possible failure mode for a tamper-evidence
-- feature, because it destroys trust in the mechanism rather than in the data.
--
-- It is documented here so INVARIANT 12's gate (ops/check-queries.sh) EXPLAINs
-- it against the committed schema on every CI run. The index it needs is
-- `medical_records_dog_chain_ix (dog_id, created_at, id)`, added by migration
-- 0014 — without it this is a filter + sort over the whole table on every
-- medical-record append, while holding a global advisory lock.
--
-- Only id and hash_curr are selected on purpose: a leaf is
-- SHA256(0x00 || record.hash) and `id` only locates a leaf's index, so reading
-- every `payload` JSONB would be pure I/O for bytes that are never hashed.
--
-- (created_at, id) is the ordering the hash chain itself uses. Note the honest
-- caveat recorded in medical.ts: created_at is the TRANSACTION timestamp, so two
-- overlapping appends can be lock-ordered one way and created_at-ordered the
-- other. The chain's own recomputeHead already depends on this ordering, so the
-- Merkle tree is no more exposed than the chain is — which is exactly why the
-- ordering is spelled out identically here, in medical.ts, in ledger.ts and in
-- the worker rather than left to each query's convenience.
SELECT id, hash_curr AS hash
  FROM medical_records
 WHERE dog_id = $1
 ORDER BY created_at ASC, id ASC
