-- sos_fanout.sql — THE canonical SOS fan-out query (keep this file exact;
-- CI runs EXPLAIN on every file in docs/queries/).
--
-- Wave 7 rewrite. The previous version selected responders by
-- ST_DWithin(feeders.last_known_geo, ...) — a column nothing ever wrote, so
-- the query returned zero rows on every call and the fan-out never notified
-- anyone. Proximity is now derived from where a feeder has actually SCANNED:
-- a feeder is eligible when they have a geotagged scan within 2000 m of the
-- report point in the last 30 days, have opted in to responder paging
-- (feeders.sos_opt_in, written only by PATCH /api/v1/feeders/me), and clear
-- the trust floor.
--
-- THE STATED TRADE: a feeder who has moved is stale until their next
-- geotagged scan. That is accepted in exchange for not keeping a rolling
-- record of where account holders are — feeders.last_known_geo /
-- feeders.last_seen_at are deliberately unwritten (see migration 0020's
-- column comments). feeders_sos_gix no longer serves this query; it is left
-- in place rather than dropped (destructive gate).
--
-- Ordering: best-trust first, then most recently active NEARBY — a feeder who
-- scanned here yesterday is a better page than one whose last local scan was
-- four weeks ago. Supported by scans_feeder_recent_ix (migration 0020).
--
-- Written below with representative literals (a stand-in report point and the
-- minor/serious trust floor) rather than $n parameters, following the
-- care_nearby.sql / sos_corroboration.sql precedent: check-queries.sh passes
-- 'x' to parameterised files, which fails on the geography cast — reporting a
-- fixture problem as if it were a schema one. routes/sos.ts's dispatchFanout
-- runs this exact shape with $1 = report GEOGRAPHY(Point,4326) and
-- $2 = trust floor (40 minor/serious, 60 critical); keep the two in lockstep.

SELECT f.id
FROM feeders f
CROSS JOIN LATERAL (
  SELECT max(s.received_at) AS last_nearby_scan
    FROM scans s
   WHERE s.feeder_id = f.id
     AND s.geo IS NOT NULL
     AND s.received_at >= now() - interval '30 days'
     AND ST_DWithin(s.geo, 'SRID=4326;POINT(72.8214 18.9767)'::geography, 2000)
) recent
WHERE f.sos_opt_in
  AND f.trust_score >= 40            -- 40 normally, 60 for critical
  AND recent.last_nearby_scan IS NOT NULL
ORDER BY f.trust_score DESC, recent.last_nearby_scan DESC
LIMIT 15;
