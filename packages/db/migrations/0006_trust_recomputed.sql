-- 0006_trust_recomputed.sql
-- Trust engine (INVARIANT 15): feeders.trust_score is DERIVED, never
-- written by hand. recomputeScore() replays every trust_event and persists
-- this marker so the recomputation is idempotent (re-running it can never
-- double-count: the score is always a full replay of the event stream, and
-- trust_recomputed_at records when the last replay happened).
ALTER TABLE feeders ADD COLUMN IF NOT EXISTS trust_recomputed_at TIMESTAMPTZ;
