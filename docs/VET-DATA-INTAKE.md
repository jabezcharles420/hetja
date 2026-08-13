# Vet & NGO data intake — the shape to hand over

You have a government vet database coming. This document is the mapping: what
Hetja needs, what it will do with each field, and what happens to the rows that
don't have everything. **Send whatever you have in whatever format you have it
in** — CSV, XLSX, a PDF of a directory, a scraped table. Do not clean it first;
cleaning it before knowing which fields matter is how good data gets thrown
away. The mapping below tells you which columns are load-bearing so you can
tell me what's missing.

The destination is one existing table, `care_providers`
([migration 0008](../packages/db/migrations/0008_care_providers.sql)), which is
already live and already serving the danger flow. Nothing needs to be built to
receive this data. What's needed is the import, and one decision about
geocoding (§4).

---

## 1. Where this data ends up

A stranger scans a collar, presses **this dog is hurt**, and the page calls:

```
GET /api/v1/care?lat=<their lat>&lng=<their lng>&max_km=5
```

That returns up to eight providers with tappable phone numbers. Every row you
send becomes a candidate for that list. This is the highest-stakes read path in
the system: it is what someone looks at while standing over an injured animal.

That is the reason for the strictness below. A wrong phone number in this table
is worse than a missing one, because a missing one sends the caller down the
list and a wrong one sends them nowhere while they believe they are being
helped.

---

## 2. Field mapping

### Load-bearing — a row is not useful without these

| Hetja column | Type | What it is | If absent |
|---|---|---|---|
| `name` | text | The organisation's name as the public would recognise it, not its registration name. "Bai Sakarbai Dinshaw Petit Hospital for Animals", not "BSDPHA Trust". | Row cannot be imported. |
| `kind` | enum | One of `ngo`, `govt`, `charity_hospital`, `private_clinic`. Government facilities → `govt`. | Defaults to `govt` for a government dataset, but tell me if the file mixes sources. |
| `cost_tier` | enum | One of `free`, `subsidised`, `paid`. This drives ordering — free care is surfaced first. | **Must not be guessed.** A government facility is usually `free` or `subsidised`; if the file doesn't say, we mark it and someone confirms per row. |
| `geo` | point | Latitude/longitude. See §4 — an address alone is fine, but it changes what the caller is shown. | Row cannot be imported; the table requires a location. |
| `phone_e164` | text | One number, in `+91XXXXXXXXXX` form. Landlines included. | Allowed to be null — some facilities publish only an address — but a row with no number and no ambulance is close to useless in an emergency. |

### High-value — meaningfully changes what the caller sees

| Hetja column | Type | Why it matters |
|---|---|---|
| `has_ambulance` | bool | **The single most valuable field in the file.** Ambulance-equipped providers are ranked first for anyone who cannot transport a dog themselves, which is most people. |
| `is_24x7` | bool | An emergency at 2 a.m. against a directory of 10-to-5 clinics is a dead end. |
| `hours_note` | text | Free text for anything that isn't a clean 24×7 flag — `"9pm–3am only"`, `"closed Sundays"`, `"OPD 10:00–13:00, emergency on call"`. Verbatim from the source is better than normalised. |
| `alt_phone_e164` | text | A second number. Volunteer-run lines go unanswered constantly; a fallback is real value. |
| `handles_wildlife` | bool | Birds, monkeys, snakes. Callers frequently find something that isn't a dog. |
| `ward_id` | text | BMC ward code (`A`, `H/W`, `K/E`, …). Useful for coverage analysis — which wards have no free care within 5 km. |
| `locality` | text | Human-readable place name — `"Parel"`, `"Malad"`, `"Sewri"`. This is what gets shown *instead of a distance* when coordinates are estimated. See §4. |

### Set by us, not by you

| Column | Meaning |
|---|---|
| `source` | `'govt-<dataset name>-<year>'` for this import, so these rows are separable from the 25 curated ones already in the table and from anything imported later. |
| `source_ref` | Your file's own row ID or licence number, so a row can be traced back to the source of record. **Include an ID column if the dataset has one** — it makes re-imports idempotent instead of duplicative. |
| `geo_precision` | `exact` or `locality` — see §4. |
| `phone_verified_at` | §3. |
| `vet_id` | Set only if a listed facility is also a contracted Hetja partner clinic. Almost certainly null for all of these. |
| `listed` | Whether it appears in results. Lets a bad row be hidden without deleting it. |

---

## 3. Phone numbers: verified vs published

Every imported number starts with `phone_verified_at = NULL`, meaning **nobody
has called it**. The API returns that state to the client, which shows the
number *labelled as unconfirmed* rather than hiding it or presenting it as fact.
A possibly-stale number beats no number; the caller just gets told which it is.

A number becomes verified when a human dials it, someone answers, and they
confirm they treat animals at that location. There is no automated substitute
for this. Government directories go stale — the existing seed research found the
same NGO published under two different numbers.

So: send the numbers as published, don't pre-filter them, and expect the
verification pass to be phone work. ~30 rows already in the table are waiting on
the same thing.

---

## 4. The geocoding decision — the one thing to settle up front

Government directories almost always carry **addresses**, not coordinates.
`care_providers.geo` is `NOT NULL`, so every row needs a point. There are two
honest ways to produce one, and they lead to different user experiences:

**`geo_precision = 'exact'`** — the address was geocoded to a real point. The
API computes and returns a true `distanceM`, and the row sorts by actual
distance ahead of every estimated row. This is what you want.

**`geo_precision = 'locality'`** — the point is a ward or locality centroid.
The API returns `distanceM: null` and shows the `locality` name instead
("in Parel"), and the row is ranked by ambulance/cost/hours rather than by a
distance nobody measured.

The default is `locality`, deliberately, so a row that forgets to declare its
precision under-claims rather than over-claims.

This distinction exists because of a real bug: 25 seeded organisations shared 18
coordinates, and the API happily rendered *"BHL Bird Helpline — 0 m away"* for
whichever one shared a centroid with the caller. Someone reading that skips a
hospital that is genuinely closer.

**Recommendation:** geocode the addresses in a single batch before import — a
government dataset of a few hundred Mumbai facilities is a cheap one-off run
against a geocoder, and the difference in the emergency flow is large: a real
"340 m away, has ambulance" versus "somewhere in Andheri". Anything that fails
to geocode confidently comes in as `locality` with a place name rather than
being dropped.

---

## 5. Ideal handover format

A single CSV/XLSX with a header row. Column names don't matter — I'll map them —
but this is the shape that needs no follow-up questions:

```csv
source_id,name,kind,cost_tier,address,locality,ward,lat,lng,phone,alt_phone,
ambulance,is_24x7,hours,handles_wildlife,notes
```

Keep the original address column even if you also send coordinates; it's what
makes a geocode auditable later.

**Also send:** where the dataset came from and its date, whether it is public or
internal, and any licence/attribution terms. This repository is AGPL-3.0 and
public, so data that cannot be published needs to be known about *before* it is
committed.

**Don't bother:** deduplicating, normalising phone formats, translating names,
or removing rows that look incomplete. All of that is scriptable; judgement
about which facilities actually exist is not.

---

## 6. What happens after the file arrives

1. **Profile it** — row count, null rates per column, how many rows have
   coordinates, how many distinct phone numbers, obvious duplicates.
2. **Report back before importing** what fraction of rows will land as `exact`
   vs `locality`, and how many are missing a phone entirely. If most of the
   dataset can only be `locality`, the geocoding call in §4 gets made with real
   numbers in hand rather than as a guess.
3. **Geocode** the addresses (§4).
4. **Import** via a script in `packages/db/`, following the existing
   `seed-care.ts` pattern: `ON CONFLICT DO NOTHING` against the
   `(name, COALESCE(phone_e164,''))` unique index, so re-running is safe and
   never duplicates. Idempotence is why `source_ref` matters.
5. **Verify the read path** — call `GET /api/v1/care` from several real Mumbai
   coordinates and check that the top results are plausible: ambulances first,
   free before paid, no fabricated distances, no `0 m` rows.
6. **Migration goes through CI** like everything else, which means the
   destructive-change gate reviews it. A pure insert passes untouched.

No schema change is expected. If the dataset carries a field genuinely worth
keeping that has nowhere to go — specialisations, capacity, a large-animal flag
— that's an additive migration, and additive migrations deploy without a human
approval marker.

---

## 7. Related

- [HOW-IT-WORKS.md](HOW-IT-WORKS.md) §3.2 — the danger flow this data feeds
- [`packages/db/migrations/0008_care_providers.sql`](../packages/db/migrations/0008_care_providers.sql) — the table
- [`packages/db/migrations/0009_care_geo_precision.sql`](../packages/db/migrations/0009_care_geo_precision.sql) — why precision is recorded
- [`apps/api/src/routes/care.ts`](../apps/api/src/routes/care.ts) — the ordering rules in full
- [`packages/db/src/seed-care.ts`](../packages/db/src/seed-care.ts) — the import pattern to follow
