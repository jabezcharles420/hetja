-- Hetja · migration 0020_sos_network_indexes
-- Wave 7 (SOS network): the indexes the fan-out and escalation actually need,
-- the uniqueness sos_notifications' ON CONFLICT clauses always assumed, and
-- the honest column documentation for the feeder fields wave 7 retired.
--
-- ADDITIVE ONLY: three CREATE INDEX IF NOT EXISTS, three partial unique
-- indexes, three COMMENT ON COLUMN. Nothing here matches
-- ops/check-destructive-migrations.sh's patterns, so no MIGRATION-APPROVED
-- marker is needed or appropriate.

-- ---------------------------------------------------------------------------
-- 1. vets.geo had no index while the tier-2 escalation KNN-sorted on it.
--
-- The worker's escalate_sos handler ranks contracted clinics with
--     ORDER BY v.geo <-> d.last_seen_geo LIMIT 3
-- which is PostgreSQL's KNN operator: without a GiST index on the left side,
-- every escalation reads ALL of vets and computes a distance per row. That is
-- a full scan on the life-safety path — small table today, but it exists so
-- that stays true when it isn't. This index is what makes <-> an indexed
-- nearest-neighbour search instead of an expensive sort.
CREATE INDEX IF NOT EXISTS vets_geo_gix ON vets USING GIST (geo);

-- ---------------------------------------------------------------------------
-- 2. Responder proximity now derives from scan history (wave 7).
--
-- routes/sos.ts finds responders as "feeders with a geotagged scan within
-- 2 km in the last 30 days", which filters scans by feeder and recency before
-- applying the spatial predicate. This composite index serves that shape:
-- an index range per candidate feeder, newest first, instead of a scan of
-- scans. It also covers lib/trust.ts's per-feeder event replay ordering via
-- its feeder_id prefix.
CREATE INDEX IF NOT EXISTS scans_feeder_recent_ix ON scans (feeder_id, received_at DESC);

-- ---------------------------------------------------------------------------
-- 3. trust_events replay per feeder.
--
-- recomputeScore() replays a feeder's events ordered by creation time on
-- every qualifying write; nothing indexed that ordering, so each replay was
-- a sequential scan of the whole table filtered to one feeder.
CREATE INDEX IF NOT EXISTS trust_events_feeder_ix ON trust_events (feeder_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. What identifies ONE notification: case + recipient + channel.
--
-- Both producers -- routes/sos.ts (push rows per fanned-out responder) and the
-- worker's escalate_sos (sms rows per nearby vet, one bmc row) -- have written
-- `ON CONFLICT DO NOTHING` since 0001. Without any unique constraint on this
-- table that clause is a NO-OP: it deduplicates nothing, and every re-run of
-- an escalation inserted duplicate rows. Three partial unique indexes, because
-- the recipient is a polymorphic NULL (feeder_id OR vet_id OR neither): a
-- plain UNIQUE (case_id, feeder_id, channel) cannot police the all-NULL bmc
-- case, since two NULLs are never equal in SQL.
--
-- Each producer's insert now conflicts with exactly one of these, and bare
-- `ON CONFLICT DO NOTHING` (no arbitration target) arbitrates against every
-- unique index on the table, so neither call site needs to change.
--
-- If a production table ever holds pre-existing duplicates, these CREATEs fail
-- loudly rather than silently leaving the clause a no-op again — deduplicate
-- deliberately, with a human reading the rows, not inside an unattended
-- migration. (No DELETE here: the destructive gate exists precisely so that
-- decision is never made quietly.)
CREATE UNIQUE INDEX sos_notifications_case_feeder_uix
  ON sos_notifications (case_id, feeder_id, channel) WHERE feeder_id IS NOT NULL;
CREATE UNIQUE INDEX sos_notifications_case_vet_uix
  ON sos_notifications (case_id, vet_id, channel) WHERE vet_id IS NOT NULL;
CREATE UNIQUE INDEX sos_notifications_case_channel_uix
  ON sos_notifications (case_id, channel)
  WHERE feeder_id IS NULL AND vet_id IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Honest documentation of the feeder columns wave 7 retired.
--
-- feeders.last_known_geo and feeders.last_seen_at were designed as the
-- responder fan-out's inputs, and NOTHING EVER WROTE THEM (grep confirms:
-- reads, the schema and the partial index below were their only references),
-- which is one half of why the fan-out never notified anyone. Wave 7 derives
-- responder proximity from geotagged scan history instead and no longer reads
-- either column. They are documented here — not dropped — so the next reader
-- does not "helpfully" start populating them: keeping a rolling record of
-- where account holders are was evaluated and REJECTED as the price of
-- freshness (a feeder who has moved is stale until their next geotagged scan;
-- that is the stated trade). feeders_sos_gix, the partial GIST index over
-- last_known_geo, is dead weight for the same reason: no query predicates on
-- that column any more. It is left in place — dropping it would trip the
-- destructive gate for no benefit and buy nothing but risk.
COMMENT ON COLUMN feeders.last_known_geo IS
  'NOT WRITTEN by any code path, and the SOS fan-out no longer reads it '
  '(wave 7 derives responder proximity from geotagged scan history). Kept — '
  'not dropped — so old backups restore; do not start populating it without '
  'revisiting the privacy decision recorded in 0020''s header.';
COMMENT ON COLUMN feeders.last_seen_at IS
  'NOT WRITTEN by any code path; formerly intended as the fan-out''s recency '
  'sort key. Dead for the same reason last_known_geo is. Recency now comes '
  'from scans (feeder_id, received_at).';
COMMENT ON COLUMN feeders.sos_opt_in IS
  'The consent bit for SOS responder paging. Written ONLY by '
  'PATCH /api/v1/feeders/me { sosOptIn } (routes/feeders.ts); read by the '
  'fan-out in routes/sos.ts. Default FALSE, and nothing else sets it — paging '
  'someone requires their explicit yes.';
