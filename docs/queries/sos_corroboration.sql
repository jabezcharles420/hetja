-- sos_corroboration.sql — canonical derivation of a dog's SOS eligibility.
-- This is the read-side twin of the materialising UPDATE in
-- apps/api/src/routes/scans.ts (corroborateSosEligibility): same predicate,
-- committed here so the two cannot drift apart unobserved. INVARIANT 12 makes
-- CI EXPLAIN this file against the committed schema.
--
-- WHY MATERIALISED RATHER THAN DERIVED PER READ: wave 7 gates the SOS
-- responder fan-out on dogs.sos_eligible_at IS NOT NULL. A derived query can
-- flip back to false as the world changes under it (retention NULLs a photo
-- key, a review status changes) and a fan-out that silently turns itself off
-- is the failure class docs/INVARIANTS.md keeps recording. So eligibility is
-- SET ONCE, NEVER CLEARED, at corroboration time; the route stamps it, and
-- this file documents exactly what "corroborated" means.
--
-- Eligible when EITHER
--   * >= 2 geotagged scans from distinct subjects, where a subject is
--     COALESCE(feeder_id::text, 'dev:' || device_token) — one identity per
--     account or attested device, so one phone scanning twice corroborates
--     nothing; OR
--   * 1 geotagged scan by a verified feeder: role IN ('admin','vet',
--     'bmc_officer') or verification_tier = 'verified' (set only from the box,
--     cli/grant-verified.ts). trust_score is deliberately not consulted — see
--     INVARIANTS.md's recorded defect where one feed moved a score by 60 and
--     made score gates decorative.
--
-- Representative literal below (a stand-in dog id) rather than $n parameters,
-- following the care_nearby.sql precedent: check-queries.sh passes 'x' to
-- parameterised queries, which fails on the uuid cast — reporting a fixture
-- problem as if it were a schema one.
UPDATE dogs d
   SET sos_eligible_at = now()
 WHERE d.id = '00000000-0000-0000-0000-000000000000'::uuid
   AND d.sos_eligible_at IS NULL
   AND (
         (SELECT count(DISTINCT COALESCE(s.feeder_id::text, 'dev:' || s.device_token))
            FROM scans s
           WHERE s.dog_id = d.id
             AND s.geo IS NOT NULL) >= 2
         OR EXISTS (
              SELECT 1
                FROM scans s
                JOIN feeders f ON f.id = s.feeder_id
               WHERE s.dog_id = d.id
                 AND s.geo IS NOT NULL
                 AND (f.role IN ('admin', 'vet', 'bmc_officer')
                      OR f.verification_tier = 'verified'))
       );
