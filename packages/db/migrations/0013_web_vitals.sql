-- Hetja · migration 0013_web_vitals
--
-- Core Web Vitals sink for POST /api/v1/metrics/web-vitals (enhancement
-- stack §M.16). Each row is one browser sample: a metric name, a measured
-- value, and the rating the browser assigned. `path` is slug-stripped at
-- the source ("/d/:slug"), so per-dog page identity is never collected —
-- this table only ever holds aggregates, which is also why nothing here is
-- PII and no INVARIANT 2-style coarsening applies.
--
-- Additive only: creates one table and one index, touches no existing
-- schema, and drops/truncates nothing. The guarded GRANT follows the exact
-- pattern of 0010_identity_email.sql — new tables get no privileges by
-- default on the self-hosted cluster (no ALTER DEFAULT PRIVILEGES for
-- app_user), so without it the API's app_user connection could create this
-- table as the migration's owner but never query it at runtime.

CREATE TABLE web_vitals (
  id         BIGSERIAL PRIMARY KEY,
  path       TEXT NOT NULL,
  name       TEXT NOT NULL CHECK (name IN ('LCP', 'CLS', 'INP', 'TTFB')),
  value      NUMERIC NOT NULL,
  rating     TEXT NOT NULL CHECK (rating IN ('good', 'needs-improvement', 'poor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GET /api/v1/metrics/web-vitals?days=N scans by created_at.
CREATE INDEX web_vitals_created_ix ON web_vitals (created_at);

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON web_vitals TO app_user';
    -- BIGSERIAL id needs nextval(); the table grant alone is not enough.
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE web_vitals_id_seq TO app_user';
  END IF;
END $do$;
