# Data format

## providers.jsonl (accepted, one JSON object per line)

```json
{"candidate_id":"<stable slug of the name>","name":"","matched":true,
 "kind":"govt|ngo|charity_hospital",
 "cost_tier":"free|subsidised|paid|null",
 "phone":"","alt_phone":"","address":"","locality":"","ward":"",
 "lat":null,"lng":null,"hours":"","is_24x7":false,"ambulance":false,
 "handles_wildlife":false,
 "source_url":"","cost_source":"","phone_source":"","address_source":"",
 "hours_source":"","confidence":"high|medium|low","verified_by":"",
 "notes":""}
```

- `candidate_id`: lowercase name, every run of non-alphanumerics becomes one `-`.
- `kind`: `govt` for municipal, government or animal-husbandry facilities;
  `ngo` / `charity_hospital` for welfare organisations.
- `ward`: a BMC code (`A`, `K/W`, `K-West`, ...) or `""`.
- `cost_tier`: null unless a page states it, with that page in `cost_source`.
- `verified_by`: the verifier's id or note. A row with no independent
  verification is not accepted.
- Coordinates: numbers only when a source states them or OSM carries them;
  otherwise leave both null.

## rejected.jsonl (one per dropped row)

```json
{"name":"","candidate_id":"","reason":"","source_url":""}
```

## report.md

Counts by kind and by ward, how many have a phone, how many have coordinates,
which wards are thin, and every fact you could not confirm.

## Final CSV (only if you are asked to produce the import file)

```
source_id,name,kind,cost_tier,address,locality,ward,lat,lng,phone,alt_phone,
ambulance,is_24x7,hours,handles_wildlife,confirmed_on,notes,source_url,
cost_source,phone_source,address_source,hours_source,confidence,verified_by
```

`ambulance`, `is_24x7`, `handles_wildlife` are `yes` / `no`. `confirmed_on`
stays empty: no human has called the number. `source_id` is `m-<candidate_id>`.
