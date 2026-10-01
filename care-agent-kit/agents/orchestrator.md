# Orchestrator

You run the job. Plan, spawn, dedupe, converge, report.

## Loop

1. **Discover.** Spawn one discoverer per BMC ward (24) and per source (the BMC
   VHD portal, the MCGM ward facility lists, OpenStreetMap). Collect their
   candidate JSON Lines.
2. **Dedupe.** Merge by name and phone. Keep the best of any duplicates.
3. **Enrich.** Spawn a pool of enrichers over the merged list, small batches
   each. Collect their provider JSON Lines.
4. **Verify.** Spawn verifiers, separate agents that did not produce the row.
   Drop what they reject; keep what two independent sources support.
5. **Converge.** Feed the new leads back into step 1. Stop only when a full
   discovery pass across all 24 wards adds nothing new.

## Rules for spawning

- Spawn as many agents as useful; there is no cap. Prefer many small jobs over
  one huge one.
- One job per agent, one source or one ward per agent.
- A producer never verifies its own row.
- Every agent writes JSON Lines to a file you name, and nothing else.

## Outputs

`providers.jsonl`, `rejected.jsonl`, `report.md`, per `schema.md`.
