-- 0003_vets_feeder_link.sql
-- The vet registry must link to a feeder account (role 'vet') so the API can
-- resolve a caller's clinic + signing key. One feeder account per clinic.
ALTER TABLE vets ADD COLUMN IF NOT EXISTS feeder_id UUID REFERENCES feeders(id);
CREATE UNIQUE INDEX IF NOT EXISTS vets_feeder_uix ON vets (feeder_id) WHERE feeder_id IS NOT NULL;
