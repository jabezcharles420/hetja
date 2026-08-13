-- Hetja · migration 0012_ledger_truncate_and_ownership
--
-- INVARIANT 9 says medical_records is append-only. It was not.
--
-- 0001_init.sql enforces it with `REVOKE UPDATE, DELETE ON medical_records FROM
-- app_user`, and ops/supabase/03_hardening.sql with a BEFORE UPDATE OR DELETE
-- FOR EACH ROW trigger. Neither covers TRUNCATE:
--
--   * TRUNCATE is a distinct privilege. `GRANT ALL ON ALL TABLES ... TO app_user`
--     hands it over, and the REVOKE above never takes it back.
--   * A row-level BEFORE UPDATE OR DELETE trigger does not fire on TRUNCATE at
--     all -- TRUNCATE needs its own statement-level trigger -- so the Supabase
--     side had the identical hole by a different route.
--
-- Verified against hetja_test as app_user, inside a rolled-back transaction:
--     UPDATE   -> ERROR: permission denied for table medical_records
--     DELETE   -> ERROR: permission denied for table medical_records
--     TRUNCATE -> TRUNCATE TABLE          <-- succeeded
--
-- One statement, executed as the role the API itself runs as, erases every
-- dog's treatment history. The hash chain does not help: it makes an ALTERED
-- history detectable, but an empty table has nothing to verify against, and the
-- ledger's purpose is to be worth something in front of someone who does not
-- trust us -- a cruelty prosecution, a municipal audit.
--
-- Fixed in two layers, deliberately:
--
--   1. REVOKE TRUNCATE from app_user, so the application role simply cannot.
--   2. A statement-level BEFORE TRUNCATE trigger, which binds EVERY role
--      including the table's owner and a superuser. app_user does not own
--      medical_records (postgres does), so app_user cannot drop the trigger to
--      get around it. This layer is also what protects the Supabase copy, where
--      app_user does not exist and layer 1 is a no-op.
--
-- Layer 2 also closes an indirect path: TRUNCATE ... CASCADE on a table that
-- medical_records references would truncate medical_records too, without the
-- statement ever naming it.
--
-- No data is read, written or removed by this migration. It only changes
-- privileges, adds a trigger, and corrects two table owners.

-- ---------------------------------------------------------------------------
-- 1. Take TRUNCATE away from the application role.
--
-- Guarded on role existence so this file applies to both targets: self-hosted
-- Postgres, where app_user is the application's login role, and Supabase, where
-- the app connects as postgres.<project-ref> and no app_user exists. GRANT and
-- REVOKE are utility commands, so plpgsql needs EXECUTE.
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'REVOKE TRUNCATE ON medical_records FROM app_user';
  END IF;
END $do$;

-- ---------------------------------------------------------------------------
-- 2. Statement-level trigger -- the layer that holds for every role.
--
-- `private` is not exposed to PostgREST on Supabase, and 03_hardening.sql
-- already creates it there; IF NOT EXISTS makes this safe on the self-hosted
-- cluster, which has no such schema yet.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.forbid_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION
    'medical_records is append-only (INVARIANT 9): TRUNCATE denied. '
    'Corrections must insert a new row with corrects_record_id set.';
END $fn$;

DROP TRIGGER IF EXISTS medical_records_no_truncate ON medical_records;
CREATE TRIGGER medical_records_no_truncate
  BEFORE TRUNCATE ON medical_records
  FOR EACH STATEMENT EXECUTE FUNCTION private.forbid_truncate();

-- ---------------------------------------------------------------------------
-- 3. Correct two table owners.
--
-- The live database had 18 tables owned by postgres and two owned by app_user:
-- care_providers and schema_migrations. They drifted because migrations 0008
-- and later were applied over a TCP connection as app_user rather than as the
-- superuser, and in PostgreSQL the creating role becomes the owner.
--
-- This is not cosmetic. An owner has implicit full rights on its table
-- regardless of GRANTs, so app_user could DROP care_providers -- the directory
-- behind the emergency care panel -- and no REVOKE would stop it. It is also
-- the exact shape of the bug that produced 48 CI failures: when app_user owns
-- medical_records, 0001_init.sql's REVOKE strips the owner's own rights and the
-- referential-integrity trigger behind `DELETE FROM dogs` then fails as that
-- owner, because such a trigger runs as the REFERENCING table's owner.
--
-- Wrapped in an exception handler rather than guarded by a privilege check:
-- ALTER TABLE ... OWNER TO requires membership in the target role, and on
-- Supabase the connecting role is not a true superuser. Failing to re-own a
-- table there is not a reason to fail the whole migration -- the ownership
-- problem is specific to the self-hosted cluster -- so it degrades to a notice.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['care_providers', 'schema_migrations'] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_tables
       WHERE schemaname = 'public' AND tablename = t AND tableowner <> 'postgres'
    ) THEN
      BEGIN
        EXECUTE format('ALTER TABLE public.%I OWNER TO postgres', t);
        RAISE NOTICE 'reassigned owner of %.% to postgres', 'public', t;
      EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
        RAISE NOTICE 'could not reassign owner of %.% (%) -- leaving as is',
          'public', t, SQLERRM;
      END;
    END IF;
  END LOOP;
END $do$;

-- ---------------------------------------------------------------------------
-- 4. Restore the privilege set the reassigned tables need.
--
-- Changing an owner does not change GRANTs, but care_providers was owned by
-- app_user, which means app_user held its rights implicitly rather than through
-- a GRANT. Once postgres owns it, those implicit rights are gone and the API's
-- GET /api/v1/care would start failing with "permission denied for table
-- care_providers". schema_migrations needs the same treatment or the migration
-- runner cannot record future migrations.
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON care_providers TO app_user';
    EXECUTE 'GRANT SELECT, INSERT ON schema_migrations TO app_user';
  END IF;
END $do$;
