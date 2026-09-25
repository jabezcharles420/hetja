// Fold the agent's JSON Lines into one reviewable CSV for Hetja's monthly
// care import, and audit every decision.
//
//   node packages/db/scripts/care/merge.mjs            # build the CSV + report
//   node packages/db/scripts/care/merge.mjs --check     # validate a built CSV
//
// Deterministic: the model never writes the CSV, only .work/*.jsonl. This
// script owns the CSV write, so a bad model output can spoil at most one line.
//
// Outputs (tracked, under packages/db/data/care/):
//   <YYYY-MM>-mumbai.csv            the monthly import file
//   <YYYY-MM>-mumbai.report.csv     every provider and every decision
//   <YYYY-MM>-mumbai.needs-cost.csv rows waiting on a sourced cost tier
//   <YYYY-MM>-mumbai.rejected.json  every dropped row and why
//
// The final authority on ward, geometry, kind and phone is still
// `pnpm --filter @hetja/db import:care`. Run it with --dry-run first.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BMC_WARD_CODES,
  csvRow,
  inMumbai,
  kmBetween,
  nameGate,
  normalizeName,
  notesLookForeign,
  normaliseWard,
  parseCsv,
  phoneDigits,
  phoneUsable,
  slug,
} from "./gates.mjs";

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
const MONTH = new Date().toISOString().slice(0, 7);
const OUT = path.join(CARE, `${MONTH}-mumbai.csv`);
const REPORT = path.join(CARE, `${MONTH}-mumbai.report.csv`);
const NEEDS_COST = path.join(CARE, `${MONTH}-mumbai.needs-cost.csv`);
const REJECTED = path.join(CARE, `${MONTH}-mumbai.rejected.json`);

const KINDS = ["ngo", "govt", "charity_hospital", "private_clinic"];
const COST = ["free", "subsidised", "paid"];

const COLUMNS = [
  "source_id", "name", "kind", "cost_tier", "address", "locality", "ward", "lat", "lng",
  "phone", "alt_phone", "ambulance", "is_24x7", "hours", "handles_wildlife",
  "confirmed_on", "notes", "source_url", "cost_source", "phone_source",
  "address_source", "hours_source", "method", "confidence", "enriched_at",
];

function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

function kindFromHint(hint) {
  return KINDS.includes(hint) ? hint : "govt";
}

const str = (v) => (v === null || v === undefined ? "" : String(v).trim());
const bool = (v) => v === true || v === "yes" || v === "true" || v === 1;

/** Build one record per provider, enrichment overriding the seed. */
function assemble() {
  const seeds = readJsonl(path.join(WORK, "providers.seed.jsonl"));
  const found = readJsonl(path.join(WORK, "discover.jsonl"));
  const enriched = readJsonl(path.join(WORK, "enrich.jsonl"));
  const enrichById = new Map(enriched.filter((e) => e && e.candidate_id).map((e) => [e.candidate_id, e]));

  const base = new Map();
  for (const it of [...seeds, ...found]) {
    if (!it || !it.candidate_id || !str(it.name)) continue;
    const id = it.candidate_id;
    if (!base.has(id)) {
      base.set(id, {
        candidate_id: id,
        name: str(it.name),
        kind: kindFromHint(str(it.kind_hint)),
        area: str(it.area),
        address: str(it.address),
        website: str(it.website),
        phone: str(it.phone),
        source: str(it.source) || "discovered",
        discover_source_url: str(it.source_url),
      });
    }
  }

  const records = [];
  for (const b of base.values()) {
    const e = enrichById.get(b.candidate_id) || {};
    records.push({
      candidate_id: b.candidate_id,
      name: b.name,
      matched: e.matched !== false,
      kind: KINDS.includes(e.kind) ? e.kind : b.kind,
      cost_tier: COST.includes(e.cost_tier) ? e.cost_tier : "",
      address: str(e.address) || b.address,
      locality: str(e.locality) || b.area,
      ward: str(e.ward),
      lat: Number.isFinite(e.lat) ? e.lat : null,
      lng: Number.isFinite(e.lng) ? e.lng : null,
      phone: str(e.phone) || b.phone,
      alt_phone: str(e.alt_phone),
      hours: str(e.hours),
      ambulance: bool(e.ambulance),
      is_24x7: bool(e.is_24x7),
      handles_wildlife: bool(e.handles_wildlife),
      method: str(e.method) || b.source,
      confidence: str(e.confidence),
      source_url: str(e.source_url) || b.discover_source_url || b.website,
      cost_source: str(e.cost_source),
      phone_source: str(e.phone_source),
      address_source: str(e.address_source),
      hours_source: str(e.hours_source),
      notes: str(e.notes),
      enriched_at: str(e.fetched_at),
      source: b.source,
    });
  }
  return records;
}

function filled(r) {
  let n = 0;
  for (const k of ["address", "locality", "phone", "alt_phone", "hours", "ward", "cost_tier", "source_url"]) if (r[k]) n++;
  if (r.lat !== null) n++;
  if (r.ambulance) n++;
  if (r.is_24x7) n++;
  return n;
}

function preferScore(r) {
  return (r.kind === "govt" ? 40 : 0) + (r.kind === "charity_hospital" ? 10 : 0) + (r.phone ? 20 : 0) + (r.cost_tier ? 15 : 0) + filled(r);
}

/** Merge b into a, filling only gaps. */
function absorb(a, b) {
  for (const k of ["cost_tier", "address", "locality", "ward", "phone", "alt_phone", "hours", "source_url", "cost_source", "phone_source", "address_source", "hours_source", "confidence", "enriched_at", "notes"]) {
    if (!a[k] && b[k]) a[k] = b[k];
  }
  if (a.lat === null && b.lat !== null) { a.lat = b.lat; a.lng = b.lng; }
  a.ambulance = a.ambulance || b.ambulance;
  a.is_24x7 = a.is_24x7 || b.is_24x7;
  a.handles_wildlife = a.handles_wildlife || b.handles_wildlife;
  return a;
}

function gate(records) {
  const kept = [];
  const rejected = [];
  const needsCost = [];
  const seenName = new Map();
  const seenPhone = new Map();

  for (let r of records) {
    const ng = nameGate(r.name);
    if (!ng.ok) { rejected.push({ name: r.name, candidate_id: r.candidate_id, reason: `name:${ng.reason}` }); continue; }
    if (!r.matched) { rejected.push({ name: r.name, candidate_id: r.candidate_id, reason: "not-matched" }); continue; }
    if (notesLookForeign(r.notes)) { rejected.push({ name: r.name, candidate_id: r.candidate_id, reason: "foreign-notes" }); continue; }
    if (r.lat !== null && !inMumbai(r.lat, r.lng)) {
      rejected.push({ name: r.name, candidate_id: r.candidate_id, reason: "out-of-mumbai", source_url: r.source_url });
      continue;
    }
    if (r.kind === "private_clinic" && r.cost_tier !== "free") {
      rejected.push({ name: r.name, candidate_id: r.candidate_id, reason: "paid-private-clinic" });
      continue;
    }
    if (r.phone && !phoneUsable(r.phone)) {
      rejected.push({ name: r.name, candidate_id: r.candidate_id, reason: "phone-unusable", source_url: r.phone_source });
      continue;
    }
    if (!r.phone && r.kind !== "govt" && !r.ambulance) {
      rejected.push({ name: r.name, candidate_id: r.candidate_id, reason: "no-phone-not-govt" });
      continue;
    }

    // De-duplicate by name.
    const nk = normalizeName(r.name);
    if (seenName.has(nk)) {
      const prev = seenName.get(nk);
      if (preferScore(r) > preferScore(prev)) absorb(r, prev);
      else absorb(prev, r);
      rejected.push({ name: r.name, candidate_id: r.candidate_id, reason: "duplicate-name" });
      continue;
    }
    seenName.set(nk, r);

    // De-duplicate by name and phone.
    if (r.phone) {
      const pk = `${nk}|${phoneDigits(r.phone)}`;
      if (seenPhone.has(pk)) { rejected.push({ name: r.name, candidate_id: r.candidate_id, reason: "duplicate-phone" }); continue; }
      seenPhone.set(pk, r);
    }
    kept.push(r);
  }

  // De-duplicate by proximity: same kind, real points, under 30 m, other name.
  const final = [];
  for (const r of kept) {
    const clash = final.find(
      (o) => o.kind === r.kind && o.lat !== null && r.lat !== null && normalizeName(o.name) !== normalizeName(r.name) &&
        kmBetween({ lat: o.lat, lng: o.lng }, { lat: r.lat, lng: r.lng }) * 1000 <= 30,
    );
    if (clash) {
      if (preferScore(r) > preferScore(clash)) {
        absorb(r, clash);
        final.splice(final.indexOf(clash), 1, r);
      } else absorb(clash, r);
      rejected.push({ name: r.name, candidate_id: r.candidate_id, reason: "near-duplicate" });
      continue;
    }
    if (!r.cost_tier) { needsCost.push(r); continue; }
    final.push(r);
  }
  return { kept: final, rejected, needsCost };
}

function assignIds(records) {
  const used = new Set();
  for (const r of records) {
    let id = `m-${slug(r.name)}`.slice(0, 63).replace(/-+$/, "");
    if (!id || id === "m-") id = `m-${r.candidate_id}`.slice(0, 63);
    let candidate = id;
    let n = 2;
    while (used.has(candidate)) candidate = `${id.slice(0, 60)}-${n++}`;
    used.add(candidate);
    r.source_id = candidate;
  }
  return records;
}

function toRow(r) {
  return {
    source_id: r.source_id,
    name: r.name,
    kind: r.kind,
    cost_tier: r.cost_tier,
    address: r.address,
    locality: r.locality,
    ward: normaliseWard(r.ward) || "",
    lat: r.lat === null ? "" : r.lat,
    lng: r.lng === null ? "" : r.lng,
    phone: r.phone,
    alt_phone: r.alt_phone,
    ambulance: r.ambulance ? "yes" : "no",
    is_24x7: r.is_24x7 ? "yes" : "no",
    hours: r.hours,
    handles_wildlife: r.handles_wildlife ? "yes" : "no",
    confirmed_on: "",
    notes: r.notes,
    source_url: r.source_url,
    cost_source: r.cost_source,
    phone_source: r.phone_source,
    address_source: r.address_source,
    hours_source: r.hours_source,
    method: r.method,
    confidence: r.confidence,
    enriched_at: r.enriched_at,
  };
}

function writeCsv(file, rows, columns) {
  writeFileSync(file, [columns.join(",")].concat(rows.map((r) => csvRow(columns.map((c) => r[c])))).join("\n") + "\n");
}

function build() {
  mkdirSync(CARE, { recursive: true });
  const records = assemble();
  const { kept, rejected, needsCost } = gate(records);
  assignIds(kept);
  assignIds(needsCost);

  const rows = kept.map(toRow);
  writeCsv(OUT, rows, COLUMNS);

  const report = [
    ...kept.map((r) => toRow(r)),
    ...rejected.map((r) => ({ source_id: "", name: r.name, kind: "", cost_tier: "", address: "", locality: "", ward: "", lat: "", lng: "", phone: "", alt_phone: "", ambulance: "", is_24x7: "", hours: "", handles_wildlife: "", confirmed_on: "", notes: `REJECTED: ${r.reason}`, source_url: r.source_url || "", cost_source: "", phone_source: "", address_source: "", hours_source: "", method: "", confidence: "", enriched_at: "" })),
  ];
  writeCsv(REPORT, report, COLUMNS);
  writeCsv(NEEDS_COST, needsCost.map(toRow), COLUMNS);
  writeFileSync(REJECTED, JSON.stringify(rejected, null, 2) + "\n");

  const byKind = {};
  for (const r of kept) byKind[r.kind] = (byKind[r.kind] || 0) + 1;
  const withPhone = kept.filter((r) => r.phone).length;
  const exact = kept.filter((r) => r.lat !== null).length;

  console.log(`built ${path.relative(ROOT, OUT)}`);
  console.log(`  candidates   ${records.length}`);
  console.log(`  kept         ${kept.length}  (${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(", ") || "none"})`);
  console.log(`  with phone   ${withPhone}`);
  console.log(`  with point   ${exact}`);
  console.log(`  needs cost   ${needsCost.length}  (${path.relative(ROOT, NEEDS_COST)})`);
  console.log(`  rejected     ${rejected.length}  (${path.relative(ROOT, REJECTED)})`);
  console.log(`  report       ${path.relative(ROOT, REPORT)}`);
  if (!kept.length) {
    console.log("nothing to import. Add agents and batches, or check .work/enrich.jsonl.");
  }
}

function check(file) {
  const target = file || OUT;
  if (!existsSync(target)) { console.error(`missing ${target}`); process.exit(1); }
  const rows = parseCsv(readFileSync(target, "utf8"));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (r, n) => { const i = header.indexOf(n); return i >= 0 ? (r[i] ?? "").trim() : ""; };
  const errors = [];
  for (const required of ["source_id", "name", "kind", "cost_tier"]) {
    if (!header.includes(required)) errors.push(`missing column "${required}"`);
  }
  const ids = new Set();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const id = col(r, "source_id");
    if (!id) errors.push(`line ${line}: empty source_id`);
    else if (ids.has(id)) errors.push(`line ${line}: repeated source_id ${id}`);
    ids.add(id);
    const kind = col(r, "kind");
    if (!KINDS.includes(kind)) errors.push(`line ${line}: kind "${kind}" not in ${KINDS.join(", ")}`);
    const tier = col(r, "cost_tier");
    if (!COST.includes(tier)) errors.push(`line ${line}: cost_tier "${tier}" not in ${COST.join(", ")} (must be sourced, never guessed)`);
    const ward = col(r, "ward");
    if (ward && !BMC_WARD_CODES.includes(ward)) errors.push(`line ${line}: ward "${ward}" is not a BMC code`);
    const lat = col(r, "lat");
    const lng = col(r, "lng");
    if ((lat === "") !== (lng === "")) errors.push(`line ${line}: lat and lng must both be set or both empty`);
    if (lat && lng && !inMumbai(Number(lat), Number(lng))) errors.push(`line ${line}: ${lat},${lng} is outside Mumbai`);
    if (!col(r, "phone") && kind !== "govt" && col(r, "ambulance").toLowerCase() !== "yes") {
      errors.push(`line ${line}: no phone, no ambulance, not govt`);
    }
  });
  if (errors.length) {
    for (const e of errors) console.error(`  ERROR ${e}`);
    console.error(`${errors.length} error(s) in ${target}`);
    process.exit(1);
  }
  console.log(`${target}: ${rows.length - 1} rows, ${ids.size} ids, no errors`);
}

const checkFlag = process.argv.indexOf("--check");
if (checkFlag >= 0) {
  const fileArg = process.argv[checkFlag + 1] && !process.argv[checkFlag + 1].startsWith("--") ? process.argv[checkFlag + 1] : "";
  check(fileArg ? path.resolve(fileArg) : OUT);
} else {
  build();
}
