-- Hetja · migration 0002
-- LWW tie-break on dogs.last_seen_geo: remember the received_at of the scan
-- that last won, so a captured_at tie is resolved deterministically
-- (INVARIANT 4). Idempotent, so re-runs are safe.

ALTER TABLE dogs ADD COLUMN IF NOT EXISTS last_seen_received_at TIMESTAMPTZ;
