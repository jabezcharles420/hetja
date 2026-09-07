-- Hetja · migration 0023_collar_reissues_and_sos_cap_indexes
--
-- 1. collar_reissues — the audit trail POST /api/v1/dogs/:slug/collar has
--    claimed to keep since it was written, and never did.
--
-- The route's header comment said "The old collar row is retired rather than
-- deleted, so the physical history of a dog's tags stays auditable." It was
-- not. `collars.qr_code` is UNIQUE and equals the slug, and the slug does not
-- change on re-issue (every tag already in the field must keep resolving), so
-- there can only ever be ONE collars row per slug. The route therefore ran
-- `INSERT ... ON CONFLICT (qr_code) DO UPDATE` and overwrote the same row's
-- batch_no, material and issued_at in place; the `reason` the admin typed went
-- to the pino log and nowhere durable. Trace a bad print run six months later
-- and the register could not say which dogs had ever worn a tag from it.
--
-- This table is the history. One row per re-issue, carrying the provenance the
-- UPDATE is about to overwrite (previous batch, material, issue date), what
-- replaced it, why, and which admin did it. `collars` stays one-row-per-slug —
-- the verification path (routes/dogs.ts reads collars.hmac_sig by slug) is
-- untouched.
--
-- reissued_by is ON DELETE SET NULL for the same reason dogs.registered_by is
-- (0019): INVARIANT 11's DPDP erasure must be able to delete a feeders row
-- without deleting the register's history.
--
-- 2. Two indexes for the INVARIANT 7 SOS cap, which routes/sos.ts now counts in
--    sos_cases (what actually pages people) joined to scans by subject, rather
--    than in scans alone. sos_cases.scan_id had no index; the anonymous
--    subject filter on scans.device_token had none either.
--
-- ADDITIVE ONLY: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, a
-- guarded GRANT. Nothing here matches ops/check-destructive-migrations.sh.

CREATE TABLE IF NOT EXISTS collar_reissues (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collar_id          UUID NOT NULL REFERENCES collars(id),
  dog_id             UUID NOT NULL REFERENCES dogs(id),
  slug               TEXT NOT NULL,
  previous_batch_no  TEXT NOT NULL,
  previous_material  TEXT NOT NULL,
  previous_issued_at TIMESTAMPTZ NOT NULL,
  new_batch_no       TEXT NOT NULL,
  new_material       TEXT NOT NULL,
  reason             TEXT,
  reissued_by        UUID REFERENCES feeders(id) ON DELETE SET NULL,
  reissued_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE collar_reissues IS
  'One row per POST /api/v1/dogs/:slug/collar re-issue: the provenance the '
  'collars row held BEFORE the re-issue (batch, material, issued_at), what '
  'replaced it, the operator''s reason and identity. collars stays one row per '
  'slug because qr_code = slug is UNIQUE and a re-issue never changes the slug.';

CREATE INDEX IF NOT EXISTS collar_reissues_dog_ix ON collar_reissues (dog_id, reissued_at DESC);

-- The cap query joins sos_cases to the scan that opened each case, keyed on
-- the subject column of the scan (device_token for anonymous reports,
-- feeder_id for signed-in ones — the latter already has scans_feeder_recent_ix).
CREATE INDEX IF NOT EXISTS sos_cases_scan_ix ON sos_cases (scan_id);
CREATE INDEX IF NOT EXISTS scans_sos_device_ix ON scans (device_token, received_at DESC)
  WHERE scan_type = 'sos';

-- Same guarded-grant pattern as 0010/0013/0021/0022: new tables get no
-- privileges by default, and the API inserts here at re-issue time.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT ON collar_reissues TO app_user';
  END IF;
END $do$;
