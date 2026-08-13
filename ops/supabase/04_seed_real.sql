-- ---------------------------------------------------------------------------
-- Hetja — genuine Phase-0 seed data. Apply AFTER 01_schema.sql.
--
-- Extracted from the pilot database, deliberately EXCLUDING the accumulated
-- test residue (64 "GeoTest" dogs, 17 "SosTest", 18 "Test Clinic" vets and the
-- medical rows that can never be deleted because the table is append-only).
--
-- The five dog slugs below are carried across verbatim and MUST NOT be
-- regenerated: they are laser-etched on physical collars. Running
-- `pnpm db:seed` instead would call generateSlug() and mint new ones, silently
-- breaking every tag already in the field.
--
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------

BEGIN;

-- Dogs (5) — slugs are physical artefacts, preserved exactly.
INSERT INTO dogs (id, slug, name, sex, coat_pattern, ward_id, status) VALUES ('eab94d86-d6e6-484c-93e2-e40a2aeccdba', '5hreaphdq', 'Ginger', 'female', 'white', 'M-East', 'active') ON CONFLICT (slug) DO NOTHING;
INSERT INTO dogs (id, slug, name, sex, coat_pattern, ward_id, status) VALUES ('c0262f4d-5f4c-436c-9186-595ce192da7e', 'c3di5esh8', 'Rosie', 'female', 'fawn', 'K-West', 'active') ON CONFLICT (slug) DO NOTHING;
INSERT INTO dogs (id, slug, name, sex, coat_pattern, ward_id, status) VALUES ('5caa5188-295f-437e-a513-7c4455d7cb1f', 'jo23vpmg5', 'Simba', 'male', 'brown', 'L-East', 'active') ON CONFLICT (slug) DO NOTHING;
INSERT INTO dogs (id, slug, name, sex, coat_pattern, ward_id, status) VALUES ('cf898333-68ab-4f0f-aa50-cd68b4975d24', 'jtkkaece2', 'Tommy', 'male', 'grey', 'K-West', 'active') ON CONFLICT (slug) DO NOTHING;
INSERT INTO dogs (id, slug, name, sex, coat_pattern, ward_id, status) VALUES ('6ad2b028-4a96-4399-a1e4-3a07cad82209', 'md5wicnma', 'Bruno', 'male', 'black', 'K-West', 'active') ON CONFLICT (slug) DO NOTHING;

-- Collars (5) — batch P0-0001..0005, HMAC signatures preserved.
INSERT INTO collars (id, dog_id, qr_code, hmac_sig, batch_no, material) VALUES ('7491e9fe-ebaa-45d0-869c-5e96bb54d6f9', 'c0262f4d-5f4c-436c-9186-595ce192da7e', 'c3di5esh8', 'O3mhImVarN04xG2vWU_hWmHU7kx6AfbWr2dYNF2h0Rc', 'P0-0001', 'TPU-Shore-95A') ON CONFLICT (qr_code) DO NOTHING;
INSERT INTO collars (id, dog_id, qr_code, hmac_sig, batch_no, material) VALUES ('e2c5737a-9bfb-49e5-ab3e-93a068972fa7', '6ad2b028-4a96-4399-a1e4-3a07cad82209', 'md5wicnma', '_CYBKR28owBniJUaDfelP4YN1SS524DLAzc7Fm2htEc', 'P0-0002', 'TPU-Shore-95A') ON CONFLICT (qr_code) DO NOTHING;
INSERT INTO collars (id, dog_id, qr_code, hmac_sig, batch_no, material) VALUES ('1998f4f5-96ae-4fb3-92e2-07ac56c1884b', '5caa5188-295f-437e-a513-7c4455d7cb1f', 'jo23vpmg5', 'jwwbATpBxlpK0gMAUqb2UqPmuDib_ZpcTMaPuskbRv4', 'P0-0003', 'TPU-Shore-95A') ON CONFLICT (qr_code) DO NOTHING;
INSERT INTO collars (id, dog_id, qr_code, hmac_sig, batch_no, material) VALUES ('f4a8b7f7-d411-4b6a-9990-af85f0638c8a', 'eab94d86-d6e6-484c-93e2-e40a2aeccdba', '5hreaphdq', 'dQAtLdCDHhF-y-eF51qobBHK_OySj2cKMBZ1uB6RKnA', 'P0-0004', 'TPU-Shore-95A') ON CONFLICT (qr_code) DO NOTHING;
INSERT INTO collars (id, dog_id, qr_code, hmac_sig, batch_no, material) VALUES ('df9204d3-cc4c-4a0d-a033-85e9f7c41bbf', 'cf898333-68ab-4f0f-aa50-cd68b4975d24', 'jtkkaece2', 'UO_V_gL_0zEg-F3Oxkawugtw6SuzFBDS6o9bMHJcDUo', 'P0-0005', 'TPU-Shore-95A') ON CONFLICT (qr_code) DO NOTHING;

-- The Phase-0 lead feeder.
INSERT INTO feeders (id, phone_hmac, display_name, role, trust_score, consent_version) VALUES ('3aa4cef0-8b32-425d-bd52-d730fd1ae347', 'hmac-seed-feeder-0001', 'Phase0 Lead Feeder', 'feeder', 60, 'v1.0') ON CONFLICT (phone_hmac) DO NOTHING;

-- Migration ledger, so `db:migrate` is a no-op against this project.
INSERT INTO schema_migrations (filename) VALUES ('0001_init.sql') ON CONFLICT (filename) DO NOTHING;
INSERT INTO schema_migrations (filename) VALUES ('0002_dogs_received_at.sql') ON CONFLICT (filename) DO NOTHING;
INSERT INTO schema_migrations (filename) VALUES ('0002_last_seen_received.sql') ON CONFLICT (filename) DO NOTHING;
INSERT INTO schema_migrations (filename) VALUES ('0003_vets_feeder_link.sql') ON CONFLICT (filename) DO NOTHING;
INSERT INTO schema_migrations (filename) VALUES ('0004_ledger_payload.sql') ON CONFLICT (filename) DO NOTHING;
INSERT INTO schema_migrations (filename) VALUES ('0005_dog_stories_unique.sql') ON CONFLICT (filename) DO NOTHING;
INSERT INTO schema_migrations (filename) VALUES ('0005_territory_primary.sql') ON CONFLICT (filename) DO NOTHING;
INSERT INTO schema_migrations (filename) VALUES ('0006_trust_recomputed.sql') ON CONFLICT (filename) DO NOTHING;
INSERT INTO schema_migrations (filename) VALUES ('0007_gamification_last_feed.sql') ON CONFLICT (filename) DO NOTHING;
INSERT INTO schema_migrations (filename) VALUES ('0008_care_providers.sql') ON CONFLICT (filename) DO NOTHING;
INSERT INTO schema_migrations (filename) VALUES ('0009_care_geo_precision.sql') ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- Deliberately NOT carried across:
--   * medical_records — all 79 rows were test-generated (seed.ts creates none;
--     the only ones on a real dog were 17 identical feeding_observation and 17
--     identical ARV vaccination rows on Rosie, one pair per test run)
--   * vets — all 18 were "Test Clinic"
--   * scans — the single real one is a feed log with no lasting value
--   * care_providers — seeded from code instead: `pnpm --filter @hetja/db seed:care`
