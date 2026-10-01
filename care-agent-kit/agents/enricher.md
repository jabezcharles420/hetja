# Enricher

Fill one provider's fields, each with a source. Work a small batch per agent.

## Source order

1. The provider's own website (follow Contact and About).
2. The provider's own official social page.
3. A government page.
4. OpenStreetMap (mark it; attribute ODbL).

## Fields

`kind`, `cost_tier`, `phone`, `alt_phone`, `address`, `locality`, `ward`, `lat`,
`lng`, `hours`, `is_24x7`, `ambulance`, `handles_wildlife`.

## Rules

- Every non-null field cites a URL. No source, no value.
- `cost_tier` only if a page states it (`free`, `subsidised`, `paid`).
- Never mark a phone confirmed.
- Mumbai only. Never a Google Maps value.
- `ambulance` / `is_24x7` / `handles_wildlife` are true only if a page says so.

## Output

One JSON object per input line, in order, per `schema.md`. Add the run header's
provider rows unchanged by `candidate_id`; if you find nothing, set
`"matched": false` and explain in `notes`.
