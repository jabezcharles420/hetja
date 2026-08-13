-- Hetja · migration 0001_init
-- Schema v1. Every invariant from docs/INVARIANTS.md is encoded here
-- (random slugs, phone_hmac, client_uuid UNIQUE,
-- captured_at LWW, ledger chaining ON from the first migration, append-only
-- medical_records, jobs autovacuum tuning).

CREATE TYPE dog_status    AS ENUM ('active','lost','deceased','adopted','relocated');
CREATE TYPE scan_type     AS ENUM ('view','feed','sos','retag','identify');
CREATE TYPE review_status AS ENUM ('pending','auto_passed','flagged','human_passed','rejected');
CREATE TYPE case_state    AS ENUM ('open','acked','escalated','resolved','false_alarm');
CREATE TYPE severity_t    AS ENUM ('minor','serious','critical');
CREATE TYPE feeder_role   AS ENUM ('feeder','vet','bmc_officer','admin');

CREATE TABLE dogs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug           TEXT NOT NULL UNIQUE,          -- INVARIANT 1: random, not sequential
  name           TEXT,
  sex            TEXT,
  approx_age     INT,
  coat_pattern   TEXT,
  temperament    TEXT,
  vibe           TEXT,
  status         dog_status NOT NULL DEFAULT 'active',
  cv_embedding   VECTOR(768),                   -- nullable until Phase 2
  last_seen_geo  GEOGRAPHY(Point,4326),
  last_seen_at   TIMESTAMPTZ,
  ward_id        TEXT NOT NULL,
  abc_status     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX dogs_geo_gix  ON dogs USING GIST (last_seen_geo);
CREATE INDEX dogs_ward_ix  ON dogs (ward_id) WHERE status = 'active';

CREATE TABLE collars (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dog_id     UUID NOT NULL REFERENCES dogs(id),
  qr_code    TEXT NOT NULL UNIQUE,
  hmac_sig   TEXT NOT NULL,
  batch_no   TEXT NOT NULL,
  material   TEXT NOT NULL,
  bound_once BOOLEAN NOT NULL DEFAULT TRUE,
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ,
  status     TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE feeders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hmac       TEXT NOT NULL UNIQUE,        -- INVARIANT 3
  display_name     TEXT NOT NULL,
  role             feeder_role NOT NULL DEFAULT 'feeder',
  trust_score      INT NOT NULL DEFAULT 30 CHECK (trust_score BETWEEN 0 AND 100),
  verification_tier TEXT NOT NULL DEFAULT 'provisional',
  home_ward        TEXT,
  last_known_geo   GEOGRAPHY(Point,4326),       -- required by the SOS query
  last_seen_at     TIMESTAMPTZ,
  sos_opt_in       BOOLEAN NOT NULL DEFAULT FALSE,
  consent_version  TEXT NOT NULL,
  is_minor         BOOLEAN NOT NULL DEFAULT FALSE,
  streak_days      INT NOT NULL DEFAULT 0,
  badges           TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX feeders_sos_gix ON feeders USING GIST (last_known_geo)
  WHERE sos_opt_in AND trust_score >= 40;

CREATE TABLE scans (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dog_id        UUID NOT NULL REFERENCES dogs(id),
  feeder_id     UUID REFERENCES feeders(id),
  collar_id     UUID REFERENCES collars(id),
  client_uuid   UUID NOT NULL,                  -- INVARIANT 5 (unique index below)
  scan_type     scan_type NOT NULL,
  geo           GEOGRAPHY(Point,4326),
  photo_s3_key  TEXT,
  ai_validation JSONB,
  review_status review_status NOT NULL DEFAULT 'pending',
  device_token  TEXT,
  captured_at   TIMESTAMPTZ NOT NULL,           -- INVARIANT 4
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- INVARIANT 5: client_uuid UNIQUE = offline-replay idempotency.
-- NOTE (v1.1 spec correction): PG cannot create a UNIQUE index on a
-- RANGE-partitioned table unless the partition key is in the index, and
-- adding received_at would break replay idempotency. So scans is a plain
-- table in 0001_init (fine to ~5M rows/yr at Phase 0-1 scale); monthly
-- partitioning ships in a Phase 2 migration (0002_scan_partitions) using a
-- hash-partition-by-client_uuid strategy or a scan_dedup guard table.
CREATE UNIQUE INDEX scans_client_uuid_uix ON scans (client_uuid);
CREATE INDEX scans_received_ix ON scans (received_at);
CREATE INDEX scans_dog_ix     ON scans (dog_id, received_at DESC);

CREATE TABLE vets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_name     TEXT NOT NULL,
  geo             GEOGRAPHY(Point,4326) NOT NULL,
  signing_key_pub TEXT NOT NULL,
  sla_minutes     INT NOT NULL DEFAULT 30,
  retainer_paise  INT NOT NULL DEFAULT 0,
  mou_signed_at   DATE,
  verified_at     TIMESTAMPTZ
);

CREATE TABLE sos_cases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id      UUID NOT NULL REFERENCES scans(id),
  dog_id       UUID NOT NULL REFERENCES dogs(id),
  severity     severity_t NOT NULL,
  state        case_state NOT NULL DEFAULT 'open',
  tier         INT NOT NULL DEFAULT 1,
  acked_by     UUID REFERENCES feeders(id),
  opened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  acked_at     TIMESTAMPTZ,
  escalated_at TIMESTAMPTZ,
  resolved_at  TIMESTAMPTZ,
  resolution   TEXT
);
CREATE INDEX sos_open_ix ON sos_cases (state, opened_at) WHERE state IN ('open','acked');

CREATE TABLE sos_notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id      UUID NOT NULL REFERENCES sos_cases(id),
  feeder_id    UUID REFERENCES feeders(id),
  vet_id       UUID REFERENCES vets(id),
  channel      TEXT NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  acked_at     TIMESTAMPTZ,
  stood_down   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE medical_records (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dog_id             UUID NOT NULL REFERENCES dogs(id),
  vet_id             UUID REFERENCES vets(id),
  record_type        TEXT NOT NULL,
  vaccine_name       TEXT,
  vaccine_date       DATE,
  abc_date           DATE,
  diagnosis          TEXT,
  treatment          TEXT,
  severity           severity_t,               -- nullable: vaccinations have none
  is_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  vet_signature      TEXT,
  corrects_record_id UUID REFERENCES medical_records(id),
  payload_len        INT NOT NULL,             -- INVARIANT 9
  hash_prev          TEXT NOT NULL,
  hash_curr          TEXT NOT NULL UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- INVARIANT 9: medical_records is append-only.
-- Guarded on role existence so this migration applies to both targets:
-- self-hosted Postgres (where app_user is the application's login role) and
-- managed Supabase (where the app connects as postgres.<project-ref> and no
-- app_user exists, making a grant to it impossible and meaningless).
-- GRANT/REVOKE are utility commands, so plpgsql needs EXECUTE.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON medical_records FROM app_user';
  END IF;
END $do$;
-- NOTE: on Supabase this is a no-op, so the invariant is enforced there by the
-- BEFORE UPDATE OR DELETE trigger in ops/supabase/03_hardening.sql instead --
-- which binds every role, not just app_user.

CREATE TABLE ledger_anchors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  head_hash     TEXT NOT NULL,
  record_count  INT NOT NULL,
  published_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_url TEXT
);

CREATE TABLE trust_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feeder_id         UUID NOT NULL REFERENCES feeders(id),
  event_type        TEXT NOT NULL,
  delta             INT NOT NULL,
  reason            TEXT NOT NULL,
  ref_scan_id       UUID,
  reverses_event_id UUID REFERENCES trust_events(id),
  dispute_state     TEXT NOT NULL DEFAULT 'none',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE geofences (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  boundary       GEOGRAPHY(Polygon,4326) NOT NULL,
  ward_id        TEXT NOT NULL,
  alert_radius_m INT NOT NULL DEFAULT 2000
);
CREATE TABLE dogs_geofences (
  dog_id UUID REFERENCES dogs(id), geofence_id UUID REFERENCES geofences(id),
  since TIMESTAMPTZ NOT NULL DEFAULT now(), until TIMESTAMPTZ,
  PRIMARY KEY (dog_id, geofence_id)
);
CREATE TABLE feeder_territories (
  feeder_id UUID REFERENCES feeders(id), geofence_id UUID REFERENCES geofences(id),
  role TEXT NOT NULL, is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  since TIMESTAMPTZ NOT NULL DEFAULT now(), until TIMESTAMPTZ,
  PRIMARY KEY (feeder_id, geofence_id)
);

CREATE TABLE dog_stories (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dog_id           UUID NOT NULL REFERENCES dogs(id),
  author_feeder_id UUID NOT NULL REFERENCES feeders(id),
  paragraph        TEXT NOT NULL,
  version          INT NOT NULL,
  moderated_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id           BIGSERIAL PRIMARY KEY,
  kind         TEXT NOT NULL,
  payload      JSONB NOT NULL,
  run_after    TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts     INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ
);
CREATE INDEX jobs_ready_ix ON jobs (run_after) WHERE locked_until IS NULL;
ALTER TABLE jobs SET (autovacuum_vacuum_scale_factor = 0.01);  -- bloat is the failure mode
