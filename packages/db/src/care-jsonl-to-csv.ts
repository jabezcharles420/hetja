/**
 * The owner's care-agent pipeline (packages/db/scripts/care/*, not ours)
 * writes verified providers as JSON lines. This turns one such file into the
 * monthly import's CSV (packages/db/data/care/TEMPLATE.csv columns), which
 * import-care.ts then dry-runs and applies as usual:
 *
 *   pnpm --filter @hetja/db care:jsonl-to-csv -- --in data/care/verified-2026-09-26.jsonl --out data/care/2026-09-26.csv
 *
 * THE RULES, each from the owner or the lead (2026-09-26):
 *   - source_id is the pipeline's candidate_id, so a later file updates the
 *     same rows instead of duplicating them.
 *   - confirmed_on is EMPTY for every row. These were checked against
 *     official web sources by an automated pipeline, not confirmed by phone by
 *     a person, and confirmed_on is what marks a number confirmed. They show
 *     as "Number not confirmed yet".
 *   - cost_tier is copied when the pipeline found one and left EMPTY when it
 *     did not (unknown, migration 0030): never guessed. Government rows are
 *     free by the owner's decision, so a govt row with no tier is written as
 *     free.
 *   - is_government is yes exactly for kind govt; is_person is no (these are
 *     places and helplines, not individual vets).
 *   - notes is one line, "Checked against <source_url>", plus the pipeline's
 *     confidence when it was not high. Every row is kept, low confidence too.
 *   - A row with no ward gets one only when the locality or address names
 *     exactly one ward; when it names several ("Kandivali / Borivali /
 *     Dahisar") those go in the wards column and ward stays empty.
 *   - No em dash reaches the file (repository rule): any is replaced by a comma.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BMC_WARD_NAMES } from "@hetja/contracts";

export interface PipelineRow {
  candidate_id: string;
  name: string;
  kind: string;
  cost_tier?: string | null;
  phone?: string | null;
  alt_phone?: string | null;
  address?: string | null;
  locality?: string | null;
  ward?: string | null;
  lat?: number | null;
  lng?: number | null;
  hours?: string | null;
  is_24x7?: boolean | null;
  ambulance?: boolean | null;
  handles_wildlife?: boolean | null;
  source_url?: string | null;
  confidence?: string | null;
}

export const CSV_COLUMNS = [
  "source_id", "name", "kind", "cost_tier", "address", "locality", "ward", "lat", "lng", "phone", "alt_phone",
  "ambulance", "is_24x7", "hours", "handles_wildlife", "confirmed_on", "notes", "is_person", "is_government",
  "reg_no", "wards",
] as const;

const EM_DASH = String.fromCharCode(0x2014);

function clean(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .split(EM_DASH)
    .join(", ")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,(\s*,)+/g, ",")
    .trim();
}

function yn(v: unknown): string {
  return v === true ? "yes" : "no";
}

/** "K-West" -> "K/W"; "A" -> "A". */
function slashCode(ward: string): string {
  const [letter, half] = ward.split("-");
  return half ? `${letter}/${half.charAt(0)}` : letter;
}

/** Canonical ward ids whose locality names appear in the text (BMC_WARD_NAMES), in order of appearance. */
export function wardsNamedIn(text: string): string[] {
  const t = text.toLowerCase();
  const hits: { at: number; ward: string }[] = [];
  for (const [ward, names] of Object.entries(BMC_WARD_NAMES)) {
    for (const name of names.split(",").map((n) => n.trim().toLowerCase()).filter(Boolean)) {
      const at = t.indexOf(name);
      if (at >= 0) {
        hits.push({ at, ward });
        break;
      }
    }
  }
  return [...new Set(hits.sort((a, b) => a.at - b.at).map((h) => h.ward))];
}

export function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsvRow(r: PipelineRow): Record<(typeof CSV_COLUMNS)[number], string> {
  const kind = clean(r.kind).toLowerCase();
  const gov = kind === "govt";
  const tier = clean(r.cost_tier).toLowerCase();
  let ward = clean(r.ward);
  let wards = "";
  if (!ward) {
    const named = wardsNamedIn(`${clean(r.locality)} ${clean(r.address)}`);
    if (named.length === 1) ward = slashCode(named[0]);
    else if (named.length > 1) wards = named.map(slashCode).join("; ");
  }
  const hasPoint = typeof r.lat === "number" && typeof r.lng === "number";
  const confidence = clean(r.confidence).toLowerCase();
  const source = clean(r.source_url);
  const notes = [source ? `Checked against ${source}` : "Checked by the care-agent pipeline", confidence && confidence !== "high" ? `confidence ${confidence}` : ""]
    .filter(Boolean)
    .join(", ");
  return {
    source_id: clean(r.candidate_id),
    name: clean(r.name),
    kind,
    cost_tier: tier || (gov ? "free" : ""),
    address: clean(r.address),
    locality: clean(r.locality),
    ward,
    lat: hasPoint ? String(r.lat) : "",
    lng: hasPoint ? String(r.lng) : "",
    phone: clean(r.phone),
    alt_phone: clean(r.alt_phone),
    ambulance: yn(r.ambulance),
    is_24x7: yn(r.is_24x7),
    hours: clean(r.hours),
    handles_wildlife: yn(r.handles_wildlife),
    confirmed_on: "",
    notes,
    is_person: "no",
    is_government: gov ? "yes" : "no",
    reg_no: "",
    wards,
  };
}

export function jsonlToCsv(text: string): { csv: string; rows: number } {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as PipelineRow);
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) {
    const out = toCsvRow(r);
    lines.push(CSV_COLUMNS.map((c) => csvCell(out[c])).join(","));
  }
  return { csv: lines.join("\n") + "\n", rows: rows.length };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop() ?? "")) {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const get = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const input = get("--in");
  const output = get("--out");
  if (!input || !output) {
    console.error("usage: pnpm --filter @hetja/db care:jsonl-to-csv -- --in <file.jsonl> --out <file.csv>");
    process.exit(2);
  }
  const base = process.env.INIT_CWD ?? process.cwd();
  const { csv, rows } = jsonlToCsv(readFileSync(path.resolve(base, input), "utf8"));
  writeFileSync(path.resolve(base, output), csv);
  console.log(`care:jsonl-to-csv: ${rows} row(s) written to ${output}`);
}
