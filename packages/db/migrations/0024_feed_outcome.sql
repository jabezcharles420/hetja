-- Hetja · migration 0024_feed_outcome
--
-- scans.feed_outcome: how the dog ate, as the feeder saw it. One of
-- 'ate_all' | 'ate_some' | 'didnt_eat' | 'unwell', written by POST
-- /api/v1/scans for scan_type 'feed' only, and only inside the `created`
-- branch of that route (INVARIANT 5: a replayed feed can never rewrite it).
--
-- NULL is the honest value for every row that predates this column and for
-- every scan that is not a feed or whose client sent no outcome. There is no
-- backfill because there is nothing true to backfill with.
--
-- 'unwell' is a FLAG for a human to follow up. It never opens an SOS case on
-- its own (INVARIANT 14: flag, never act silently), and it deliberately does
-- not touch review_status, because INVARIANT 15 counts rejected/flagged
-- review statuses toward auto-pausing a feeder, and reporting a sick dog must
-- never count against the person who reported it.
--
-- ADDITIVE ONLY, and shaped for both targets (local PostgreSQL and Supabase):
--   * ADD COLUMN IF NOT EXISTS, nullable, no default: a catalog-only change,
--     no table rewrite, no long ACCESS EXCLUSIVE hold on a hot table.
--   * The CHECK is added inside a guarded DO block that looks the constraint
--     up by name first, so a re-run is a no-op instead of an error. It is
--     added NOT VALID and then validated: every existing row is NULL, so the
--     validation scan is trivial, but the two-step form never blocks writes
--     behind a full-table check.
--   * No role is named. app_user's existing column privileges on scans come
--     from table-level grants (0022), which cover a new column automatically.
-- Nothing here matches ops/check-destructive-migrations.sh's patterns.

ALTER TABLE scans ADD COLUMN IF NOT EXISTS feed_outcome TEXT;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'scans_feed_outcome_chk'
       AND conrelid = 'scans'::regclass
  ) THEN
    ALTER TABLE scans
      ADD CONSTRAINT scans_feed_outcome_chk
      CHECK (feed_outcome IS NULL OR feed_outcome IN ('ate_all', 'ate_some', 'didnt_eat', 'unwell'))
      NOT VALID;
  END IF;
END $do$;

ALTER TABLE scans VALIDATE CONSTRAINT scans_feed_outcome_chk;

COMMENT ON COLUMN scans.feed_outcome IS
  'How the dog ate on a feed scan: ate_all | ate_some | didnt_eat | unwell. '
  'NULL for non-feed scans, for feeds that reported none, and for every row '
  'older than migration 0024. ''unwell'' is a follow-up flag only: it never '
  'opens an SOS case and never changes review_status (INVARIANTS 14 and 15).';
