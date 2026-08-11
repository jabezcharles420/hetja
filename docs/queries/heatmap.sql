-- heatmap.sql — public hunger heatmap (7-day window, 200m cells).
-- INVARIANT 2: NEVER returns point geometry — cell centroids only.
-- INVARIANT: denominator counts only dogs.status='active' so departed dogs
-- do not pin a cell red forever.
SELECT
  ST_X(ST_Centroid(cell)) AS cell_lat,
  ST_Y(ST_Centroid(cell)) AS cell_lng,
  round((count(*) FILTER (WHERE s.scan_type = 'feed'))::numeric /
        NULLIF(count(*) FILTER (WHERE d.status = 'active'), 0), 3) AS fed_ratio
FROM (
  SELECT ST_SnapToGrid(geo::geometry, 200) AS cell, scan_type, dog_id
  FROM scans
  WHERE scan_type = 'feed'
    AND captured_at >= now() - interval '7 days'
) s
JOIN dogs d ON d.id = s.dog_id
GROUP BY cell
HAVING count(*) FILTER (WHERE d.status = 'active') > 0
ORDER BY cell;
