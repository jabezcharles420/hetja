-- Hetja · migration 0027_v6_sos_outcomes_and_names
--
-- Design v6 (docs/design/v6-handoff/CONTRACT.md, "API additions").
--
-- 1. feeders
--      show_first_name   Settings "Show my first name on dogs' pages", on by
--                        default (owner decision, 2026-09-25). Off: the feeder
--                        is counted on a dog's page but never named.
--      sos_paused_until  L1 alerts pause. While it is in the future the SOS
--                        fan-out skips the feeder (routes/sos.ts,
--                        docs/queries/sos_fanout.sql).
--
-- 2. sos_cases: the case lifecycle and outcomes (P9 to P11, L4 to L7, V21).
--      dog_id DROP NOT NULL + ward_id + geo   the dogless SOS (P8, F1): a
--                        report with no known dog is located to the reporter's
--                        ward (a Mumbai point is required) and pages that
--                        ward's feeders and vets. `geo` is set only for a
--                        dogless case, is never returned except to the acker,
--                        and is never logged. ward_id is also stamped on
--                        every new case with a dog (the dog's ward then).
--      outcome, vet_name P11 close-out ("Taken to a vet", ...). `died` also
--                        opens the N9 passed-away status report.
--      close_by_at, arrived_at   "Tell the reporter you're close", "With Rani".
--                        Cleared when the acker releases the case.
--      reporter_left_at  "I had to leave".
--    scans.dog_id DROP NOT NULL: the scan row a dogless SOS case hangs off
--    (sos_cases.scan_id is NOT NULL and the INVARIANT 7 cap counts through
--    it). Every other scan still names a dog; the API never writes a dogless
--    scan of any other type.
--
-- 3. sos_case_events: what the timeline needs that no column holds (a release,
--    a close-by, an arrival, the reporter's updates and leaving). Append-only
--    by use; notes are the reporter's words, visible only to the people
--    GET /sos/cases/:id already admits.
--
-- 4. scans.note: the optional feed note (L2), at most 280 characters.
--
-- ADDITIVE ONLY. DROP NOT NULL relaxes a constraint and loses no data; the
-- destructive gate exempts it by name (ops/check-destructive-migrations.sh).
-- CHECKs on existing tables are added NOT VALID and then validated, as in
-- 0024 and 0026. Nothing here matches the gate's destructive patterns.

-- ---------------------------------------------------------------------------
-- 1. feeders
-- ---------------------------------------------------------------------------
ALTER TABLE feeders ADD COLUMN IF NOT EXISTS show_first_name  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE feeders ADD COLUMN IF NOT EXISTS sos_paused_until TIMESTAMPTZ;

COMMENT ON COLUMN feeders.show_first_name IS
  'Show my first name on dogs'' pages (default on). Off: counted, never named.';
COMMENT ON COLUMN feeders.sos_paused_until IS
  'Alerts pause: the SOS fan-out skips this feeder until this time.';

-- ---------------------------------------------------------------------------
-- 2. sos_cases, scans
-- ---------------------------------------------------------------------------
ALTER TABLE sos_cases ALTER COLUMN dog_id DROP NOT NULL;
ALTER TABLE scans ALTER COLUMN dog_id DROP NOT NULL;

ALTER TABLE sos_cases ADD COLUMN IF NOT EXISTS ward_id          TEXT;
ALTER TABLE sos_cases ADD COLUMN IF NOT EXISTS geo              GEOGRAPHY(Point, 4326);
ALTER TABLE sos_cases ADD COLUMN IF NOT EXISTS outcome          TEXT;
ALTER TABLE sos_cases ADD COLUMN IF NOT EXISTS vet_name         TEXT;
ALTER TABLE sos_cases ADD COLUMN IF NOT EXISTS close_by_at      TIMESTAMPTZ;
ALTER TABLE sos_cases ADD COLUMN IF NOT EXISTS arrived_at       TIMESTAMPTZ;
ALTER TABLE sos_cases ADD COLUMN IF NOT EXISTS reporter_left_at TIMESTAMPTZ;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS note TEXT;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'sos_cases_outcome_chk' AND conrelid = 'sos_cases'::regclass) THEN
    ALTER TABLE sos_cases ADD CONSTRAINT sos_cases_outcome_chk
      CHECK (outcome IS NULL OR outcome IN
             ('taken_to_vet', 'treated_on_spot', 'not_found', 'died', 'resolved', 'false_alarm')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'sos_cases_vet_name_len_chk' AND conrelid = 'sos_cases'::regclass) THEN
    ALTER TABLE sos_cases ADD CONSTRAINT sos_cases_vet_name_len_chk
      CHECK (vet_name IS NULL OR char_length(vet_name) <= 80) NOT VALID;
  END IF;
  -- A case names a dog or a place: never neither.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'sos_cases_dog_or_place_chk' AND conrelid = 'sos_cases'::regclass) THEN
    ALTER TABLE sos_cases ADD CONSTRAINT sos_cases_dog_or_place_chk
      CHECK (dog_id IS NOT NULL OR (ward_id IS NOT NULL AND geo IS NOT NULL)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'scans_dog_or_sos_chk' AND conrelid = 'scans'::regclass) THEN
    ALTER TABLE scans ADD CONSTRAINT scans_dog_or_sos_chk
      CHECK (dog_id IS NOT NULL OR scan_type = 'sos') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'scans_note_len_chk' AND conrelid = 'scans'::regclass) THEN
    ALTER TABLE scans ADD CONSTRAINT scans_note_len_chk
      CHECK (note IS NULL OR char_length(note) <= 280) NOT VALID;
  END IF;
END $do$;

ALTER TABLE sos_cases VALIDATE CONSTRAINT sos_cases_outcome_chk;
ALTER TABLE sos_cases VALIDATE CONSTRAINT sos_cases_vet_name_len_chk;
ALTER TABLE sos_cases VALIDATE CONSTRAINT sos_cases_dog_or_place_chk;
ALTER TABLE scans VALIDATE CONSTRAINT scans_dog_or_sos_chk;
ALTER TABLE scans VALIDATE CONSTRAINT scans_note_len_chk;

-- Open cases per ward (the dogless dedupe, the map's SOS rows).
CREATE INDEX IF NOT EXISTS sos_cases_ward_open_ix ON sos_cases (ward_id, opened_at DESC)
  WHERE resolved_at IS NULL;

COMMENT ON COLUMN sos_cases.geo IS
  'Dogless SOS only: the reporter''s point (Mumbai). Returned only to the acker; never logged.';
COMMENT ON COLUMN sos_cases.outcome IS
  'P11 close-out: taken_to_vet | treated_on_spot | not_found | died, or the v5 resolved | false_alarm.';

-- ---------------------------------------------------------------------------
-- 3. sos_case_events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sos_case_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    UUID NOT NULL REFERENCES sos_cases(id),
  kind       TEXT NOT NULL
               CHECK (kind IN ('released', 'close_by', 'arrived', 'reporter_update', 'reporter_left')),
  note       TEXT CHECK (note IS NULL OR char_length(note) <= 280),
  feeder_id  UUID REFERENCES feeders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sos_case_events_case_ix ON sos_case_events (case_id, created_at);

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON sos_case_events TO app_user';
  END IF;
END $do$;
