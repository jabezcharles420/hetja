-- StrayNet · migration 0008_care_providers
-- Public directory of third-party animal-welfare care providers (NGOs, BMC/
-- govt facilities, charity hospitals, private clinics) that Hetja merely
-- LISTS -- this is deliberately a new table, not an extension of `vets`.
-- `vets` (0001_init.sql) is a contractual registry used for SOS routing and
-- ledger signatures: signing_key_pub NOT NULL, retainer_paise, mou_signed_at.
-- Putting those columns on an NGO we have no relationship with is wrong
-- (docs/PLAN-v2.md §2.1). `vet_id` below is the one bridge: set only when a
-- listed provider also happens to be a contracted partner clinic.
--
-- phone_verified_at is load-bearing, not metadata: the seed research
-- (packages/db/src/seed-care.ts) found the same NGO published under two
-- different numbers, and volunteer-run helplines rot. A number nobody has
-- called is NEVER presented to a caller as confirmed -- it stays NULL until
-- a human actually verifies it.

CREATE TYPE care_kind      AS ENUM ('ngo','govt','charity_hospital','private_clinic');
CREATE TYPE care_cost_tier AS ENUM ('free','subsidised','paid');

CREATE TABLE care_providers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  kind              care_kind NOT NULL,
  cost_tier         care_cost_tier NOT NULL,
  phone_e164        TEXT,                     -- nullable: some publish only an address
  alt_phone_e164    TEXT,
  geo               GEOGRAPHY(Point,4326) NOT NULL,
  ward_id           TEXT,
  has_ambulance     BOOLEAN NOT NULL DEFAULT FALSE,
  is_24x7           BOOLEAN NOT NULL DEFAULT FALSE,
  hours_note        TEXT,                     -- "9pm–3am only" (Karuna)
  handles_wildlife  BOOLEAN NOT NULL DEFAULT FALSE,
  source            TEXT NOT NULL,            -- 'curated' | 'osm'
  source_ref        TEXT,                     -- OSM node/way id
  vet_id            UUID REFERENCES vets(id), -- set when also a partner clinic
  phone_verified_at TIMESTAMPTZ,              -- someone actually called it
  listed            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX care_geo_gix ON care_providers USING GIST (geo) WHERE listed;

-- Idempotent-seeding support (packages/db/src/seed-care.ts uses ON CONFLICT
-- DO NOTHING against this index). A plain UNIQUE(name, phone_e164) does not
-- work here: Postgres treats every NULL as distinct from every other NULL,
-- so two rows for the same NGO that both publish no phone (phone_e164 IS
-- NULL, per the "some publish only an address" case above) would NOT
-- collide and would silently duplicate on re-seed. Coalescing to '' in the
-- index expression makes NULL phones compare equal to each other, closing
-- that gap.
CREATE UNIQUE INDEX care_providers_name_phone_uq
  ON care_providers (name, (COALESCE(phone_e164, '')));
