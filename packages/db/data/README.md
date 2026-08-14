# Verified Mumbai care-directory dataset

`dogs_mumbai.csv` — 1,370 verified animal-welfare providers in Mumbai,
researched and verified by the maintainer on **2026-08-13**.

## Provenance

- **Source:** maintainer's own research run (2026-08-13), cross-checked
  against public listings — Justdial, Facebook pages, government sites
  (`vhd.mcgm.gov.in`, `barc.gov.in`), Practo, Mappls, org websites. The CSV's
  `evidence` and `sources` columns carry the per-row trail (live-site checks,
  maps listings, recent-mention counts).
- **Visibility:** public data (facilities listed in public directories and
  government pages). Safe to commit in this public AGPL-3.0 repo.
- **Licence/attribution:** compiled facts about public facilities; no
  third-party content is reproduced beyond names, addresses and publicly
  listed contact details.
- **Verification semantics:** `verified_at` is *record-level* research
  verification (site live, listing exists), NOT a phone-call check. The
  `evidence` column flags rows with `needs_phone_fill: true` — those numbers
  were never called. Accordingly `care_providers.phone_verified_at` stays
  NULL for every imported row (honesty rule, migration 0008).

## Shape (19 columns)

`name, category, subcategory, area, address, pincode, phone, phone_alt,
email, website, instagram, facebook, hours, services, status, evidence,
sources, verified_at, notes`

- `category`: `ngo` (1256) · `charity_clinic` (49) · `bmc_veterinary` (18) ·
  `govt_vet_hospital` (18) · `govt_animal_welfare` (15) ·
  `govt_vet_dispensary` (14)
- `area`: Mumbai locality (`Fort`, `Sion`, `Parel`, …); 787 rows say only
  `Mumbai` (no locality resolvable from the source) — those geocode from
  address where present, else fall back to the central-Mumbai centroid.
- `phone`: present on 330/1370 rows; formats are raw (spaces, no +91) —
  normalized to E.164 at import.
- `hours`/`services`: **empty for every row** — ambulance/24x7/wildlife
  flags are therefore imported as false (nothing claimed that was not
  confirmed).

## Import

`pnpm --filter @hetja/db geocode:care` (one-time, builds the address cache)
then `pnpm --filter @hetja/db import:care` — idempotent, `ON CONFLICT DO
NOTHING` against the `(name, COALESCE(phone_e164,''))` unique index. See
`src/import-care-verified.ts` for the full field mapping and assumptions.
