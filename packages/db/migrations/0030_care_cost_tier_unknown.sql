-- Hetja · migration 0030_care_cost_tier_unknown
--
-- care_providers.cost_tier may be UNKNOWN (NULL). The first file from the
-- owner's care-agent pipeline (packages/db/data/care/verified-2026-09-26.jsonl,
-- 31 NGOs, BMC dog-control offices and charity hospitals) had no cost tier for
-- 22 rows, and the directory's rule is that a cost tier is confirmed, never
-- guessed (0008, import-care.ts). Until now the only way to import such a row
-- was to invent a tier. Now it is imported with cost_tier NULL:
--
--   - the API answers costTier: null, and no surface claims "free" for it
--     (a government row is free by the owner's decision whatever this says);
--   - the directory sorts unknown AFTER the known tiers (PostgreSQL's
--     ascending order puts NULLs last, which is exactly that);
--   - the importer warns about each one, so a later month can fill it in.
--
-- ADDITIVE ONLY: DROP NOT NULL relaxes a constraint and loses no data; the
-- destructive gate exempts it by name (ops/check-destructive-migrations.sh).

ALTER TABLE care_providers ALTER COLUMN cost_tier DROP NOT NULL;

COMMENT ON COLUMN care_providers.cost_tier IS
  'free | subsidised | paid as confirmed with the provider, or NULL when unknown (never guessed). Government care is free by the owner''s decision.';
