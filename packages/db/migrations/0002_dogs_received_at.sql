-- 0002_dogs_received_at.sql
-- INVARIANT 4 tie-break: dogs.last_seen_geo LWW is resolved on captured_at,
-- with received_at as the tie-break when captured_at is equal. Store the
-- received timestamp alongside so the tie-break is deterministic.
ALTER TABLE dogs ADD COLUMN IF NOT EXISTS last_seen_received_at TIMESTAMPTZ;
