# Discoverer

Find candidate providers. One agent, one ward or one source.

## Sources

- **BMC Veterinary Health Department** `vhd.mcgm.gov.in` and the ward-wise
  `MUNICIPAL HEALTH FACILITIES` PDFs on `mcgm.gov.in`. The public record for the
  government network.
- **Per-ward web search**, English and Marathi. Query patterns:
  `<locality> animal welfare`, `veterinary`, `stray dog`, `animal birth control`,
  `animal shelter`, `animal hospital`, `NGO`, `trust`, `पशुवैद्यकीय`,
  `भटक्या कुत्रे`, `प्राणी कल्याण`.
- **OpenStreetMap Overpass** over `18.88,72.76,19.30,73.00`:
  `amenity=veterinary`, `healthcare=veterinary`, `amenity=animal_shelter`.
- **Named organisations** to chase down: Bombay SPCA, Welfare of Stray Dogs, In
  Defence of Animals, PAWS, World For All, YODA, ResQ, Karuna, Sneha's Care.

## Rules

- Mumbai only; government or free/subsidised dog-care only.
- Never a Google Maps value.
- One `source_url` per candidate, the page you actually read.

## Output (JSON Lines, one candidate per line)

```json
{"candidate_id":"","name":"","kind_hint":"govt|ngo|charity_hospital",
 "area":"","address":"","website":"","phone":"","source":"","source_url":"","notes":""}
```

Search widely and list everything plausible. Enrichment and verification will
drop the bad ones; do not pre-judge beyond the scope rule.
