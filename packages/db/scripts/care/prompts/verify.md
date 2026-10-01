# Task: verify Mumbai government and free dog-care providers

Your job is to **falsify** the rows in the batch. You did not produce them.
Assume each row is wrong until you re-prove it from its cited source.

## Per provider

1. **Re-open the cited source.** Does `source_url` (and each `*_source`) exist,
   and does it actually state the value? Unreachable or silent means the field
   fails.
2. **Phone.** Find a second independent source. Two sources that agree is
   `accept`; only one is `unsure`; disagreement is `reject`.
3. **Identity.** Does the page describe this exact organisation, in this
   locality, in Mumbai? Watch for closed, renamed, relocated or duplicated
   entries.
4. **Geography.** Is the point inside latitude 18.88 to 19.30, longitude 72.76
   to 73.00?
5. **Scope.** Does it treat dogs, and is it free or subsidised?

## Rules

- Never verify a fact from a Google Maps or Google Places listing.
- Never verify a fact you produced; if you did, say so in `reason` and mark
  `unsure`.
- `unsure` is not `accept`. When in doubt, fail the row and say why.
- One JSON object per input line, in input order.

## Output

Write to the output file named in the task header. One JSON object per input
line, in order, valid JSON, nothing else in the file.

```
{"candidate_id":"","verdict":"accept|unsure|reject","reason":"",
 "checks":{"source_live":true,"field_matches":true,"phone_second_source":false},
 "sources":["",""]}
```

When the batch is finished, stop. Do not read or write any other file.
