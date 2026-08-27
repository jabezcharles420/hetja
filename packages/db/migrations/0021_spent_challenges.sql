-- Hetja · migration 0021_spent_challenges
--
-- Durable single-use registry for PoW challenges (enhancement stack D.4,
-- INVARIANT 7's anti-abuse backstop). Replaces the per-process LRU that lived
-- in apps/api/src/routes/devices.ts, which was "single-use per process
-- lifetime" rather than per system: a restart, deploy or OOM-kill inside the
-- 120s challenge TTL emptied the LRU and a held (challenge, solution) pair
-- minted a second token. On this box `next build` OOM-killing live services
-- is documented in AGENTS.md §g, so that window is not theoretical.
--
-- Table: one row per spent challenge signature (the challenge.signature HMAC,
-- which is unique per issuance because every challenge draws a fresh nonce +
-- salt). The PK makes check-then-set atomic across processes AND restarts via
-- `INSERT ... ON CONFLICT (challenge_hash) DO NOTHING RETURNING`.
--
-- TTL: challenges are valid for 120s (CHALLENGE_TTL_MS); entries are kept for
-- 150s (SPENT_TTL_MS = 120s + 30s slack) so a challenge spent near the end of
-- its life stays rejected until it expires. Swept by worker retention and by
-- a periodic DELETE; index on expires_at makes the sweep a range delete.
--
-- ADDITIVE ONLY: one CREATE TABLE IF NOT EXISTS + one index. Nothing here
-- matches ops/check-destructive-migrations.sh's patterns, so no
-- MIGRATION-APPROVED marker is needed.
--
-- Naming: brief says `spent_challenges(challenge_hash PK, spent_at)` with
-- 150s TTL; the code comment in devices.ts described it as
-- `(signature TEXT PK, expires_at)`. Both are kept — challenge_hash is the
-- canonical key (the signature value), spent_at records when it was consumed,
-- expires_at is the absolute expiry for the sweep. Callers may use either
-- name; we keep `challenge_hash` as PK per brief and `signature` as an alias
-- via a view would be overkill — the route inserts into challenge_hash.

CREATE TABLE IF NOT EXISTS spent_challenges (
  challenge_hash TEXT PRIMARY KEY,
  spent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS spent_challenges_expires_at_ix ON spent_challenges (expires_at);

-- api's app_user must be able to INSERT (mint) and DELETE (sweep) plus SELECT
-- (existence check via the ON CONFLICT return). New tables get no privileges
-- by default (no ALTER DEFAULT PRIVILEGES for app_user) — without this grant
-- the API's app_user connection can create the table as the migration's owner
-- (postgres) but can never query it at runtime. Guarded on role existence so
-- this migration applies to both targets: self-hosted Postgres (where app_user
-- exists) and Supabase (where it does not).
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, DELETE ON spent_challenges TO app_user';
  END IF;
END $do$;

-- Honest documentation that this table is the durability backstop for the
-- PoW single-use registry.
COMMENT ON TABLE spent_challenges IS
  'Durable spent-challenge registry for PoW device-token issuance (replaces '
  'in-process LRU in routes/devices.ts): challenge_hash is the HMAC signature '
  '(unique per issuance), expires_at = now() + 150s, swept by worker retention.';

-- collars.bound_once is DEAD: BOOLEAN DEFAULT TRUE never read/written
-- (grep -rn bound_once apps/ has zero hits beyond schema). Keeping the
-- column so old backups restore; do not start populating it without a
-- design. Additive documentation only — dropping would need
-- MIGRATION-APPROVED and buys nothing but risk.
COMMENT ON COLUMN collars.bound_once IS
  'DEAD COLUMN: never read/written by any code path ( ajouté in 0001 ). '
  'Kept so old backups restore; do not rely on it. The binding is enforced '
  'by collars.qr_code uniqueness and status, not by this flag.';
