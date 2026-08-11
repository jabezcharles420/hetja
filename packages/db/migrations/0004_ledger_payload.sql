-- 0004_ledger_payload.sql
-- The chain hashes canonicalPayload(input) + vetId + ts. To make verification
-- possible, store EXACTLY what was hashed: the canonical payload JSONB plus
-- the vetId and ts used in hashInput (INVARIANT 9 / 10).
ALTER TABLE medical_records
  ADD COLUMN IF NOT EXISTS payload    JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS hash_vet_id TEXT NOT NULL DEFAULT 'feeder',
  ADD COLUMN IF NOT EXISTS hash_ts    TEXT NOT NULL DEFAULT '';
