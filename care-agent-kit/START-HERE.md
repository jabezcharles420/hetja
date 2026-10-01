# Hetja care directory: multi-agent task

Read this, then `rules.md`, `schema.md`, and every file in `agents/`. Then run
the job.

## Goal

The complete, verified list of **government and free or subsidised dog-care
providers in Greater Mumbai** (the 24 BMC wards): name, kind, cost tier, phone,
address, locality, ward, coordinates, hours, ambulance, 24x7, wildlife. Every
fact tied to a source URL.

## You orchestrate, and you spawn

You are the orchestrator. Spawn as many sub-agents as you need, in parallel:

- many **discoverers**: one per BMC ward, one per source, one per language;
- a pool of **enrichers** working a shared list;
- at least one independent **verifier** per batch, whose job is to falsify.

Keep spawning and keep discovering until a full pass finds nothing new.

## Rules of engagement

- Use **web search extensively**, in English and Marathi. Try both:
  `पशुवैद्यकीय`, `भटक्या कुत्रे`, `प्राणी कल्याण`, `कुत्र्यांचे निर्बीजीकरण`.
- **Try really hard.** Chase every lead. Do not stop at the first page. Search
  each locality and each organisation name. Cross-check.
- **Independence:** a fact is never verified by the agent that produced it.
- Record what you could not confirm instead of guessing it.

## Input

`data/seeds.csv`: existing candidate rows to enrich, verify or drop.

## Output

- `providers.jsonl`: accepted providers, one JSON object per line.
- `rejected.jsonl`: dropped rows, each with a reason.
- `report.md`: counts, coverage by ward, gaps, what you could not confirm.

Format in `schema.md`.

## Non-negotiable

See `rules.md`. The three that matter most:

1. Never store Google Maps or Google Places content.
2. Every non-null field needs a source URL.
3. Never guess `cost_tier`; never mark a phone confirmed.
