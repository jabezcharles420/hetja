-- Give the medical_records hash chain an ordering key that means what it says.
--
-- THE DEFECT. Every chain-critical query ordered the ledger by
-- `created_at ASC, id ASC`. `created_at` is `DEFAULT now()`, and `now()` is
-- `transaction_timestamp()` — stamped at BEGIN. apps/api/src/routes/medical.ts
-- issues BEGIN and `pg_advisory_xact_lock(420001)` as two separate round trips,
-- so a transaction can START earlier and APPEND later. The timestamp is fixed
-- before the serialisation point, which makes it structurally incapable of
-- witnessing append order.
--
-- Measured, not theorised. Sixteen concurrent appends through the real route,
-- with no contrived timing:
--
--     inversions:          51 / 120 pairs   (42.5%)
--     chain forks created: 3
--
-- 42.5% is near-indistinguishable from a shuffle. And the advisory lock does
-- NOT prevent forks, which was the surprise: it serialises the writes, but the
-- head each writer chains onto is chosen by a pre-lock timestamp. Once a pair
-- is inverted the head SELECT returns the wrong row, so every later append
-- re-chains onto the wrong parent. Two children, one parent, and
-- `medical_records` is append-only so it cannot be corrected.
--
-- The user-visible symptom is the worst one a tamper-evidence system has:
-- `GET /api/v1/ledger/verify` reports TAMPERED over data nobody touched. Same
-- bytes, same stored hashes — only the ORDER BY differs:
--
--     db order   [B,A]  verifyChain -> valid=false  => TAMPERED
--     true order [A,B]  verifyChain -> valid=true   => VALID
--
-- An alarm that cries wolf on clean data trains operators to ignore it, which
-- costs more than having no alarm.
--
-- THE FIX. `chain_seq` is allocated by `nextval` when the row is INSERTed —
-- which happens while `pg_advisory_xact_lock(420001)` is held. Because that
-- lock is transaction-scoped, no other writer can call `nextval` until the
-- holder commits. So sequence order IS lock order IS commit order, by
-- construction rather than by hoping two clocks agree.
--
-- WHY HISTORICAL ROWS STAY NULL. This is the part that deserves the argument.
-- Three options were tested against a copy of real data:
--
--   A. plain `ADD COLUMN chain_seq BIGSERIAL`. Rejected — and not on taste.
--      PostgreSQL assigns nextval in physical HEAP order during the rewrite,
--      so the values encode the last restore, not the ledger. Building two
--      copies of the same 140 rows by two equally legal routes (heap order,
--      and `pg_dump | pg_restore` order — which is how Supabase is populated)
--      produced a different chain_seq for 140 of 140 rows. The same ledger
--      would carry two contradictory orderings on our two databases.
--
--   B. nullable column + explicit backfill in (created_at, id). Rejected twice
--      over. First, that order is measurably WRONG: walking the existing links
--      finds one child sorting before its own parent, plus one hash_prev with
--      two children. Backfilling it would launder a known-wrong order into an
--      authoritative-looking integer. Second, it is not even possible: the
--      Supabase `append_only` trigger rejects UPDATE on this table for every
--      role including a superuser, so B requires DISABLE TRIGGER around the
--      backfill — disarming INVARIANT 9's enforcement, inside an unattended
--      migration, to write an order we had already proved wrong.
--
--   C. this migration. Historical rows keep chain_seq NULL.
--
-- The chain could not be walked into a total order to recover the truth: the
-- links are clean (0 orphans) but the graph is a FOREST — 41 roots, longest
-- path 11 — and nothing stored says how those trees interleave. The
-- information required for an exact backfill was never recorded. That is
-- exactly the gap this column closes going forward, and NULL is the honest
-- name for it: "true append order was not recorded for this row."
--
-- C is also the only option that PRESERVES historical proofs. Every existing
-- `merkle_root` and every `ledger_anchors.merkle_root` was computed under
-- (created_at ASC, id ASC). Readers now order by
--
--     chain_seq ASC NULLS FIRST, created_at ASC, id ASC
--
-- so NULL rows keep exactly their current relative order and every historical
-- attestation still reproduces, while new rows sort after them by true append
-- order. A backfill that reordered even one historical row would have caused
-- the very false-TAMPERED failure this migration exists to remove.
--
-- Additive: one nullable column, one sequence, three indexes. Nothing is
-- dropped, nothing is rewritten, no row is modified.

-- Fail fast rather than queue. ADD COLUMN takes ACCESS EXCLUSIVE, and such a
-- request queues AHEAD of subsequent readers — so blocking behind one long
-- reader would stall every append for as long as that reader runs.
SET LOCAL lock_timeout = '5s';

-- The sequence is created separately and attached, rather than spelled
-- BIGSERIAL. That is load-bearing, not style: `ADD COLUMN ... BIGSERIAL` in a
-- single statement carries a volatile default and REWRITES the table, while
-- adding a plain nullable column and then setting its default is catalog-only.
-- Verified on PG 16.4 by watching relfilenode: split form 20602 -> 20602
-- (unchanged), BIGSERIAL 20609 -> 20616 (rewritten).
--
-- `GENERATED BY DEFAULT AS IDENTITY` also rewrites, and implies NOT NULL, which
-- this design cannot satisfy — historical rows must be permitted to stay NULL.
CREATE SEQUENCE IF NOT EXISTS medical_records_chain_seq_seq AS BIGINT;

ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS chain_seq BIGINT;
ALTER TABLE medical_records
  ALTER COLUMN chain_seq SET DEFAULT nextval('medical_records_chain_seq_seq');

-- Ties the sequence's lifecycle to the column, so it is not left orphaned.
ALTER SEQUENCE medical_records_chain_seq_seq OWNED BY medical_records.chain_seq;

COMMENT ON COLUMN medical_records.chain_seq IS
  'Canonical hash-chain order. Allocated by nextval() at INSERT while '
  'pg_advisory_xact_lock(420001) is held, so sequence order = lock order = '
  'commit order. NULL means the row predates migration 0017 and its true '
  'append order was never recorded — such rows sort first, among themselves by '
  '(created_at, id), which is the order their stored merkle_root was computed '
  'under. Gaps are expected and meaningful-free: nextval is non-transactional, '
  'so a rolled-back append burns a value. Never assume contiguity.';

-- A column DEFAULT is evaluated as the INSERTING role, and sequence privileges
-- are not inherited from the table. Without this grant every
-- POST /api/v1/medical_records fails with "permission denied for sequence" the
-- moment this migration lands. CI and deploy happen to run a blanket
-- `GRANT ... ON ALL SEQUENCES` after migrating, but a developer's hetja_test
-- and the Supabase target do not — so the grant belongs here, in the migration
-- that creates the sequence. Same reasoning, and same shape, as 0013_web_vitals.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE medical_records_chain_seq_seq TO app_user';
  END IF;
END $do$;

-- Two rows sharing a chain_seq would be a fork in the ordering key itself.
-- Partial, so it constrains only the rows that have one — and being partial it
-- also serves the head probe as an Index Scan Backward.
CREATE UNIQUE INDEX IF NOT EXISTS medical_records_chain_seq_uix
  ON medical_records (chain_seq) WHERE chain_seq IS NOT NULL;

-- The canonical global read order. NULLS placement must match the query's
-- exactly or the planner sorts instead of scanning; a backward scan of this
-- same index serves the DESC head query.
CREATE INDEX IF NOT EXISTS medical_records_chain_order_ix
  ON medical_records (chain_seq ASC NULLS FIRST, created_at ASC, id ASC);

-- The per-dog twin, replacing 0014's (dog_id, created_at, id) for chain reads.
CREATE INDEX IF NOT EXISTS medical_records_dog_chain_seq_ix
  ON medical_records (dog_id, chain_seq ASC NULLS FIRST, created_at ASC, id ASC);

-- 0014's medical_records_dog_chain_ix (dog_id, created_at, id) is deliberately
-- LEFT IN PLACE. The Migrate job runs before the Deploy job, so the previous
-- release queries this schema for the length of a deploy and still needs it.
-- Dropping it would also trip the destructive-change gate. Same call, same
-- reasoning, as jobs_ready_ix in 0016.
