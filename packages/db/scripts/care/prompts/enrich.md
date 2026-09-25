# Task: enrich Mumbai government and free dog-care providers

For each provider in the batch file, find its **own published** contact and
service details, with a source URL for every field. A human reviews everything
you produce, and the importer re-validates it.

## Sources, in priority order

1. The provider's own website (follow its Contact and About links).
2. The provider's own official social page.
3. A government page: `vhd.mcgm.gov.in`, `mcgm.gov.in`, `bmc.gov.in`,
   `bmchealth.in`, or a Maharashtra animal-husbandry page.
4. OpenStreetMap (Overpass). Mark `method` as `osm` and attribute it.

Search engines may only point you at one of those pages. The value you write
must come from the page itself.

## The rules that cannot be broken

- Never write a value taken from a Google Maps or Google Places listing. Never
  use a `google.com/maps` or `maps.google.` URL as a source.
- Every non-null field needs a source URL. No source, no value: leave it null.
- Never set `cost_tier` unless a page states the cost. Government municipal
  service pages that say the service is free count. An organisation's own page
  that says "free" or "subsidised" counts. If no page states it, `cost_tier` is
  null; do not guess from the kind.
- Never mark a phone as confirmed. There is no such field here; do not invent
  one. A number is "as published", nothing more.
- Only Greater Mumbai: latitude 18.88 to 19.30, longitude 72.76 to 73.00. A
  provider whose only page is outside that box is `"matched": false`.
- One JSON object per input line, in input order.

## Input

The task header names a batch file. Each line is one provider:

```
{"candidate_id":"...","name":"...","kind_hint":"...","area":"...",
 "address":"...","website":"...","phone":"..."}
```

## Output

Write to the output file named in the task header. One JSON object per input
line, in input order, valid JSON, nothing else in the file.

```
{"candidate_id":"","name":"","matched":true,
 "kind":"govt|ngo|charity_hospital|private_clinic",
 "cost_tier":"free|subsidised|paid|null",
 "phone":"","alt_phone":"","address":"","locality":"","ward":"",
 "lat":null,"lng":null,"hours":"","is_24x7":false,"ambulance":false,
 "handles_wildlife":false,
 "method":"org-site|govt-site|osm|search",
 "confidence":"high|medium|low",
 "source_url":"","cost_source":"","phone_source":"","address_source":"",
 "hours_source":"","notes":"","fetched_at":"<ISO 8601 UTC>"}
```

Rules:

- `candidate_id` and `name`: copy from the input line unchanged.
- `matched`: false when you cannot find any Mumbai page for this provider. Then
  leave the detail fields null or empty and explain in `notes`.
- `phone` / `alt_phone`: as published, digits and optional `+91`. Put the page
  you read it from in `phone_source`.
- `ward`: a BMC ward code (`A`, `K/W`, `K-West`, ...) only if you can determine
  it; otherwise `""`.
- `cost_tier`: `null` unless stated, as above. Put the stating page in
  `cost_source`.
- `ambulance`, `is_24x7`, `handles_wildlife`: `true` only if a page states it.
- `hours`: free text exactly as the page words it, or `""`.
- `confidence`: `high` when the page is the provider's own and states the field;
  `medium` when it is a government or OSM source; `low` when inferred from a
  third party. Prefer omitting a field over emitting a low-confidence one.

When the batch is finished, stop. Do not read or write any file other than the
batch file, the output file, and the batch's working notes file if the header
names one.
