-- care_nearby.sql — canonical nearest-care-provider query
-- (GET /api/v1/care in apps/api/src/routes/care.ts, reused by
-- POST /api/v1/reports in sos.ts, and the Supabase RPC twin
-- public.get_nearby_care in ops/supabase/03_hardening.sql).
-- ST_DWithin pattern per docs/queries/sos_fanout.sql.
-- Representative literals below (central Mumbai, 5km radius) so this file
-- EXPLAINs standalone for CI's INVARIANT 12 gate (ops/check-queries.sh).
-- listed-only; LIMIT 8.
--
-- Ordering (migration 0009_care_geo_precision.sql): exact-precision rows
-- first, true distance ascending within that group. Locality-precision
-- rows are NOT ranked by ST_Distance at all -- it is still selected for
-- those rows too, but the API layer (care.ts) drops it before it reaches a
-- caller, since most seeded rows are locality-centroid estimates and must
-- never present a fabricated distance as a measured fact. Instead,
-- locality-precision rows are ranked by has_ambulance DESC, then cost_tier
-- (the care_cost_tier enum's own declared order: free, subsidised, paid --
-- hence the unaliased `care_providers.cost_tier` rather than the query's
-- `cost_tier::text` output alias, which would sort alphabetically instead
-- and silently put "paid" ahead of "subsidised"), then is_24x7 DESC, then
-- name for a stable order -- ranking by what actually helps in an
-- emergency instead of by noise that merely looks authoritative.
SELECT
  id, name, kind::text AS kind, cost_tier::text AS cost_tier,
  phone_e164, alt_phone_e164, has_ambulance, is_24x7, hours_note,
  handles_wildlife, phone_verified_at,
  geo_precision::text AS geo_precision, locality,
  ST_Y(geo::geometry) AS lat,
  ST_X(geo::geometry) AS lng,
  ST_Distance(geo, ST_SetSRID(ST_MakePoint(72.8777, 19.076), 4326)::geography) AS distance_m
FROM care_providers
WHERE listed
  AND ST_DWithin(geo, ST_SetSRID(ST_MakePoint(72.8777, 19.076), 4326)::geography, 5000)
ORDER BY
  (geo_precision = 'exact') DESC,
  CASE WHEN geo_precision = 'exact'
       THEN ST_Distance(geo, ST_SetSRID(ST_MakePoint(72.8777, 19.076), 4326)::geography)
  END,
  has_ambulance DESC,
  care_providers.cost_tier,
  is_24x7 DESC,
  name
LIMIT 8;
