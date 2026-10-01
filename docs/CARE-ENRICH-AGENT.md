# Care-directory agent: runbook

An overnight agent builds Hetja's Mumbai directory of **government and free or
subsidised dog-care providers**, then folds it into one CSV for the existing
`import:care` path. It is **agent-agnostic**: the instructions live in plain
markdown, and a batch driver runs whatever agent command you give it. opencode is
only the default.

Read [`VET-DATA-INTAKE.md`](VET-DATA-INTAKE.md) first for why the rules below are
strict. The short version: this drives the directory a stranger reads while
standing over an injured dog, so a wrong number is worse than a missing one.

## 0. The standalone kit

`care-agent-kit/` is a concise, self-contained version of this brief (a
START-HERE, the rules, the schema, and four role files: orchestrator, discoverer,
enricher, verifier) for handing to a multi-agent runner that can spawn its own
sub-agents and search the web. Zip it and send that:

```powershell
Compress-Archive -Path care-agent-kit\* -DestinationPath hetja-care-agent-kit.zip -Force
```

The kit and this runbook carry the same rules; the kit is written for an agent
you do not control, this runbook for the scripts in this repo.

---

## 1. The shape

Three stages, and the model only does the middle one:

1. **Queue** (`queue.mjs`): discovery tasks (the BMC VHD portal, 24 ward
   searches, Overpass queries) plus the existing rows from
   `packages/db/data/dogs_mumbai.csv`, pre-pruned.
2. **Agent** (`run-batch.mjs`): runs your agent command over small batches. The
   agent researches each item and writes **JSON Lines** to a file. It never
   touches the CSV.
3. **Merge** (`merge.mjs`): deterministic. Dedupes, gates, prunes, and writes the
   monthly import CSV plus an audit report.

Because the model only appends JSON Lines, a bad output can spoil at most one
line, and `merge.mjs` can refuse it. `import:care` then re-validates kind, cost
tier, ward and geometry.

## 2. The rules the agent must follow

- **Never store a Google Maps or Google Places value.** Google may only point at
  an organisation's own site or a government page. This is a licence term, not a
  preference.
- **A source URL per field.** No source, no value.
- **`cost_tier` is never guessed.** It is set only when a page states the cost
  (a municipal service page, or the organisation's own page saying free or
  subsidised). Rows without a sourced tier go to `*.needs-cost.csv`, not the
  import file.
- **A number is never marked confirmed.** Agent-filled rows import with
  `phone_verified_at` NULL and are shown as unconfirmed.
- **Mumbai only.** Latitude 18.88 to 19.30, longitude 72.76 to 73.00.
- **Independent verification.** A verifier that did not produce a row re-proves
  it. A phone is accepted only on two independent sources; `unsure` fails the
  row, same as `reject`.

The full briefs are `packages/db/scripts/care/prompts/discover.md` and
`packages/db/scripts/care/prompts/enrich.md`. The `.opencode/agents/care-*.md`
files are thin wrappers around them.

## 3. Prerequisites

Node 20 or newer, and one agent command that can read a file and write JSON
Lines.

| Agent | How it is wired |
|---|---|
| opencode | Nothing to do; it is the default. Optionally `export HETJA_AGENT_MODEL=provider/model`. |
| Claude Code | `HETJA_AGENT_CMD='claude -p "$(cat {promptFile})" --permission-mode acceptEdits'` |
| Codex CLI | `HETJA_AGENT_CMD='codex exec "$(cat {promptFile})" --sandbox workspace-write'` |
| Your own script | `HETJA_AGENT_CMD='node tools/my-runner.mjs {promptFile} {batch} {out}'` |

`$(cat ...)` is POSIX shell; on Windows run the long job under WSL, or point the
template at a wrapper that reads the prompt file itself. opencode works natively
on Windows.

## 4. Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `HETJA_AGENT_CMD` | opencode command | Shell command template. Placeholders: `{promptFile} {batch} {out} {dir} {model} {agent} {phase}`. |
| `HETJA_AGENT_MODEL` | none | Substituted into `{model}`. |
| `HETJA_AGENT_DISCOVER` | `care-discoverer` | Substituted into `{agent}` for the discover phase. |
| `HETJA_AGENT_ENRICH` | `care-enricher` | Substituted into `{agent}` for the enrich phase. |
| `HETJA_AGENT_VERIFY` | `care-verifier` | Substituted into `{agent}` for the verify phase. |
| `HETJA_AGENT_BATCH` | `25` | Rows per batch. |
| `HETJA_AGENT_BATCH_MIN` | `20` | Wall clock per batch, minutes. |
| `HETJA_AGENT_BUDGET_MIN` | `480` | Whole-run wall clock, minutes. |

## 5. Running it

```bash
# 1. build the queue (safe, writes only .work/)
node packages/db/scripts/care/queue.mjs

# 2. calibrate on a small batch, then read the report and fix the prompt if needed
HETJA_AGENT_MODEL=opencode-go/deepseek-v4.1-flash \
  node packages/db/scripts/care/run-batch.mjs --limit 20

# 3. the overnight run (resumable: stop it, run it again, it continues)
HETJA_AGENT_BATCH=25 HETJA_AGENT_BUDGET_MIN=600 \
  HETJA_AGENT_MODEL=opencode-go/deepseek-v4.1-flash \
  node packages/db/scripts/care/run-batch.mjs --phase both

# 4. fold into the monthly CSV + report
node packages/db/scripts/care/merge.mjs
node packages/db/scripts/care/merge.mjs --check
```

Then review and ship:

```bash
git checkout -b care-enrich/$(date +%F)
git add packages/db/data/care packages/db/scripts/care docs/CARE-ENRICH-AGENT.md .opencode/agents
git commit -m "care: Mumbai govt and free dog-care directory from the enrichment agent"
gh pr create --fill
```

Import after the PR merges, dry run first:

```bash
pnpm --filter @hetja/db import:care -- \
  --file packages/db/data/care/2026-09-mumbai.csv --source mumbai-care-2026-09 --claim
pnpm --filter @hetja/db import:care -- \
  --file packages/db/data/care/2026-09-mumbai.csv --source mumbai-care-2026-09 --claim --apply
```

`--claim` absorbs rows another source already lists under the same name and
phone (the curated 25) instead of duplicating them. Use the same `--source` name
every month for this list.

## 6. What lands where

Under `packages/db/data/care/`:

| File | Meaning |
|---|---|
| `<YYYY-MM>-mumbai.csv` | The import file: monthly template plus `source_url` and per-field source columns. `confirmed_on` is empty by design. |
| `<YYYY-MM>-mumbai.report.csv` | Every provider and every rejected row, with the reason. |
| `<YYYY-MM>-mumbai.needs-cost.csv` | Rows that pass every other gate but lack a sourced cost tier. Confirm the cost, add it, re-run merge. |
| `<YYYY-MM>-mumbai.rejected.json` | Every dropped row and why. |

Under `packages/db/data/care/.work/` (gitignored): `discover-tasks.jsonl`,
`providers.seed.jsonl`, `discover.jsonl`, `enrich.jsonl`, `done.json`,
`batches/`, `run.log`.

## 7. Cost and time

Discovery is cheap: a dozen or so page reads plus 24 ward searches plus three
Overpass queries. Enrichment is the bulk: one to three page reads per provider.
A full run over the few hundred real providers is a few hours at a batch of 25.
Set `HETJA_AGENT_BUDGET_MIN` so an overnight run stops on its own, and use a
cheap model for the calibration batch before committing to the long one.

## 8. Troubleshooting

- **A batch produced nothing.** See `.work/batches/<phase>-<n>.stdout.log`. If
  the agent wrote no file, the driver recovers JSON objects from stdout; if that
  also fails, the batch repeats and the run aborts after three in a row.
- **Windows.** The driver uses `spawn` with a manual timer, never `spawnSync`
  with `timeout`: inside opencode's bundled Bun on Windows that reports a bogus
  `ETIMEDOUT` for children that exited fine (oven-sh/bun#33932).
- **Line endings.** Runbooks and shell snippets here assume LF. A copy checked
  out with `core.autocrlf=true` breaks `bash ops/*.sh`; the Node scripts in this
  folder are already CRLF-safe.
- **Low yield.** Most of the 1,370 existing rows are phone-less non-government
  names; `queue.mjs` drops those before the agent sees them. A low kept count is
  the directory being honest, not a bug.
- **`import:care` refuses it.** That is the importer protecting production.
  Read the printed error, fix the file, run the dry run again.

## 9. The rest of the pipeline

The monthly refresh, the dry-run/apply workflow and the verification steps live
in [`VET-DATA-INTAKE.md`](VET-DATA-INTAKE.md) sections 6 to 8. The importer's
ordering rules are in [`apps/api/src/routes/care.ts`](../apps/api/src/routes/care.ts).
