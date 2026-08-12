-- StrayNet · migration 0009_care_geo_precision
-- 0008_care_providers.sql seeded 25 real Mumbai orgs, but the seed's own
-- header comment admits the coordinates are locality/ward-centroid
-- ESTIMATES, not geocoded addresses ("none of these were geocoded from an
-- authoritative source this session" -- packages/db/src/seed-care.ts).
-- The effect is measurable: 25 rows collapse onto 18 distinct points --
-- four organisations share one Malad centroid, two sit on the exact same
-- central-Mumbai point -- yet GET /api/v1/care was returning a computed
-- ST_Distance for every row, including a fabricated "0m" for whichever org
-- happens to share the caller's own centroid. This is an emergency-adjacent
-- surface (also embedded in the SOS report response, sos.ts); a phantom
-- "0km away" can cause someone to skip a genuinely closer, real hospital.
--
-- This migration does not fix the coordinates -- that requires actually
-- geocoding each address, which is future work, not something to guess at
-- here. It gives the schema a place to honestly record what kind of
-- coordinate each row has, so the API layer can refuse to state a distance
-- precision it does not have:
--   - geo_precision = 'exact'    -> geo is a real geocoded point; a
--                                   computed distanceM is meaningful.
--   - geo_precision = 'locality' -> geo is a centroid guess; distanceM
--                                   must never be surfaced as a measured
--                                   fact.
-- `locality` gives the caller something honest to show instead of a fake
-- number: a human-readable place name ("Malad", "Parel", "Sewri").
--
-- Default is 'locality' (the honest, conservative assumption for every
-- existing seeded row) rather than 'exact', so a future INSERT that forgets
-- to set this column fails safe -- it under-claims precision instead of
-- over-claiming it.

CREATE TYPE geo_precision AS ENUM ('exact', 'locality');

ALTER TABLE care_providers
  ADD COLUMN geo_precision geo_precision NOT NULL DEFAULT 'locality',
  ADD COLUMN locality TEXT;
