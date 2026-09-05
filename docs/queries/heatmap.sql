-- heatmap.sql — public hunger heatmap. This is the query apps/api/src/routes/
-- heatmap.ts ships (CELL_SQL); keep the two identical, because this file is
-- what ops/check-queries.sh EXPLAINs against the committed schema. It used to
-- be a different query (degree-based 200 m snap, ST_X/ST_Y swapped as lat/lng,
-- a fed_ratio that counted rows) so the gate was proving a query nobody ran.
--   $1 = ward_id (text), $2 = window in days (int)
-- INVARIANT 2: NEVER returns point geometry — 500 m cell centroids only,
-- snapped in EPSG:3857 (metres, not degrees), rounded to 2 decimals.
-- fed_ratio = feed scans / (distinct dogs fed × days), clamped to [0, 1]:
-- the share of dog-days in the window that saw a feed.
-- k-anonymity: cells with fewer than 3 distinct dogs are dropped.
SELECT
  round(ST_Y(ST_Centroid(cell))::numeric, 2) AS lat,
  round(ST_X(ST_Centroid(cell))::numeric, 2) AS lng,
  round(
    LEAST(
      1,
      count(*)::numeric / (NULLIF(count(DISTINCT dog_id), 0) * $2)::numeric
    ),
    3
  ) AS fed_ratio,
  count(*)::int AS feed_count,
  count(DISTINCT dog_id)::int AS dog_count
FROM (
  SELECT
    ST_Transform(ST_SnapToGrid(ST_Transform(s.geo::geometry, 3857), 500), 4326) AS cell,
    s.dog_id
  FROM scans s
  JOIN dogs d ON d.id = s.dog_id AND d.status = 'active'
  WHERE d.ward_id = $1
    AND s.scan_type = 'feed'
    AND s.geo IS NOT NULL
    AND s.captured_at >= now() - ($2::int * interval '1 day')
) cell_scans
GROUP BY cell
HAVING count(DISTINCT dog_id) >= 3
ORDER BY cell;
