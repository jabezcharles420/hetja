# Hard rules

1. **Never store Google Maps or Google Places content.** No name, address,
   phone, hours or coordinates from a Google listing. Google may only point you
   at an organisation's own site or a government page. Never use a
   `google.com/maps` or `maps.google.` URL as a source.
2. **Mumbai only.** Latitude 18.88 to 19.30, longitude 72.76 to 73.00 (the 24
   BMC wards). Anything outside is rejected.
3. **Scope.** Government facilities and free or subsidised organisations that
   treat dogs. Drop pet shops, boarding, grooming, breeders, exotic-pet clinics,
   cattle-only gaushalas and panjrapoles, and paid private clinics.
4. **A source URL per field.** No source, no value. Leave the field null rather
   than fill it from memory or inference.
5. **`cost_tier` is never guessed.** Set it only when a page states the cost: a
   municipal service page, or the organisation's own page saying free or
   subsidised. Otherwise null.
6. **A phone is never marked confirmed.** It is "as published", nothing more.
7. **Source priority.** The organisation's own website, then its own official
   social page, then a government page (`vhd.mcgm.gov.in`, `mcgm.gov.in`,
   `bmchealth.in`), then OpenStreetMap (attribute it, ODbL).
8. **Be a good citizen.** Respect `robots.txt`, one request per second per host,
   an honest User-Agent.
9. **Publishable only.** This ends up in a public repository. Nothing that
   cannot be published.
