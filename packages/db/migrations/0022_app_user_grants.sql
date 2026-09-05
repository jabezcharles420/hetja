-- Hetja · migration 0022_app_user_grants
--
-- Make the application role's table privileges part of the schema instead of
-- a manual step. 0001_init.sql created every core table and granted NOTHING
-- to app_user; only 0010 (otp_codes), 0013 (web_vitals) and 0021
-- (spent_challenges) carried their own GRANT block. Every other table has
-- relied on an operator running `GRANT ALL ON ALL TABLES IN SCHEMA public TO
-- app_user` once, by hand (AGENTS.md §f, ci.yml "Grant app_user production's
-- privilege set"). A blanket grant only covers tables that exist when it runs.
--
-- That is not theoretical. On the production box the blanket grant predated
-- 0017_refresh_tokens.sql, so `refresh_tokens` had no privileges for app_user
-- at all. `POST /api/v1/auth/verify` inserts into it right after upsertFeeder
-- (routes/auth.ts) -- every successful OTP verify would have failed with
-- "permission denied for table refresh_tokens" after consuming the code.
-- Found and hot-fixed by hand on 2026-09-05; this migration is the durable fix
-- and closes the same gap for push_subscriptions (BUGS P2-6) and any fresh
-- cluster that follows AGENTS.md literally.
--
-- Privilege set mirrors production's, deliberately narrower than GRANT ALL:
--   * SELECT, INSERT, UPDATE, DELETE on ordinary tables (no TRUNCATE, no
--     REFERENCES, no TRIGGER -- the API never needs them).
--   * medical_records: SELECT, INSERT only. INVARIANT 9 (append-only). The
--     REVOKEs in 0001/0012 stay in force; nothing here re-grants UPDATE,
--     DELETE or TRUNCATE there.
--   * spent_challenges keeps 0021's SELECT, INSERT, DELETE (no UPDATE needed).
--   * jobs_id_seq: USAGE, SELECT so `INSERT INTO jobs` can draw ids.
--
-- GRANT is idempotent and additive: re-running on a cluster that already has
-- the blanket grant changes nothing. Guarded on role existence like 0010 and
-- 0021 so the same file applies to Supabase, where app_user does not exist.
-- Nothing here matches ops/check-destructive-migrations.sh.

DO $do$
DECLARE
  t TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'care_providers',
    'collars',
    'dog_stories',
    'dogs',
    'dogs_geofences',
    'feeder_territories',
    'feeders',
    'geofences',
    'jobs',
    'ledger_anchors',
    'otp_codes',
    'push_subscriptions',
    'refresh_tokens',
    'scans',
    'sos_cases',
    'sos_notifications',
    'trust_events',
    'vets',
    'web_vitals'
  ] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
    END IF;
  END LOOP;

  -- Append-only (INVARIANT 9): read and insert, never anything else.
  EXECUTE 'GRANT SELECT, INSERT ON medical_records TO app_user';

  EXECUTE 'GRANT SELECT, INSERT, DELETE ON spent_challenges TO app_user';

  IF to_regclass('jobs_id_seq') IS NOT NULL THEN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE jobs_id_seq TO app_user';
  END IF;
  IF to_regclass('web_vitals_id_seq') IS NOT NULL THEN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE web_vitals_id_seq TO app_user';
  END IF;
END $do$;
