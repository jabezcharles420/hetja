-- Hetja · migration 0025_dog_reported_medical
--
-- dogs.vaccinated_reported / dogs.sterilised_reported: what the REGISTRATOR
-- said about the dog's medical status on the New dog screen (design v4,
-- screen 10), written by POST /api/v1/registrations when the client sends
-- vaccinatedReported / sterilisedReported.
--
-- These are self-reports, nothing more. The public profile's Vaccinated and
-- Sterilised pills come only from vet-verified medical records
-- (routes/dogs.ts), which is exactly what the screen's caption promises:
-- "Vets can confirm medical status later." No public read selects these
-- columns.
--
-- NULL means "not asked" (every row older than this migration, and every
-- registration from a client that does not send the fields); false means
-- "asked, and the answer was no". There is no backfill because there is
-- nothing true to backfill with.
--
-- ADDITIVE ONLY, shaped for both targets (local PostgreSQL and Supabase):
--   * ADD COLUMN IF NOT EXISTS, nullable, no default: catalog-only, no table
--     rewrite, no long ACCESS EXCLUSIVE hold, and a re-run is a no-op.
--   * No role is named: app_user's privileges on dogs come from table-level
--     grants (0022), which cover new columns automatically.
-- Nothing here matches ops/check-destructive-migrations.sh's patterns.

ALTER TABLE dogs ADD COLUMN IF NOT EXISTS vaccinated_reported BOOLEAN;
ALTER TABLE dogs ADD COLUMN IF NOT EXISTS sterilised_reported BOOLEAN;

COMMENT ON COLUMN dogs.vaccinated_reported IS
  'Registrator''s self-report at registration (NULL = not asked). Never shown '
  'publicly as Vaccinated: only vet-verified medical_records are.';
COMMENT ON COLUMN dogs.sterilised_reported IS
  'Registrator''s self-report at registration (NULL = not asked). Never shown '
  'publicly as Sterilised: only vet-verified medical_records / abc_status are.';
