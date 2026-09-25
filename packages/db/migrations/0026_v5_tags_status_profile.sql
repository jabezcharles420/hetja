-- Hetja · migration 0026_v5_tags_status_profile
--
-- Design v5 (docs/design/v5-handoff/CONTRACT.md, "API additions"). Four groups:
--
-- 1. feeders: the profile N1 (/welcome) and N6 (/settings) edit.
--      wards        0 to 6 canonical BMC ward ids. When non-empty the SOS
--                   fan-out pages this feeder only for dogs in these wards, and
--                   for any dog in them (lib/sos-eligibility.ts, routes/sos.ts,
--                   docs/queries/sos_fanout.sql). A ward is as fine as any
--                   public surface names a place (INVARIANT 2), so this is not
--                   a location column.
--      quiet_start / quiet_end   minutes after midnight, Asia/Kolkata. Every
--                   push except SOS is held back inside the window (the worker
--                   applies it at send time). Both set or both NULL.
--      alerts_mode  'all' | 'sos_only'. NULL reads as 'all', the default
--                   the contract names, so no backfill is needed.
--      onboarded_at when N1 was completed. NULL = not yet.
--      deleted_at   DELETE /api/v1/feeders/me anonymises the row instead of
--                   deleting it (dogs and feed logs stay, INVARIANT 11's shape)
--                   and stamps this. lib/require-role.ts treats a stamped row
--                   exactly like an erased one: FEEDER_GONE.
--
-- 2. dogs: markings (R4 "How to spot her", at most 8 short strings), the
--    verification stamp (a vet checkup or a second feeder's confirmation),
--    vaccine_due_month (N3 "Next vaccine due", read by My dogs) and
--    tag_review_since (set by a 'wrong_dog' tag report; feeds on the dog earn
--    no trust until a feeder checks it; SOS is NEVER paused by it).
--
-- 3. sos_notifications.declined_at ("I can't go right now", which never
--    affects escalation) and sos_cases.note. The note a reporter types on
--    POST /api/v1/reports was validated and then used only inside the dedupe
--    key: it was never stored, so the N2 responder screen had nothing to show.
--    It is readable only by the people GET /sos/cases/:id already admits.
--
-- 4. Three new tables: tag_reports (F4/F5/F6), tag_prints (R7 history) and
--    dog_status_reports (N9). Every feeder reference is ON DELETE SET NULL for
--    the same reason dogs.registered_by is (0019): erasure must be able to
--    delete a feeders row without deleting the register's history.
--    tag_reports.reporter_device is a SHA-256 of the canonical device id, never
--    the token and never the id itself: it exists only to deduplicate.
--
-- ADDITIVE ONLY, shaped for both targets (local PostgreSQL and Supabase):
--   * ADD COLUMN IF NOT EXISTS, nullable or with a constant default (a
--     catalog-only change since PostgreSQL 11: no table rewrite).
--   * CHECK constraints on existing tables go through guarded DO blocks, added
--     NOT VALID and then validated, like 0024: a re-run is a no-op and the
--     validation never holds writes behind a full-table check.
--   * CREATE TABLE / CREATE INDEX IF NOT EXISTS, and the guarded app_user
--     GRANT pattern of 0022/0023.
-- Nothing here matches ops/check-destructive-migrations.sh's patterns.

-- ---------------------------------------------------------------------------
-- 1. feeders
-- ---------------------------------------------------------------------------
ALTER TABLE feeders ADD COLUMN IF NOT EXISTS wards        TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE feeders ADD COLUMN IF NOT EXISTS quiet_start  SMALLINT;
ALTER TABLE feeders ADD COLUMN IF NOT EXISTS quiet_end    SMALLINT;
ALTER TABLE feeders ADD COLUMN IF NOT EXISTS alerts_mode  TEXT;
ALTER TABLE feeders ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;
ALTER TABLE feeders ADD COLUMN IF NOT EXISTS deleted_at   TIMESTAMPTZ;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'feeders_alerts_mode_chk' AND conrelid = 'feeders'::regclass) THEN
    ALTER TABLE feeders ADD CONSTRAINT feeders_alerts_mode_chk
      CHECK (alerts_mode IS NULL OR alerts_mode IN ('sos_only', 'all')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'feeders_quiet_hours_chk' AND conrelid = 'feeders'::regclass) THEN
    ALTER TABLE feeders ADD CONSTRAINT feeders_quiet_hours_chk
      CHECK ((quiet_start IS NULL AND quiet_end IS NULL)
             OR (quiet_start BETWEEN 0 AND 1439 AND quiet_end BETWEEN 0 AND 1439
                 AND quiet_start <> quiet_end)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'feeders_wards_max_chk' AND conrelid = 'feeders'::regclass) THEN
    ALTER TABLE feeders ADD CONSTRAINT feeders_wards_max_chk
      CHECK (cardinality(wards) <= 6) NOT VALID;
  END IF;
END $do$;

ALTER TABLE feeders VALIDATE CONSTRAINT feeders_alerts_mode_chk;
ALTER TABLE feeders VALIDATE CONSTRAINT feeders_quiet_hours_chk;
ALTER TABLE feeders VALIDATE CONSTRAINT feeders_wards_max_chk;

-- The fan-out's ward branch is `f.wards @> ARRAY[<dog ward>]`, which a GIN
-- index serves. Partial on opted-in rows: nobody else is ever paged.
CREATE INDEX IF NOT EXISTS feeders_wards_gix ON feeders USING GIN (wards) WHERE sos_opt_in;

COMMENT ON COLUMN feeders.wards IS
  'Canonical BMC ward ids (0 to 6) this feeder feeds in. Non-empty: SOS pages '
  'only for dogs in these wards, and for any dog in them (lib/sos-eligibility.ts).';
COMMENT ON COLUMN feeders.quiet_start IS
  'Quiet hours start, minutes after midnight Asia/Kolkata. Holds back every push except SOS.';
COMMENT ON COLUMN feeders.quiet_end IS
  'Quiet hours end, minutes after midnight Asia/Kolkata. Both set or both NULL.';
COMMENT ON COLUMN feeders.alerts_mode IS
  '''all'' (NULL reads as this) or ''sos_only''. Governs non-SOS pushes only.';
COMMENT ON COLUMN feeders.deleted_at IS
  'Set by DELETE /api/v1/feeders/me: the row is anonymised, not deleted, and '
  'every auth check treats it as gone.';

-- ---------------------------------------------------------------------------
-- 2. dogs
-- ---------------------------------------------------------------------------
ALTER TABLE dogs ADD COLUMN IF NOT EXISTS markings         TEXT[];
ALTER TABLE dogs ADD COLUMN IF NOT EXISTS verified_at      TIMESTAMPTZ;
ALTER TABLE dogs ADD COLUMN IF NOT EXISTS verified_by      UUID REFERENCES feeders(id) ON DELETE SET NULL;
ALTER TABLE dogs ADD COLUMN IF NOT EXISTS verified_via     TEXT;
ALTER TABLE dogs ADD COLUMN IF NOT EXISTS tag_review_since TIMESTAMPTZ;
ALTER TABLE dogs ADD COLUMN IF NOT EXISTS vaccine_due_month TEXT;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'dogs_verified_via_chk' AND conrelid = 'dogs'::regclass) THEN
    ALTER TABLE dogs ADD CONSTRAINT dogs_verified_via_chk
      CHECK (verified_via IS NULL OR verified_via IN ('vet', 'feeder')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'dogs_markings_max_chk' AND conrelid = 'dogs'::regclass) THEN
    ALTER TABLE dogs ADD CONSTRAINT dogs_markings_max_chk
      CHECK (markings IS NULL OR cardinality(markings) <= 8) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'dogs_vaccine_due_month_chk' AND conrelid = 'dogs'::regclass) THEN
    ALTER TABLE dogs ADD CONSTRAINT dogs_vaccine_due_month_chk
      CHECK (vaccine_due_month IS NULL OR vaccine_due_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') NOT VALID;
  END IF;
END $do$;

ALTER TABLE dogs VALIDATE CONSTRAINT dogs_verified_via_chk;
ALTER TABLE dogs VALIDATE CONSTRAINT dogs_markings_max_chk;
ALTER TABLE dogs VALIDATE CONSTRAINT dogs_vaccine_due_month_chk;

-- F3 "Find by ward and photo" and the ward look-out: public dogs of one ward,
-- most recently seen first. dogs_ward_ix (0001) covers 'active' only.
CREATE INDEX IF NOT EXISTS dogs_ward_public_ix ON dogs (ward_id, last_seen_at DESC)
  WHERE status IN ('active', 'lost');

COMMENT ON COLUMN dogs.verified_at IS
  'When the dog was verified: a vet checkup (verified_via = vet) or a second '
  'feeder who is not its registrator (verified_via = feeder).';
COMMENT ON COLUMN dogs.vaccine_due_month IS
  'YYYY-MM the next vaccine is due, from the latest vet checkup (N3). The same '
  'fact is in that checkup''s ledger row; this copy is what My dogs reads.';
COMMENT ON COLUMN dogs.tag_review_since IS
  'Set by a wrong_dog tag report. Feeds earn no trust and the profile shows '
  '"Tag under review" until a feeder resolves it checked_ok. Never pauses SOS.';

-- ---------------------------------------------------------------------------
-- 3. SOS
-- ---------------------------------------------------------------------------
ALTER TABLE sos_notifications ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;
ALTER TABLE sos_cases ADD COLUMN IF NOT EXISTS note TEXT;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'sos_cases_note_len_chk' AND conrelid = 'sos_cases'::regclass) THEN
    ALTER TABLE sos_cases ADD CONSTRAINT sos_cases_note_len_chk
      CHECK (note IS NULL OR char_length(note) <= 500) NOT VALID;
  END IF;
END $do$;

ALTER TABLE sos_cases VALIDATE CONSTRAINT sos_cases_note_len_chk;

COMMENT ON COLUMN sos_notifications.declined_at IS
  '"I can''t go right now" (POST /sos/cases/:id/decline). Never affects escalation.';
COMMENT ON COLUMN sos_cases.note IS
  'The reporter''s note from POST /api/v1/reports. Readable only by the acker, '
  'the responders paged for the case, and moderators.';

-- ---------------------------------------------------------------------------
-- 4. New tables
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tag_reports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dog_id             UUID NOT NULL REFERENCES dogs(id),
  kind               TEXT NOT NULL
                       CHECK (kind IN ('damaged', 'found_on_ground', 'wrong_dog', 'too_tight')),
  reporter_feeder_id UUID REFERENCES feeders(id) ON DELETE SET NULL,
  reporter_device    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at        TIMESTAMPTZ,
  resolved_by        UUID REFERENCES feeders(id) ON DELETE SET NULL,
  resolution         TEXT CHECK (resolution IS NULL OR resolution IN ('reprinted', 'spare', 'checked_ok')),
  CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);

CREATE INDEX IF NOT EXISTS tag_reports_dog_ix ON tag_reports (dog_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tag_reports_open_ix ON tag_reports (dog_id) WHERE resolved_at IS NULL;

COMMENT ON TABLE tag_reports IS
  'A problem with a dog''s collar tag, reported from the collar page (device '
  'token or account). Deduplicated per reporter, dog and kind for 24 h by the '
  'API. reporter_device is SHA-256 of the canonical device id, used only to '
  'deduplicate; never the token.';

CREATE TABLE IF NOT EXISTS tag_prints (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dog_id     UUID NOT NULL REFERENCES dogs(id),
  printed_by UUID REFERENCES feeders(id) ON DELETE SET NULL,
  layout     TEXT NOT NULL CHECK (layout IN ('tags', 'notice', 'batch')),
  paper      TEXT NOT NULL CHECK (paper IN ('a4', 'letter')),
  tag_count  SMALLINT NOT NULL CHECK (tag_count BETWEEN 1 AND 48),
  printed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tag_prints_dog_ix ON tag_prints (dog_id, printed_at DESC);

CREATE TABLE IF NOT EXISTS dog_status_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dog_id       UUID NOT NULL REFERENCES dogs(id),
  kind         TEXT NOT NULL CHECK (kind IN ('not_seen', 'adopted', 'passed_away')),
  reported_by  UUID REFERENCES feeders(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_by UUID REFERENCES feeders(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS dog_status_reports_dog_ix ON dog_status_reports (dog_id, created_at DESC);

COMMENT ON TABLE dog_status_reports IS
  'N9 updates by a feeder of the dog. not_seen and adopted apply at once; '
  'passed_away waits for a second feeder (confirmed_by / confirmed_at).';

-- Same guarded-grant pattern as 0022/0023: new tables get no privileges by
-- default. DELETE matches 0022's set for ordinary tables (nothing in the API
-- deletes from these; operator clean-up and the test suite do).
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON tag_reports TO app_user';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON tag_prints TO app_user';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON dog_status_reports TO app_user';
  END IF;
END $do$;
