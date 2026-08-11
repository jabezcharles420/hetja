-- sos_fanout.sql — THE canonical SOS fan-out query (keep this file exact;
-- CI runs EXPLAIN on every file in docs/queries/).
-- Find eligible responders within radius of a report point, ordered by
-- trust then recency. Uses the partial GIST index feeders_sos_gix.
-- :1 = report GEOGRAPHY(Point,4326)   :2 = trust floor (40 normal, 60 critical)
SELECT f.id
FROM feeders f
WHERE ST_DWithin(f.last_known_geo, $1::geography, 2000)
  AND f.sos_opt_in
  AND f.trust_score >= $2          -- 40 normally, 60 for critical
ORDER BY f.trust_score DESC, f.last_seen_at DESC
LIMIT 15;
