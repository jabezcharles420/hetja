# Care-directory agent (scripts)

Builds the Mumbai government and free dog-care directory from public records
and the open web, then folds it into one CSV for `import:care`.

Agent-agnostic by design: plain prompt files, a batch driver that runs whatever
command you point it at, and a deterministic merge that owns the CSV write. The
model never edits the CSV. Three roles: discoverer, enricher, verifier
(`.opencode/agents/care-*.md` wrap `prompts/*.md`).

Read [`docs/CARE-ENRICH-AGENT.md`](../../../../docs/CARE-ENRICH-AGENT.md) for the
full runbook. Short version:

```
node packages/db/scripts/care/queue.mjs                   # build the work queue
node packages/db/scripts/care/run-batch.mjs --limit 20    # calibrate
node packages/db/scripts/care/run-batch.mjs               # overnight run
node packages/db/scripts/care/merge.mjs                   # build the CSV
node packages/db/scripts/care/merge.mjs --check           # validate it
```

| File | Role |
|---|---|
| `prompts/discover.md` | Canonical discovery brief (any agent). |
| `prompts/enrich.md` | Canonical enrichment brief (any agent). |
| `prompts/verify.md` | Canonical adversarial verification brief: accept, unsure or reject. |
| `gates.mjs` | Shared name, geography, pharmacy and CSV gates. |
| `queue.mjs` | Discovery tasks (gov portals, 24 ward searches, Overpass) plus the pre-pruned seed providers from `dogs_mumbai.csv`. |
| `run-batch.mjs` | Writes each batch and its `PROMPT.md`, runs `HETJA_AGENT_CMD`, appends the JSON Lines it produced. Resumable. |
| `merge.mjs` | Dedupe, gate, prune, emit the monthly CSV, report, needs-cost and rejected files. `--check` validates. |

Only `packages/db/data/care/.work/` is scratch (gitignored). The generated
`<YYYY-MM>-mumbai.csv` and its report are deliverables and stay tracked.
