# Task: discover Mumbai government and free dog-care providers

You are finding **candidate** providers for Hetja's Mumbai care directory.
Hetja lists government facilities and free or subsidised animal-welfare
organisations that treat street dogs, inside Greater Mumbai (the 24 BMC wards).

This is **discovery only**. You are not the system of record. A human reviews
everything you produce, and the importer re-validates it.

## The rule that cannot be broken

Never write a value that came from a Google Maps or Google Places listing into
your output. No name, address, phone, hours or coordinates. Google results, if
you use them at all, may only point you at an organisation's own website or at a
government page; the value you write must come from that page. Never use a
`google.com/maps` or `maps.google.` URL as `source_url`.

## Scope

- Only Greater Mumbai: latitude 18.88 to 19.30, longitude 72.76 to 73.00. If a
  candidate is outside that box, do not emit it as a candidate; put the reason
  in your run notes.
- Only government facilities and free or subsidised animal-welfare
  organisations. Skip pet shops, pet boarding, grooming, breeders, exotic-pet
  clinics, cattle-only gaushalas and panjrapoles, and paid private clinics.

## Input

The task header names a batch file. Each line is one JSON task, one of:

- `{"type":"gov-portal","url":"...","label":"..."}` : read that page and any
  pages it links to about facilities, wards, dispensaries, animal birth control
  centres or animal hospitals.
- `{"type":"ward-search","ward":"K-West","name":"Andheri West"}` : find animal
  welfare and veterinary providers in that BMC ward.
- `{"type":"web-search","query":"...","label":"..."}` : search the open web.
- `{"type":"overpass","query":"<Overpass QL>","label":"..."}` : run the Overpass
  query and take the named places.

## Output

Write to the output file named in the task header. One JSON object per candidate,
one per line, valid JSON, nothing else in the file (no prose, no markdown fence).

Required keys:

```
{"candidate_id":"","name":"","kind_hint":"govt|ngo|charity_hospital",
 "area":"","address":"","website":"","phone":"",
 "source":"gov-portal|ward-search|web-search|overpass|org-site",
 "source_url":"","notes":""}
```

Rules:

- `candidate_id`: stable slug of the name: lowercase, every run of non
  alphanumeric characters becomes one `-`, trim leading and trailing `-`.
- `name`: the organisation's public name as a person would recognise it, not a
  registration name.
- `kind_hint`: `govt` for a municipal, government or animal-husbandry facility;
  `ngo` or `charity_hospital` for a welfare organisation. Use `govt` when unsure
  between the two only if the name says municipal or government.
- `source_url`: the page you actually read the facts from. Required. A row with
  no `source_url` is worthless.
- Unknown field: use `""` and say what is missing in `notes`. Never invent a
  phone number, address or coordinate.
- Coordinates: include `"lat"` and `"lng"` numbers only if the page states them
  or an Overpass result carries them; otherwise omit both keys.

When the batch is finished, stop. Do not read or write any file other than the
batch file and the output file.
