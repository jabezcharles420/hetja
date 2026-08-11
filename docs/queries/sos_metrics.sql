-- sos_metrics.sql — headline ack-latency metrics computed from sos_cases alone.
SELECT
  percentile_cont(0.50) WITHIN GROUP (ORDER BY (acked_at - opened_at))  AS ack_p50,
  percentile_cont(0.90) WITHIN GROUP (ORDER BY (acked_at - opened_at))  AS ack_p90,
  count(*)                                                              AS cases,
  count(*) FILTER (WHERE state = 'open')                                AS open_cases
FROM sos_cases
WHERE opened_at >= now() - interval '30 days';
