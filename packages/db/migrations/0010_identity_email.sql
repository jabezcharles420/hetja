-- Hetja · migration 0010_identity_email
-- Moves feeder login from phone OTP to email OTP. Two changes:
--
-- 1. RENAME, not ADD. feeders.phone_hmac is NOT NULL UNIQUE and is the
--    ON CONFLICT target of the auth upsert (apps/api/src/routes/auth.ts).
--    Adding email_hmac alongside it would force every insert to invent a
--    fake phone (or relax NOT NULL, weakening the one-identity-per-feeder
--    guarantee). The column has always meant "one-way hash of whatever
--    channel we verify identity through" -- INVARIANT 3 never said "phone"
--    specifically, it said "never store bare contact info, only its HMAC".
--    Renaming makes the column channel-agnostic instead of adding a second,
--    parallel identity column. No foreign keys reference phone_hmac (every
--    other table references feeders.id), so this is a pure rename: the
--    blast radius is application code, not data, and no rows change.
ALTER TABLE feeders RENAME COLUMN phone_hmac TO identity_hmac;

-- feeders_phone_hmac_key (the UNIQUE constraint's auto-generated index name)
-- is left as-is by Postgres on a column rename -- it still enforces
-- uniqueness correctly, it just keeps its old name. Not worth a second
-- statement to cosmetically rename an index nobody queries by name.

-- 2. OTP codes move out of the API process's memory and into Postgres.
--    The previous store (apps/api/src/lib/otp.ts) was an in-memory Map:
--    every pending code was lost on restart or deploy, and a second API
--    process (or a future horizontally-scaled deployment) would never see
--    codes issued by the first. Keyed on identity_hmac -- the same
--    HMAC-SHA256(pepper, email) as feeders.identity_hmac -- so the table
--    never holds a bare email address, only its one-way hash, matching
--    INVARIANT 3's spirit. code_hash is SHA-256(pepper:code): the literal
--    6-digit code is never persisted anywhere, in memory or on disk.
CREATE TABLE otp_codes (
  identity_hmac  TEXT PRIMARY KEY,
  code_hash      TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  attempts_used  INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- New tables get no privileges by default in this database (there is no
-- ALTER DEFAULT PRIVILEGES set up for app_user) -- see the same pattern for
-- every prior table the app reads/writes. Without this grant the API's
-- app_user connection can create the table (as this migration's owner) but
-- can never query it at runtime.
-- Guarded on role existence so this migration applies to both targets:
-- self-hosted Postgres (where app_user is the application's login role) and
-- managed Supabase (where the app connects as postgres.<project-ref> and no
-- app_user exists, making a grant to it impossible and meaningless).
-- GRANT/REVOKE are utility commands, so plpgsql needs EXECUTE.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON otp_codes TO app_user';
  END IF;
END $do$;
