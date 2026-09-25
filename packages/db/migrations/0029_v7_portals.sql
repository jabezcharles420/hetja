-- Hetja · migration 0029_v7_portals
--
-- Design v7 (docs/design/v7-portals/CONTRACT.md, "Data"): the Admin, Vet and
-- NGO portals. Groups:
--
--  1. Admin roles and the audit log. audit_log is APPEND-ONLY for everyone,
--     the Owner included (A6 "The log can't be edited by anyone"): app_user
--     loses UPDATE, DELETE and TRUNCATE, and triggers refuse all three for
--     every role, exactly as medical_records is protected (0001, 0012). It
--     carries no foreign keys on purpose: an ON DELETE SET NULL from a feeders
--     row would itself be an UPDATE the trigger refuses.
--  2. Invitations (vets, the admin team, NGO members). An invite stores the
--     identity HMAC of the address, never the address (INVARIANT 3).
--  3. Vet profiles, private documents, WebAuthn credentials and challenges.
--     vet_profiles.phone_e164 and ngos.phone_e164 are PUBLIC professional
--     numbers (owner decision, 2026-09-25): vets and NGOs exist to be called,
--     like care_providers.phone_e164. Feeders' contact details stay
--     HMAC-only (INVARIANT 3, rescoped in docs/INVARIANTS.md).
--     documents holds only metadata: the bytes are AES-256-GCM encrypted
--     under HETJA_DOCS_KEY in a private directory, never the photos dir.
--  4. medical_records: who signed, with which passkey, the assertion, the
--     record hash the assertion signed, a correction reason and a drive link.
--     New NULLABLE columns only; nothing in medical_records is ever updated
--     (INVARIANT 8). No foreign keys, for the same reason as audit_log.
--  5. NGOs, members, linked vets; SOS dispatches and NGO/vet routing columns.
--  6. Sign requests, drives.
--  7. Avatars and batches; dog merges (dogs.merged_into, dog_merges, the
--     'merged' status); duplicate dismissals; reports ("Report a problem").
--  8. Moderation tools (D13): account suspension, blocked devices, hidden
--     photos.
--  9. Care directory: government vets as people (is_government, is_person,
--     reg_no, wards).
--
-- ADDITIVE ONLY, shaped for both targets (local PostgreSQL and Supabase):
-- ADD COLUMN IF NOT EXISTS (nullable or constant default), CREATE TABLE /
-- INDEX IF NOT EXISTS, ALTER TYPE ... ADD VALUE IF NOT EXISTS (the new value
-- is not used anywhere in this file, which is what lets it share one), guarded
-- app_user GRANTs as in 0023, and CREATE OR REPLACE for the trigger functions.
-- Nothing here matches ops/check-destructive-migrations.sh's patterns.

-- ---------------------------------------------------------------------------
-- 0. dog_status 'merged' (A5). Not referenced below: a value added in a
--    transaction cannot be used until it commits.
-- ---------------------------------------------------------------------------
ALTER TYPE dog_status ADD VALUE IF NOT EXISTS 'merged';

-- ---------------------------------------------------------------------------
-- 1. Admin roles and the append-only audit log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feeder_id   UUID NOT NULL REFERENCES feeders(id),
  role        TEXT NOT NULL CHECK (role IN ('owner', 'moderator', 'avatar_editor', 'ward_lead')),
  wards       TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(wards) <= 24),
  granted_by  UUID REFERENCES feeders(id) ON DELETE SET NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ,
  revoked_by  UUID REFERENCES feeders(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS admin_roles_live_uix ON admin_roles (feeder_id, role) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  actor_id     UUID,
  actor_kind   TEXT NOT NULL CHECK (actor_kind IN ('admin', 'vet', 'ngo', 'feeder', 'system')),
  action       TEXT NOT NULL CHECK (char_length(action) <= 64),
  subject_type TEXT,
  subject_id   TEXT,
  summary      TEXT NOT NULL DEFAULT '' CHECK (char_length(summary) <= 300),
  detail       JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_log_at_ix ON audit_log (at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_subject_ix ON audit_log (subject_type, subject_id, at DESC);

COMMENT ON TABLE audit_log IS
  'Every admin action, vet signature and document access (design v7, A6). '
  'Append-only for every role, the Owner included: UPDATE, DELETE and TRUNCATE '
  'are refused by triggers. Never holds contact details or document contents.';

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.audit_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % denied', TG_OP;
END $fn$;

DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log;
CREATE TRIGGER audit_log_no_change
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION private.audit_log_append_only();

DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION private.audit_log_append_only();

-- ---------------------------------------------------------------------------
-- 2. Invitations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invites (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          TEXT NOT NULL CHECK (kind IN ('vet', 'team', 'ngo_member')),
  identity_hmac TEXT NOT NULL,
  role          TEXT,
  wards         TEXT[] NOT NULL DEFAULT '{}',
  ngo_id        UUID,
  has_transport BOOLEAN NOT NULL DEFAULT FALSE,
  invited_by    UUID REFERENCES feeders(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  accepted_at   TIMESTAMPTZ,
  accepted_by   UUID REFERENCES feeders(id) ON DELETE SET NULL,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS invites_open_ix ON invites (identity_hmac) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Vets, documents, passkeys
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vet_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feeder_id           UUID NOT NULL UNIQUE REFERENCES feeders(id),
  council             TEXT NOT NULL DEFAULT 'MSVC' CHECK (council IN ('MSVC')),
  reg_no              TEXT CHECK (reg_no IS NULL OR char_length(reg_no) BETWEEN 1 AND 32),
  qualification       TEXT CHECK (qualification IS NULL OR char_length(qualification) <= 80),
  clinic              TEXT CHECK (clinic IS NULL OR char_length(clinic) <= 120),
  wards               TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(wards) <= 24),
  sos_available       BOOLEAN NOT NULL DEFAULT FALSE,
  sos_start           SMALLINT CHECK (sos_start IS NULL OR sos_start BETWEEN 0 AND 1439),
  sos_end             SMALLINT CHECK (sos_end IS NULL OR sos_end BETWEEN 0 AND 1439),
  phone_e164          TEXT CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status              TEXT NOT NULL DEFAULT 'waiting'
                        CHECK (status IN ('invited', 'waiting', 'more_info', 'verified', 'suspended', 'declined', 'removed')),
  applied_at          TIMESTAMPTZ,
  register_checked_at TIMESTAMPTZ,
  register_checked_by UUID REFERENCES feeders(id) ON DELETE SET NULL,
  register_not_found_at TIMESTAMPTZ,
  register_not_found_by UUID REFERENCES feeders(id) ON DELETE SET NULL,
  valid_to            TEXT CHECK (valid_to IS NULL OR valid_to ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  decided_at          TIMESTAMPTZ,
  decided_by          UUID REFERENCES feeders(id) ON DELETE SET NULL,
  decision_reason     TEXT CHECK (decision_reason IS NULL OR char_length(decision_reason) <= 500),
  ngo_id              UUID,
  vouched_by_ngo_id   UUID,
  vouched_at          TIMESTAMPTZ,
  care_provider_id    UUID REFERENCES care_providers(id),
  signatures_flagged_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vet_profiles_status_ix ON vet_profiles (status, applied_at);
CREATE INDEX IF NOT EXISTS vet_profiles_wards_gix ON vet_profiles USING GIN (wards) WHERE status = 'verified';

COMMENT ON COLUMN vet_profiles.phone_e164 IS
  'PUBLIC professional number (owner decision 2026-09-25), shown where care providers are. Not a feeder contact.';

CREATE TABLE IF NOT EXISTS documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind   TEXT NOT NULL CHECK (owner_kind IN ('pending', 'vet_profile', 'ngo', 'medical_record')),
  owner_id     UUID,
  uploaded_by  UUID REFERENCES feeders(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('certificate', 'photo_id', 'ngo_registration', 'record_photo')),
  mime         TEXT NOT NULL CHECK (mime IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes   INT NOT NULL CHECK (size_bytes > 0),
  sha256       TEXT NOT NULL,
  blob_key     TEXT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  delete_after TIMESTAMPTZ,
  deleted_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS documents_owner_ix ON documents (owner_kind, owner_id);
CREATE INDEX IF NOT EXISTS documents_sweep_ix ON documents (delete_after) WHERE deleted_at IS NULL;

COMMENT ON TABLE documents IS
  'Registration certificates and photo IDs (V1, N1). Metadata only: the bytes '
  'are AES-256-GCM under HETJA_DOCS_KEY in a private directory, streamed to '
  'admins only, and deleted 30 days after the application is decided.';

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feeder_id     UUID NOT NULL REFERENCES feeders(id),
  credential_id TEXT NOT NULL UNIQUE,
  public_key    BYTEA NOT NULL,
  counter       BIGINT NOT NULL DEFAULT 0,
  transports    TEXT[] NOT NULL DEFAULT '{}',
  label         TEXT CHECK (label IS NULL OR char_length(label) <= 60),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS webauthn_credentials_feeder_ix ON webauthn_credentials (feeder_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feeder_id   UUID NOT NULL REFERENCES feeders(id),
  purpose     TEXT NOT NULL CHECK (purpose IN ('register', 'sign')),
  challenge   TEXT NOT NULL,
  record_hash TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS webauthn_challenges_feeder_ix ON webauthn_challenges (feeder_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 4. medical_records: signatures (new nullable columns; no row is updated)
-- ---------------------------------------------------------------------------
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS record_source     TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS signed_by         UUID;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS credential_id     TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS assertion         JSONB;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS record_hash       TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS correction_reason TEXT;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS drive_dog_id      UUID;
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS noted_by          UUID;

CREATE INDEX IF NOT EXISTS medical_records_signed_by_ix ON medical_records (signed_by, created_at DESC) WHERE signed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS medical_records_corrects_ix ON medical_records (corrects_record_id) WHERE corrects_record_id IS NOT NULL;

COMMENT ON COLUMN medical_records.record_source IS
  'vet_signed (a verified vet''s passkey assertion over record_hash) | feeder_noted | NULL (older rows).';
COMMENT ON COLUMN medical_records.assertion IS
  'The WebAuthn assertion (AuthenticationResponseJSON) whose challenge is record_hash.';

-- ---------------------------------------------------------------------------
-- 5. NGOs, members, vets, SOS routing
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ngos (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  reg_type             TEXT NOT NULL CHECK (reg_type IN ('trust', 'society', 'section8', 'other')),
  reg_no               TEXT NOT NULL CHECK (char_length(reg_no) BETWEEN 1 AND 64),
  since_year           SMALLINT CHECK (since_year IS NULL OR since_year BETWEEN 1800 AND 2100),
  has_80g              BOOLEAN NOT NULL DEFAULT FALSE,
  wards                TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(wards) <= 24),
  citywide             BOOLEAN NOT NULL DEFAULT FALSE,
  offers_ambulance     BOOLEAN NOT NULL DEFAULT FALSE,
  offers_shelter       BOOLEAN NOT NULL DEFAULT FALSE,
  offers_sterilisation BOOLEAN NOT NULL DEFAULT FALSE,
  offers_collars       BOOLEAN NOT NULL DEFAULT FALSE,
  contact_name         TEXT CHECK (contact_name IS NULL OR char_length(contact_name) <= 80),
  phone_e164           TEXT CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  ambulance_count      SMALLINT NOT NULL DEFAULT 0 CHECK (ambulance_count BETWEEN 0 AND 50),
  ambulance_hours      TEXT CHECK (ambulance_hours IS NULL OR char_length(ambulance_hours) <= 60),
  hours                TEXT CHECK (hours IS NULL OR char_length(hours) <= 80),
  ambulance_status     TEXT NOT NULL DEFAULT 'in' CHECK (ambulance_status IN ('in', 'out')),
  ambulance_case_id    UUID,
  beds_total           SMALLINT NOT NULL DEFAULT 0 CHECK (beds_total BETWEEN 0 AND 5000),
  beds_free            SMALLINT NOT NULL DEFAULT 0 CHECK (beds_free BETWEEN 0 AND 5000),
  status               TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'paused', 'removed')),
  applied_by           UUID REFERENCES feeders(id) ON DELETE SET NULL,
  applied_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at           TIMESTAMPTZ,
  decided_by           UUID REFERENCES feeders(id) ON DELETE SET NULL,
  decision_reason      TEXT CHECK (decision_reason IS NULL OR char_length(decision_reason) <= 500),
  care_provider_id     UUID REFERENCES care_providers(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (beds_free <= beds_total)
);
CREATE INDEX IF NOT EXISTS ngos_wards_gix ON ngos USING GIN (wards) WHERE status = 'active';

COMMENT ON COLUMN ngos.phone_e164 IS
  'PUBLIC professional number (owner decision 2026-09-25), shown where care providers are.';

CREATE TABLE IF NOT EXISTS ngo_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ngo_id        UUID NOT NULL REFERENCES ngos(id),
  feeder_id     UUID NOT NULL REFERENCES feeders(id),
  role          TEXT NOT NULL CHECK (role IN ('coordinator', 'rescue', 'collars', 'volunteer')),
  has_transport BOOLEAN NOT NULL DEFAULT FALSE,
  invited_by    UUID REFERENCES feeders(id) ON DELETE SET NULL,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at       TIMESTAMPTZ
);
-- One live NGO per person: the NGO tab shows one NGO.
CREATE UNIQUE INDEX IF NOT EXISTS ngo_members_live_uix ON ngo_members (feeder_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS ngo_members_ngo_ix ON ngo_members (ngo_id) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS ngo_vets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ngo_id        UUID NOT NULL REFERENCES ngos(id),
  vet_feeder_id UUID NOT NULL REFERENCES feeders(id),
  linked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  vouched_at    TIMESTAMPTZ,
  vouched_by    UUID REFERENCES feeders(id) ON DELETE SET NULL,
  unlinked_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS ngo_vets_live_uix ON ngo_vets (ngo_id, vet_feeder_id) WHERE unlinked_at IS NULL;

ALTER TABLE sos_cases ADD COLUMN IF NOT EXISTS ngo_id         UUID;
ALTER TABLE sos_cases ADD COLUMN IF NOT EXISTS ngo_routed_at  TIMESTAMPTZ;
ALTER TABLE sos_cases ADD COLUMN IF NOT EXISTS ngo_passed_at  TIMESTAMPTZ;
ALTER TABLE sos_cases ADD COLUMN IF NOT EXISTS vets_opened_at TIMESTAMPTZ;
ALTER TABLE sos_notifications ADD COLUMN IF NOT EXISTS route  TEXT;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'sos_notifications_route_chk' AND conrelid = 'sos_notifications'::regclass) THEN
    ALTER TABLE sos_notifications ADD CONSTRAINT sos_notifications_route_chk
      CHECK (route IS NULL OR route IN ('ngo_coordinator', 'ngo_dispatch', 'vet_escalation', 'admin_assign')) NOT VALID;
  END IF;
END $do$;
ALTER TABLE sos_notifications VALIDATE CONSTRAINT sos_notifications_route_chk;

COMMENT ON COLUMN sos_notifications.route IS
  'Design v7: how a professional was paged. NULL = the feeder fan-out. A vet or NGO page counts as told only once delivered.';

CREATE TABLE IF NOT EXISTS sos_dispatches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          UUID NOT NULL REFERENCES sos_cases(id),
  ngo_id           UUID REFERENCES ngos(id),
  kind             TEXT NOT NULL CHECK (kind IN ('ngo_member', 'admin_vet')),
  member_feeder_id UUID NOT NULL REFERENCES feeders(id),
  with_ambulance   BOOLEAN NOT NULL DEFAULT FALSE,
  eta_min          SMALLINT CHECK (eta_min IS NULL OR eta_min BETWEEN 0 AND 600),
  sent_by          UUID REFERENCES feeders(id) ON DELETE SET NULL,
  sent_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at      TIMESTAMPTZ,
  declined_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS sos_dispatches_case_ix ON sos_dispatches (case_id, sent_at);
CREATE INDEX IF NOT EXISTS sos_dispatches_member_ix ON sos_dispatches (member_feeder_id, sent_at DESC);

-- ---------------------------------------------------------------------------
-- 6. Sign requests, drives
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sign_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dog_id             UUID NOT NULL REFERENCES dogs(id),
  requested_by       UUID REFERENCES feeders(id) ON DELETE SET NULL,
  vet_feeder_id      UUID REFERENCES feeders(id) ON DELETE SET NULL,
  record_id          UUID REFERENCES medical_records(id),
  proposed           JSONB NOT NULL,
  note               TEXT CHECK (note IS NULL OR char_length(note) <= 280),
  evidence_photo_key TEXT,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'signed', 'declined', 'withdrawn')),
  decided_by         UUID REFERENCES feeders(id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ,
  decline_reason     TEXT CHECK (decline_reason IS NULL OR char_length(decline_reason) <= 280),
  signed_record_id   UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sign_requests_open_ix ON sign_requests (dog_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS sign_requests_vet_ix ON sign_requests (vet_feeder_id, created_at DESC) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS drives (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ngo_id             UUID NOT NULL REFERENCES ngos(id),
  title              TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
  ward_id            TEXT NOT NULL,
  starts_at          TIMESTAMPTZ NOT NULL,
  lead_vet_feeder_id UUID REFERENCES feeders(id) ON DELETE SET NULL,
  volunteer_ids      UUID[] NOT NULL DEFAULT '{}' CHECK (cardinality(volunteer_ids) <= 50),
  created_by         UUID REFERENCES feeders(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ,
  collars_packed     SMALLINT NOT NULL DEFAULT 0 CHECK (collars_packed BETWEEN 0 AND 1000),
  headsup_sent_at    TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS drives_ngo_ix ON drives (ngo_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS drives_headsup_ix ON drives (starts_at) WHERE headsup_sent_at IS NULL AND cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS drive_dogs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drive_id          UUID NOT NULL REFERENCES drives(id),
  dog_id            UUID NOT NULL REFERENCES dogs(id),
  task_collar       BOOLEAN NOT NULL DEFAULT FALSE,
  task_vaccinate    BOOLEAN NOT NULL DEFAULT FALSE,
  task_sterilise    BOOLEAN NOT NULL DEFAULT FALSE,
  done_collar_at    TIMESTAMPTZ,
  done_vaccinate_at TIMESTAMPTZ,
  done_sterilise_at TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done', 'to_clinic', 'not_found')),
  vaccination_record_id UUID,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (drive_id, dog_id)
);

-- ---------------------------------------------------------------------------
-- 7. Avatars, merges, duplicates, reports
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS avatar_batches (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number     SERIAL,
  created_by UUID REFERENCES feeders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'published'))
);

CREATE TABLE IF NOT EXISTS dog_avatars (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id             UUID REFERENCES avatar_batches(id),
  dog_id               UUID REFERENCES dogs(id),
  file_name            TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 200),
  image_key            TEXT,
  match_kind           TEXT NOT NULL CHECK (match_kind IN ('id', 'collar', 'manual', 'none')),
  status               TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired', 'rejected')),
  uploaded_by          UUID REFERENCES feeders(id) ON DELETE SET NULL,
  uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at         TIMESTAMPTZ,
  published_by         UUID REFERENCES feeders(id) ON DELETE SET NULL,
  retired_at           TIMESTAMPTZ,
  signoff_requested_at TIMESTAMPTZ,
  signoff_of           UUID REFERENCES feeders(id) ON DELETE SET NULL,
  signoff_answer       TEXT CHECK (signoff_answer IS NULL OR signoff_answer IN ('looks_right', 'redo')),
  signoff_answered_at  TIMESTAMPTZ
);
-- One live avatar per dog.
CREATE UNIQUE INDEX IF NOT EXISTS dog_avatars_published_uix ON dog_avatars (dog_id) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS dog_avatars_batch_ix ON dog_avatars (batch_id, uploaded_at);
CREATE INDEX IF NOT EXISTS dog_avatars_dog_ix ON dog_avatars (dog_id, uploaded_at DESC);

ALTER TABLE dogs ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES dogs(id);
ALTER TABLE dogs ADD COLUMN IF NOT EXISTS merged_at   TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS dogs_merged_into_ix ON dogs (merged_into) WHERE merged_into IS NOT NULL;

ALTER TABLE scans ADD COLUMN IF NOT EXISTS merged_from_dog_id UUID;

CREATE TABLE IF NOT EXISTS dog_merges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kept_dog_id   UUID NOT NULL REFERENCES dogs(id),
  merged_dog_id UUID NOT NULL UNIQUE REFERENCES dogs(id),
  kept_name     TEXT,
  moved_scans   INT NOT NULL DEFAULT 0,
  merged_by     UUID REFERENCES feeders(id) ON DELETE SET NULL,
  merged_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  report_id     UUID
);

CREATE TABLE IF NOT EXISTS duplicate_dismissals (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dog_a        UUID NOT NULL REFERENCES dogs(id),
  dog_b        UUID NOT NULL REFERENCES dogs(id),
  dismissed_by UUID REFERENCES feeders(id) ON DELETE SET NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (dog_a < dog_b),
  UNIQUE (dog_a, dog_b)
);

CREATE TABLE IF NOT EXISTS reports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               TEXT NOT NULL CHECK (kind IN ('duplicate_dog', 'photo', 'other')),
  dog_id             UUID NOT NULL REFERENCES dogs(id),
  other_dog_id       UUID REFERENCES dogs(id),
  scan_id            UUID REFERENCES scans(id),
  note               TEXT CHECK (note IS NULL OR char_length(note) <= 500),
  reporter_feeder_id UUID REFERENCES feeders(id) ON DELETE SET NULL,
  reporter_device    TEXT,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_by        UUID REFERENCES feeders(id) ON DELETE SET NULL,
  resolved_at        TIMESTAMPTZ,
  outcome            TEXT CHECK (outcome IS NULL OR outcome IN ('merged', 'different', 'photo_removed', 'no_action', 'fixed')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reports_open_ix ON reports (created_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS reports_dog_ix ON reports (dog_id, created_at DESC);

COMMENT ON TABLE reports IS
  '"Report a problem" on a dog (duplicate, photo, other). reporter_device is '
  'SHA-256 of the canonical device id, only to deduplicate; never the token.';

-- ---------------------------------------------------------------------------
-- 8. Moderation tools (D13)
-- ---------------------------------------------------------------------------
ALTER TABLE feeders ADD COLUMN IF NOT EXISTS suspended_at     TIMESTAMPTZ;
ALTER TABLE feeders ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE feeders ADD COLUMN IF NOT EXISTS suspended_by     UUID REFERENCES feeders(id) ON DELETE SET NULL;

COMMENT ON COLUMN feeders.suspended_at IS
  'D13 suspend account: writes refused (403 ACCOUNT_SUSPENDED), never paged, cannot take cases. SOS reports still accepted.';

CREATE TABLE IF NOT EXISTS blocked_devices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_hash TEXT NOT NULL,
  reason      TEXT CHECK (reason IS NULL OR char_length(reason) <= 300),
  blocked_by  UUID REFERENCES feeders(id) ON DELETE SET NULL,
  blocked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  lifted_at   TIMESTAMPTZ,
  lifted_by   UUID REFERENCES feeders(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS blocked_devices_live_uix ON blocked_devices (device_hash) WHERE lifted_at IS NULL;

COMMENT ON TABLE blocked_devices IS
  'D13 block device. device_hash is SHA-256 of the canonical device id, never the token or the id.';

-- Admin outcomes on a tag report (Reports section), including "fake tag".
-- tag_reports.resolution keeps its 0026 CHECK (the feeder's outcomes); an
-- admin outcome is recorded here beside it.
ALTER TABLE tag_reports ADD COLUMN IF NOT EXISTS admin_outcome TEXT;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'tag_reports_admin_outcome_chk' AND conrelid = 'tag_reports'::regclass) THEN
    ALTER TABLE tag_reports ADD CONSTRAINT tag_reports_admin_outcome_chk
      CHECK (admin_outcome IS NULL OR admin_outcome IN ('reprinted', 'spare', 'checked_ok', 'fake_tag', 'no_action')) NOT VALID;
  END IF;
END $do$;
ALTER TABLE tag_reports VALIDATE CONSTRAINT tag_reports_admin_outcome_chk;

ALTER TABLE scans ADD COLUMN IF NOT EXISTS photo_hidden_at TIMESTAMPTZ;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS photo_hidden_by UUID REFERENCES feeders(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- 9. Care directory: government vets as people
-- ---------------------------------------------------------------------------
ALTER TABLE care_providers ADD COLUMN IF NOT EXISTS is_government BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE care_providers ADD COLUMN IF NOT EXISTS is_person     BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE care_providers ADD COLUMN IF NOT EXISTS reg_no        TEXT;
ALTER TABLE care_providers ADD COLUMN IF NOT EXISTS wards         TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN care_providers.is_government IS
  'A government vet or hospital: always free, labelled "Government vet · free" / "Government hospital · free".';

-- ---------------------------------------------------------------------------
-- Grants. New tables get no privileges by default (0022/0023 pattern).
-- audit_log: SELECT and INSERT only, and UPDATE/DELETE/TRUNCATE revoked even
-- if a blanket GRANT ALL is ever run again (AGENTS.md section f's recipe
-- re-applies these REVOKEs after it).
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  t TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    FOREACH t IN ARRAY ARRAY['admin_roles', 'invites', 'vet_profiles', 'documents', 'webauthn_credentials',
                             'webauthn_challenges', 'ngos', 'ngo_members', 'ngo_vets', 'sos_dispatches',
                             'sign_requests', 'drives', 'drive_dogs', 'avatar_batches', 'dog_avatars',
                             'dog_merges', 'duplicate_dismissals', 'reports', 'blocked_devices'] LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
    END LOOP;
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE avatar_batches_number_seq TO app_user';
    EXECUTE 'GRANT SELECT, INSERT ON audit_log TO app_user';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_user';
  END IF;
END $do$;
