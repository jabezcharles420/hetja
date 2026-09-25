// Build the work queue for the Hetja care-directory agent.
//
//   node packages/db/scripts/care/queue.mjs [--reset]
//
// Two outputs under packages/db/data/care/.work/:
//
//   discover-tasks.jsonl  one discovery task per line (gov portals, ward
//                         searches, web searches, Overpass queries)
//   providers.seed.jsonl  candidate providers taken from the existing
//                         packages/db/data/dogs_mumbai.csv, pre-pruned so the
//                         agent does not spend a night enriching junk
//
// It changes nothing outside .work/ and never touches the database.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BMC_WARD_CODES,
  BMC_WARD_NAMES,
  MUMBAI_BOUNDS,
  parseCsv,
  nameGate,
  notesLookForeign,
  slug,
} from "./gates.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function repoRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        if (JSON.parse(readFileSync(pkg, "utf8")).name === "hetja") return dir;
      } catch {
        /* keep walking */
      }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error("could not find the hetja repo root above " + start);
}

const ROOT = repoRoot(HERE);
const DATA = path.join(ROOT, "packages", "db", "data");
const CSV_IN = path.join(DATA, "dogs_mumbai.csv");
const WORK = path.join(DATA, "care", ".work");
const BBOX = `${MUMBAI_BOUNDS.south},${MUMBAI_BOUNDS.west},${MUMBAI_BOUNDS.north},${MUMBAI_BOUNDS.east}`;

const reset = process.argv.includes("--reset");

function overpass(body) {
  return `[out:json][timeout:120];${body};out center tags;`;
}

/** Every discovery task. `phase` is what the driver batches on. */
function discoverTasks() {
  const tasks = [];

  // 1. Government records: the BMC Veterinary Health Department, the BMC
  //    health portal, and the Maharashtra animal-husbandry pages. Public
  //    record, and the authoritative source for the government network.
  const portals = [
    ["https://vhd.mcgm.gov.in/", "BMC VHD home"],
    ["https://vhd.mcgm.gov.in/about", "BMC VHD about"],
    ["https://vhd.mcgm.gov.in/important-links", "BMC VHD important links"],
    ["https://vhd.mcgm.gov.in/announcement", "BMC VHD announcements"],
    ["https://vhd.mcgm.gov.in/resource", "BMC VHD resources"],
    ["https://bmchealth.in/en/health-facilites", "BMC health facilities"],
    ["https://www.mcgm.gov.in/", "MCGM home"],
  ];
  for (const [url, label] of portals) {
    tasks.push({ task_id: `gov-${slug(label)}`, phase: "discover", type: "gov-portal", url, label });
  }

  // 2. A web search for the ward-wise municipal facility lists (the PDFs the
  //    BMC publishes per ward), which are the complete government list.
  const govSearches = [
    "MCGM MUNICIPAL HEALTH FACILITIES ward list veterinary PDF",
    "BMC veterinary dispensary animal birth control centre list Mumbai ward",
    "Maharashtra animal husbandry veterinary dispensary Mumbai list",
    "BMC animal hospital Deonar Bai Sakarbai Dinshaw Petit list",
    "Mumbai municipal dog sterilisation centre ABC list ward",
  ];
  for (const query of govSearches) {
    tasks.push({ task_id: `govsrch-${slug(query)}`, phase: "discover", type: "web-search", query, label: query });
  }

  // 3. One ward search per BMC ward, so nothing local is missed.
  const wardTerms = "animal welfare veterinary stray dog animal birth control NGO shelter";
  for (const code of BMC_WARD_CODES) {
    const name = BMC_WARD_NAMES[code];
    tasks.push({
      task_id: `ward-${slug(code)}`,
      phase: "discover",
      type: "ward-search",
      ward: code,
      name,
      query: `${name} Mumbai ${wardTerms}`,
    });
  }

  // 4. OpenStreetMap, storable under ODbL, with attribution.
  tasks.push({
    task_id: "osm-veterinary",
    phase: "discover",
    type: "overpass",
    label: "OSM veterinary in Mumbai",
    query: overpass(`node["amenity"="veterinary"](${BBOX});way["amenity"="veterinary"](${BBOX})`),
  });
  tasks.push({
    task_id: "osm-healthcare-veterinary",
    phase: "discover",
    type: "overpass",
    label: "OSM healthcare=veterinary in Mumbai",
    query: overpass(`node["healthcare"="veterinary"](${BBOX});way["healthcare"="veterinary"](${BBOX})`),
  });
  tasks.push({
    task_id: "osm-animal-shelter",
    phase: "discover",
    type: "overpass",
    label: "OSM animal shelters in Mumbai",
    query: overpass(`node["amenity"="animal_shelter"](${BBOX});way["amenity"="animal_shelter"](${BBOX})`),
  });

  return tasks;
}

/** Existing rows, pre-pruned, as enrichment candidates. */
function seedProviders() {
  if (!existsSync(CSV_IN)) throw new Error(`missing ${CSV_IN}`);
  const rows = parseCsv(readFileSync(CSV_IN, "utf8"));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (r, n) => {
    const i = header.indexOf(n);
    return i >= 0 ? (r[i] ?? "").trim() : "";
  };
  const out = [];
  const seen = new Set();
  for (const r of rows.slice(1)) {
    const name = col(r, "name").replace(/\s+/g, " ");
    const gate = nameGate(name);
    if (!gate.ok) continue;
    if (notesLookForeign(col(r, "notes"))) continue;
    const id = slug(name);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      phase: "enrich",
      candidate_id: id,
      name,
      kind_hint:
        col(r, "category") === "ngo" || col(r, "category") === "charity_clinic"
          ? col(r, "category") === "charity_clinic"
            ? "charity_hospital"
            : "ngo"
          : "govt",
      area: col(r, "area"),
      address: col(r, "address"),
      website: col(r, "website"),
      phone: col(r, "phone"),
      source: "dogs_mumbai.csv",
      source_url: col(r, "website"),
    });
  }
  return out;
}

function writeJsonl(file, rows) {
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

function main() {
  mkdirSync(WORK, { recursive: true });
  if (reset) {
    for (const f of ["done.json", "discover.jsonl", "enrich.jsonl", "run.log"]) {
      const p = path.join(WORK, f);
      if (existsSync(p)) rmSync(p);
    }
    const b = path.join(WORK, "batches");
    if (existsSync(b)) rmSync(b, { recursive: true, force: true });
  }

  const tasks = discoverTasks();
  const seeds = seedProviders();
  writeJsonl(path.join(WORK, "discover-tasks.jsonl"), tasks);
  writeJsonl(path.join(WORK, "providers.seed.jsonl"), seeds);

  console.log(`work dir      ${path.relative(ROOT, WORK)}`);
  console.log(`discover tasks ${tasks.length} (${tasks.filter((t) => t.type === "ward-search").length} ward searches)`);
  console.log(`seed providers ${seeds.length} (of ${parseCsv(readFileSync(CSV_IN, "utf8")).length - 1} rows in dogs_mumbai.csv)`);
  console.log("next: node packages/db/scripts/care/run-batch.mjs");
}

main();
