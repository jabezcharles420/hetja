// Agent-agnostic batch driver for the Hetja care-directory agent.
//
//   node packages/db/scripts/care/run-batch.mjs [--phase discover|enrich|both]
//                                               [--limit N]
//
// It does not know what an "opencode agent" is. It writes, per batch, a batch
// file and a PROMPT.md, runs the command in HETJA_AGENT_CMD, and reads the JSON
// Lines the command produced. Any agent that can read a file and write JSON
// Lines works: opencode, Claude Code, Codex, aider, goose, or your own script.
//
//   HETJA_AGENT_CMD     shell command template. Placeholders:
//                         {promptFile} {batch} {out} {dir} {model} {agent} {phase}
//                       Default: opencode run --agent {agent} --auto [--model
//                       {model}] --file {promptFile} "Read the attached ...".
//   HETJA_AGENT_MODEL   optional, substituted into {model}
//   HETJA_AGENT_DISCOVER / HETJA_AGENT_ENRICH   agent names for {agent}
//   HETJA_AGENT_BATCH_MIN   per-batch wall clock, default 20
//   HETJA_AGENT_BUDGET_MIN  whole-run wall clock, default 480 (8 h, overnight)
//
// Resumable: progress lives in .work/done.json, and each batch is appended to
// .work/{phase}.jsonl. Interrupt it, run it again, and it continues.
//
// No spawnSync and no `timeout` option: inside opencode's bundled Bun on
// Windows a timed-out spawnSync reports a bogus ETIMEDOUT for children that
// exited fine (oven-sh/bun#33932). spawn + a manual timer avoids it.

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = (() => {
  let dir = HERE;
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg)) {
      try { if (JSON.parse(readFileSync(pkg, "utf8")).name === "hetja") return dir; } catch { /* keep walking */ }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error("could not find the hetja repo root above " + HERE);
})();

const DATA = path.join(ROOT, "packages", "db", "data");
const CARE = path.join(DATA, "care");
const WORK = path.join(CARE, ".work");
const BATCHES = path.join(WORK, "batches");
const PROMPTS = path.join(HERE, "prompts");

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const PHASE = argVal("--phase", process.env.HETJA_AGENT_PHASE || "both");
const LIMIT = Number(argVal("--limit", process.env.HETJA_AGENT_LIMIT || "0")) || 0;
const BATCH_SIZE = Number(process.env.HETJA_AGENT_BATCH || "25") || 25;
const BATCH_MIN = Number(process.env.HETJA_AGENT_BATCH_MIN || "20") || 20;
const BUDGET_MIN = Number(process.env.HETJA_AGENT_BUDGET_MIN || "480") || 480;
const MODEL = process.env.HETJA_AGENT_MODEL || "";
const AGENTS = { discover: process.env.HETJA_AGENT_DISCOVER || "care-discoverer", enrich: process.env.HETJA_AGENT_ENRICH || "care-enricher" };
const isWin = process.platform === "win32";
const DEADLINE = Date.now() + BUDGET_MIN * 60_000;

function shq(v) {
  const s = String(v ?? "");
  if (isWin) return /[\s"&|<>^()]/.test(s) ? '"' + s.replace(/"/g, '\\"') + '"' : s;
  return /[^A-Za-z0-9_@%+=:,./-]/.test(s) ? "'" + s.replace(/'/g, "'\\''") + "'" : s;
}

function defaultCmd() {
  const parts = ["opencode", "run", "--auto", "--agent", "{agent}"];
  if (MODEL) parts.push("--model", "{model}");
  parts.push("--file", "{promptFile}");
  parts.push('"Read the attached instructions and do exactly what they say. Stop when the output file is complete."');
  return parts.join(" ");
}

const CMD_TEMPLATE = process.env.HETJA_AGENT_CMD || defaultCmd();

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

function readLines(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

function writeJsonl(file, rows) {
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

function loadDone() {
  const f = path.join(WORK, "done.json");
  if (!existsSync(f)) return { discover: [], enrich: [] };
  try {
    const d = JSON.parse(readFileSync(f, "utf8"));
    return { discover: d.discover || [], enrich: d.enrich || [] };
  } catch {
    return { discover: [], enrich: [] };
  }
}

function saveDone(done) {
  const f = path.join(WORK, "done.json");
  const tmp = f + ".tmp";
  writeFileSync(tmp, JSON.stringify(done, null, 2) + "\n");
  renameSync(tmp, f);
}

/** Enrichment items = seeded rows plus anything discovery found. */
function enrichItems() {
  const seeds = readJsonl(path.join(WORK, "providers.seed.jsonl"));
  const found = readJsonl(path.join(WORK, "discover.jsonl"));
  const byId = new Map();
  for (const it of [...seeds, ...found]) {
    if (!it || !it.candidate_id) continue;
    if (!byId.has(it.candidate_id)) byId.set(it.candidate_id, it);
  }
  return [...byId.values()];
}

function pending(phase, done) {
  const all = phase === "discover"
    ? readJsonl(path.join(WORK, "discover-tasks.jsonl"))
    : enrichItems();
  const seen = new Set(done[phase]);
  const out = [];
  for (const it of all) {
    const id = it.task_id || it.candidate_id;
    if (id && !seen.has(id)) out.push(it);
  }
  return out;
}

/** Pull JSON objects out of a model's raw stdout, fenced blocks included. */
function salvageJsonl(text) {
  const cleaned = String(text ?? "").replace(/^\s*```(?:json|jsonl)?\s*$/gim, "");
  const out = [];
  for (const line of cleaned.split(/\r?\n/)) {
    const s = line.trim().replace(/,$/, "");
    if (!s.startsWith("{") || !s.endsWith("}")) continue;
    try { out.push(JSON.parse(s)); } catch { /* not a whole object */ }
  }
  return out;
}

function buildPrompt(phase, batchPath, outPath, k) {
  const body = readFileSync(path.join(PROMPTS, `${phase}.md`), "utf8");
  const header = [
    `# Run header`,
    ``,
    `- phase: ${phase}`,
    `- batch: ${path.relative(ROOT, batchPath)}`,
    `- output: ${path.relative(ROOT, outPath)}`,
    `- agent: ${AGENTS[phase]}`,
    `- batch number: ${k}`,
    ``,
    `Read the batch file and the instructions below. Write your result to the`,
    `output file named above, one JSON object per line, in input order. Nothing`,
    `else in that file.`,
    ``,
    `---`,
    ``,
  ].join("\n");
  const promptPath = path.join(BATCHES, `${phase}-${k}.PROMPT.md`);
  writeFileSync(promptPath, header + body);
  return promptPath;
}

function command(phase, promptPath, batchPath, outPath) {
  return CMD_TEMPLATE
    .replaceAll("{promptFile}", shq(promptPath))
    .replaceAll("{batch}", shq(batchPath))
    .replaceAll("{out}", shq(outPath))
    .replaceAll("{dir}", shq(ROOT))
    .replaceAll("{model}", shq(MODEL))
    .replaceAll("{agent}", shq(AGENTS[phase]))
    .replaceAll("{phase}", shq(phase));
}

function runShell(line, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(line, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const cap = (s, add) => (s.length > 400_000 ? s : s + add);
    child.stdout.on("data", (d) => { out = cap(out, d.toString()); });
    child.stderr.on("data", (d) => { err = cap(err, d.toString()); });
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      resolve({ code: 124, out, err, timedOut: true });
    }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out, err: err + String(e), error: e }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out, err }); });
  });
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(msg);
  appendFileSync(path.join(WORK, "run.log"), line + "\n");
}

async function main() {
  mkdirSync(BATCHES, { recursive: true });
  if (!existsSync(path.join(WORK, "discover-tasks.jsonl"))) {
    throw new Error("no queue: run `node packages/db/scripts/care/queue.mjs` first");
  }
  const phases = PHASE === "both" ? ["discover", "enrich"] : [PHASE];
  const done = loadDone();
  let processed = 0;
  let consecutiveFailures = 0;

  for (const phase of phases) {
    const checkpoint = path.join(WORK, `${phase}.jsonl`);
    let k = readLines(path.join(WORK, "run.log")).length + 1;
    for (;;) {
      if (Date.now() > DEADLINE) { log(`budget of ${BUDGET_MIN} min reached; stopping (resumable)`); break; }
      if (LIMIT && processed >= LIMIT) { log(`limit of ${LIMIT} rows reached; stopping`); break; }
      const todo = pending(phase, done);
      if (!todo.length) { log(`${phase}: nothing pending`); break; }
      const take = todo.slice(0, Math.min(BATCH_SIZE, LIMIT ? LIMIT - processed : BATCH_SIZE));
      k += 1;
      const batchPath = path.join(BATCHES, `${phase}-${k}.in.jsonl`);
      const outPath = path.join(BATCHES, `${phase}-${k}.out.jsonl`);
      writeJsonl(batchPath, take);
      const promptPath = buildPrompt(phase, batchPath, outPath, k);
      const line = command(phase, promptPath, batchPath, outPath);
      const budgetLeft = Math.max(1, Math.round((DEADLINE - Date.now()) / 60_000));
      log(`${phase}: batch ${k} of ${take.length} rows (${budgetLeft} min left)`);
      const res = await runShell(line, { cwd: ROOT, timeoutMs: Math.min(BATCH_MIN, budgetLeft) * 60_000 });
      writeFileSync(path.join(BATCHES, `${phase}-${k}.stdout.log`), res.out + "\n--- stderr ---\n" + res.err);

      let produced = readJsonl(outPath);
      if (!produced.length) {
        produced = salvageJsonl(res.out);
        if (produced.length) {
          log(`${phase}: recovered ${produced.length} rows from stdout (no output file written)`);
          writeJsonl(outPath, produced);
        }
      }
      if (!produced.length) {
        consecutiveFailures += 1;
        log(`${phase}: batch ${k} produced nothing (exit ${res.code}${res.timedOut ? ", timed out" : ""}); see batches/${phase}-${k}.stdout.log`);
        if (consecutiveFailures >= 3) throw new Error("three batches produced nothing; check HETJA_AGENT_CMD and the model, then re-run");
        continue;
      }
      consecutiveFailures = 0;
      appendFileSync(checkpoint, produced.map((r) => JSON.stringify(r)).join("\n") + "\n");
      for (const it of take) {
        const id = it.task_id || it.candidate_id;
        if (id) done[phase].push(id);
      }
      saveDone(done);
      processed += take.length;
      log(`${phase}: +${produced.length} rows (checkpoint ${readLines(checkpoint).length} total)`);
      if (produced.length < take.length) {
        log(`${phase}: warning: ${take.length - produced.length} input rows had no output; they stay pending for the next batch`);
        for (const it of take.slice(produced.length)) {
          const id = it.task_id || it.candidate_id;
          if (id) done[phase] = done[phase].filter((x) => x !== id);
        }
        saveDone(done);
      }
    }
  }
  log(`run finished: ${processed} rows processed this session`);
}

main().catch((err) => {
  console.error(String(err && err.message ? err.message : err));
  process.exit(1);
});
