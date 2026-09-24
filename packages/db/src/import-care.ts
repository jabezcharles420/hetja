/**
 * Hetja monthly care-directory refresh (docs/VET-DATA-INTAKE.md, "Monthly update").
 *
 *   pnpm --filter @hetja/db import:care -- --file <csv> --source <name> [--apply]
 *
 * Each month the maintainer sends one CSV per source in the intake format
 * (packages/db/data/care/TEMPLATE.csv), holding details CONFIRMED WITH THE
 * PROVIDER ITSELF. This script makes the database match that file, for that
 * source only:
 *
 *   add      a source_id the database has never seen for this source
 *   update   a known source_id whose fields changed (only changed columns
 *            are written; the diff is printed column by column)
 *   relist   a known source_id that had been retired and is back in the file
 *   retire   a listed row of this source whose source_id is missing from the
 *            file: `listed = FALSE`. NEVER a DELETE. A retired row keeps its
 *            history and comes back by reappearing in a later file.
 *   conflict a new row whose (name, phone) already belongs to another source's
 *            row (the care_providers_name_phone_uq index). Skipped and
 *            reported; pass --claim to move that row under this source.
 *
 * DRY-RUN BY DEFAULT. Without --apply it reads the database, prints the plan
 * and exits without writing. With --apply the whole plan runs in ONE
 * transaction, so a failure part-way leaves the directory as it was.
 *
 * Refusals, all before anything is written:
 *   - any row with an error (missing source_id/name, unknown kind, a guessed
 *     cost tier, a bad ward, a point outside Mumbai, a duplicate source_id):
 *     an errored row would otherwise look "missing" and retire a good record;
 *   - retiring more than a quarter of the source's listed rows (and more than
 *     3), which is what a truncated or wrong file looks like, unless
 *     --allow-mass-retire;
 *   - the legacy sources ('curated', 'verified-csv-*', 'osm'): those came from
 *     one-off imports, and a monthly file under their name would retire
 *     hundreds of rows nobody meant to touch.
 *
 * Field handling follows import-care-verified.ts, whose helpers it reuses:
 * phones are normalised to E.164 with libphonenumber-js (IN) and an
 * unparseable number becomes NULL with a warning; lat/lng inside Mumbai make a
 * row `exact`; otherwise the address is looked up in data/geocode-cache.json
 * (and geocoded with Photon when GEOCODE=1 or --geocode, 12 km sanity bound
 * from the locality); anything unresolved falls back to its locality centroid
 * as `locality` precision. phone_verified_at is set to `confirmed_on` when the
 * row has a phone: that column means "a human confirmed this number with the
 * provider", which is what the monthly file certifies.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pool } from "./pool.js";
import {
  GEOCODE_CACHE,
  LOCALITY_CENTROIDS,
  geocodeAddress,
  kmBetween,
  normalizeIndianPhone,
} from "./import-care-verified.js";

export const CARE_KINDS = ["ngo", "govt", "charity_hospital", "private_clinic"] as const;
export const COST_TIERS = ["free", "subsidised", "paid"] as const;
type CareKind = (typeof CARE_KINDS)[number];
type CostTier = (typeof COST_TIERS)[number];

/**
 * The 24 BMC ward codes as dogs.ward_id stores them. Duplicated from
 * @hetja/contracts (BMC_WARD_CODES) because @hetja/db does not depend on it;
 * import-care.test.ts fails if the two lists ever drift.
 */
export const WARD_CODES = [
  "A", "B", "C", "D", "E", "F-North", "F-South", "G-North", "G-South", "H-East", "H-West",
  "K-East", "K-West", "L", "M-East", "M-West", "N", "P-North", "P-South", "R-Central",
  "R-North", "R-South", "S", "T",
] as const;

/** Greater Mumbai plus a margin; a point outside is a typo (swapped lat/lng, a Pune address). */
const MUMBAI_BOUNDS = { minLat: 18.85, maxLat: 19.35, minLng: 72.75, maxLng: 73.2 };

const LEGACY_SOURCE_RE = /^(curated|osm|verified-csv-.*)$/;
const SOURCE_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const MASS_RETIRE_SHARE = 0.25;
const MASS_RETIRE_MIN = 3;

/** "K/W", "K-West", "k west", "KW" -> "K-West"; "A" -> "A"; anything else null. */
export function normaliseWard(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const exact = WARD_CODES.find((c) => c.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const m = raw.toUpperCase().replace(/\s+/g, "").match(/^([A-Z])[/\-]?(N|S|E|W|C|NORTH|SOUTH|EAST|WEST|CENTRAL)$/);
  if (!m) return null;
  const half = { N: "North", S: "South", E: "East", W: "West", C: "Central" }[m[2].charAt(0) as "N"];
  const code = `${m[1]}-${half}`;
  return (WARD_CODES as readonly string[]).includes(code) ? code : null;
}

/** RFC 4180-ish: quoted fields may hold commas, doubled quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

export interface CareRecord {
  sourceRef: string;
  name: string;
  kind: CareKind;
  costTier: CostTier;
  phone: string | null;
  altPhone: string | null;
  hasAmbulance: boolean;
  is24x7: boolean;
  hoursNote: string | null;
  handlesWildlife: boolean;
  wardId: string | null;
  locality: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  confirmedOn: string | null;
}

export interface RowIssue {
  line: number;
  sourceRef: string;
  message: string;
}

function bool(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (s === "" || s === "no" || s === "n" || s === "false" || s === "0") return false;
  if (s === "yes" || s === "y" || s === "true" || s === "1") return true;
  return null;
}

/**
 * Header row + data rows -> validated records. Column names are matched
 * case-insensitively; unknown columns are ignored (notes, evidence ...).
 */
export function readRecords(rows: string[][]): {
  records: CareRecord[];
  errors: RowIssue[];
  warnings: RowIssue[];
} {
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const records: CareRecord[] = [];
  if (rows.length === 0) {
    errors.push({ line: 1, sourceRef: "", message: "empty file" });
    return { records, errors, warnings };
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  for (const required of ["source_id", "name", "kind", "cost_tier"]) {
    if (!header.includes(required)) errors.push({ line: 1, sourceRef: "", message: `missing column "${required}"` });
  }
  if (errors.length) return { records, errors, warnings };
  const col = (r: string[], name: string) => {
    const i = header.indexOf(name);
    return i >= 0 ? (r[i] ?? "").trim() : "";
  };

  const seen = new Map<string, number>();
  rows.slice(1).forEach((r, idx) => {
    const line = idx + 2;
    const sourceRef = col(r, "source_id");
    const err = (message: string) => errors.push({ line, sourceRef, message });
    const warn = (message: string) => warnings.push({ line, sourceRef, message });

    if (!sourceRef) return err("source_id is empty (it is the stable id that makes next month's file an update)");
    if (seen.has(sourceRef)) return err(`source_id repeats line ${seen.get(sourceRef)}`);
    seen.set(sourceRef, line);

    const name = col(r, "name").replace(/\s+/g, " ");
    if (!name) return err("name is empty");
    if (name.includes(String.fromCharCode(0x2014))) warn("name contains an em dash");

    const kind = col(r, "kind").toLowerCase() as CareKind;
    if (!CARE_KINDS.includes(kind)) return err(`kind "${col(r, "kind")}" is not one of ${CARE_KINDS.join(", ")}`);
    const costTier = col(r, "cost_tier").toLowerCase() as CostTier;
    if (!COST_TIERS.includes(costTier)) {
      return err(`cost_tier "${col(r, "cost_tier")}" is not one of ${COST_TIERS.join(", ")} (it must be confirmed, not guessed)`);
    }

    const flags: Record<string, boolean> = {};
    for (const f of ["ambulance", "is_24x7", "handles_wildlife"]) {
      const b = bool(col(r, f));
      if (b === null) return err(`${f} "${col(r, f)}" is not yes/no`);
      flags[f] = b;
    }

    const phoneRaw = col(r, "phone");
    const phone = phoneRaw ? normalizeIndianPhone(phoneRaw) : null;
    if (phoneRaw && !phone) warn(`phone "${phoneRaw}" is not a valid Indian number; stored as none`);
    const altRaw = col(r, "alt_phone");
    const altPhone = altRaw ? normalizeIndianPhone(altRaw) : null;
    if (altRaw && !altPhone) warn(`alt_phone "${altRaw}" is not a valid Indian number; stored as none`);
    if (!phone && !flags.ambulance) warn("no usable phone and no ambulance: close to useless in an emergency");

    const wardRaw = col(r, "ward");
    const wardId = wardRaw ? normaliseWard(wardRaw) : null;
    if (wardRaw && !wardId) return err(`ward "${wardRaw}" is not a BMC ward code (A, K/W, K-West, ...)`);

    const latRaw = col(r, "lat");
    const lngRaw = col(r, "lng");
    let lat: number | null = null;
    let lng: number | null = null;
    if (latRaw || lngRaw) {
      lat = Number(latRaw);
      lng = Number(lngRaw);
      if (!latRaw || !lngRaw || !Number.isFinite(lat) || !Number.isFinite(lng)) return err("lat and lng must both be numbers");
      if (lat < MUMBAI_BOUNDS.minLat || lat > MUMBAI_BOUNDS.maxLat || lng < MUMBAI_BOUNDS.minLng || lng > MUMBAI_BOUNDS.maxLng) {
        return err(`lat/lng ${lat},${lng} is outside Mumbai (swapped, or the wrong place?)`);
      }
    }

    const confirmedOn = col(r, "confirmed_on");
    if (confirmedOn && !/^\d{4}-\d{2}-\d{2}$/.test(confirmedOn)) return err(`confirmed_on "${confirmedOn}" is not YYYY-MM-DD`);
    if (!confirmedOn) warn("confirmed_on is empty: the number will be shown as unconfirmed");

    records.push({
      sourceRef,
      name,
      kind,
      costTier,
      phone,
      altPhone,
      hasAmbulance: flags.ambulance,
      is24x7: flags.is_24x7,
      hoursNote: col(r, "hours") || null,
      handlesWildlife: flags.handles_wildlife,
      wardId,
      locality: col(r, "locality") || null,
      address: col(r, "address") || null,
      lat,
      lng,
      confirmedOn: confirmedOn || null,
    });
  });
  return { records, errors, warnings };
}

/** What a record becomes in care_providers, after geocoding. */
export interface ResolvedRecord extends CareRecord {
  geoLat: number;
  geoLng: number;
  geoPrecision: "exact" | "locality";
}

/** The columns this script owns, as they compare against a stored row. */
export interface StoredRow {
  id: string;
  source_ref: string | null;
  name: string;
  kind: string;
  cost_tier: string;
  phone_e164: string | null;
  alt_phone_e164: string | null;
  has_ambulance: boolean;
  is_24x7: boolean;
  hours_note: string | null;
  handles_wildlife: boolean;
  ward_id: string | null;
  locality: string | null;
  geo_precision: string;
  lat: number;
  lng: number;
  phone_verified_on: string | null;
  listed: boolean;
}

export function columnsOf(r: ResolvedRecord): Omit<StoredRow, "id" | "source_ref" | "listed"> {
  return {
    name: r.name,
    kind: r.kind,
    cost_tier: r.costTier,
    phone_e164: r.phone,
    alt_phone_e164: r.altPhone,
    has_ambulance: r.hasAmbulance,
    is_24x7: r.is24x7,
    hours_note: r.hoursNote,
    handles_wildlife: r.handlesWildlife,
    ward_id: r.wardId,
    locality: r.locality,
    geo_precision: r.geoPrecision,
    lat: r.geoLat,
    lng: r.geoLng,
    phone_verified_on: r.phone ? r.confirmedOn : null,
  };
}

export interface Change {
  column: string;
  from: unknown;
  to: unknown;
}

/** Column-by-column difference; a point moving less than ~1 m is not a change. */
export function diff(stored: StoredRow, next: ReturnType<typeof columnsOf>): Change[] {
  const out: Change[] = [];
  for (const [column, to] of Object.entries(next)) {
    const from = stored[column as keyof StoredRow];
    if (column === "lat" || column === "lng") {
      if (Math.abs(Number(from) - Number(to)) > 1e-5) out.push({ column, from, to });
    } else if ((from ?? null) !== (to ?? null)) {
      out.push({ column, from, to });
    }
  }
  return out;
}

export interface Plan {
  adds: ResolvedRecord[];
  updates: Array<{ id: string; record: ResolvedRecord; changes: Change[]; relist: boolean }>;
  unchanged: number;
  retires: StoredRow[];
  conflicts: Array<{ record: ResolvedRecord; otherId: string; otherSource: string }>;
}

/**
 * Pure planning step: this source's stored rows + the file -> what to do.
 * `taken` maps "name|phone" to a row of ANOTHER source holding that unique key.
 */
export function plan(
  stored: StoredRow[],
  records: ResolvedRecord[],
  taken: Map<string, { id: string; source: string }>,
): Plan {
  const byRef = new Map(stored.filter((s) => s.source_ref).map((s) => [s.source_ref as string, s]));
  const inFile = new Set(records.map((r) => r.sourceRef));
  const out: Plan = { adds: [], updates: [], unchanged: 0, retires: [], conflicts: [] };
  for (const record of records) {
    const existing = byRef.get(record.sourceRef);
    if (existing) {
      const changes = diff(existing, columnsOf(record));
      const relist = !existing.listed;
      if (changes.length || relist) out.updates.push({ id: existing.id, record, changes, relist });
      else out.unchanged++;
      continue;
    }
    const other = taken.get(uniqueKey(record.name, record.phone));
    if (other) out.conflicts.push({ record, otherId: other.id, otherSource: other.source });
    else out.adds.push(record);
  }
  out.retires = stored.filter((s) => s.listed && s.source_ref && !inFile.has(s.source_ref));
  return out;
}

export function uniqueKey(name: string, phone: string | null): string {
  return `${name}|${phone ?? ""}`;
}

/** Within-file (name, phone) clashes: the unique index would reject the second. */
export function duplicateKeys(records: CareRecord[]): RowIssue[] {
  const seen = new Map<string, string>();
  const out: RowIssue[] = [];
  for (const r of records) {
    const key = uniqueKey(r.name, r.phone);
    const first = seen.get(key);
    if (first) out.push({ line: 0, sourceRef: r.sourceRef, message: `same name and phone as source_id ${first}` });
    else seen.set(key, r.sourceRef);
  }
  return out;
}

export function tooManyRetires(listedCount: number, retires: number): boolean {
  return retires > MASS_RETIRE_MIN && retires > listedCount * MASS_RETIRE_SHARE;
}

interface Args {
  file: string;
  source: string;
  apply: boolean;
  claim: boolean;
  geocode: boolean;
  allowMassRetire: boolean;
}

export function parseArgs(argv: string[]): Args | string {
  const args: Args = { file: "", source: "", apply: false, claim: false, geocode: process.env.GEOCODE === "1", allowMassRetire: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a === "--file") args.file = argv[++i] ?? "";
    else if (a === "--source") args.source = argv[++i] ?? "";
    else if (a === "--apply") args.apply = true;
    else if (a === "--dry-run") args.apply = false;
    else if (a === "--claim") args.claim = true;
    else if (a === "--geocode") args.geocode = true;
    else if (a === "--allow-mass-retire") args.allowMassRetire = true;
    else return `unknown argument ${a}`;
  }
  if (!args.file) return "--file <csv> is required";
  if (!SOURCE_RE.test(args.source)) return "--source must be 3-64 chars of a-z, 0-9 and '-' (e.g. monthly-clinics)";
  if (LEGACY_SOURCE_RE.test(args.source)) return `--source ${args.source} is a legacy one-off import; use a new name for monthly files`;
  return args;
}

async function resolve(records: CareRecord[], geocode: boolean): Promise<{ resolved: ResolvedRecord[]; notes: RowIssue[] }> {
  const cache: Record<string, { lat: number; lng: number }> = existsSync(GEOCODE_CACHE)
    ? JSON.parse(readFileSync(GEOCODE_CACHE, "utf8"))
    : {};
  let dirty = false;
  const notes: RowIssue[] = [];
  const resolved: ResolvedRecord[] = [];
  for (const r of records) {
    const centroid = (r.locality && LOCALITY_CENTROIDS[r.locality]) || LOCALITY_CENTROIDS["Mumbai"];
    if (r.lat !== null && r.lng !== null) {
      resolved.push({ ...r, geoLat: r.lat, geoLng: r.lng, geoPrecision: "exact" });
      continue;
    }
    let pt = r.address ? cache[r.address] : undefined;
    if (!pt && r.address && geocode) {
      const hit = await geocodeAddress(r.address);
      if (hit && kmBetween(hit, centroid) <= 12) {
        pt = hit;
        cache[r.address] = hit;
        dirty = true;
      }
      await new Promise((ok) => setTimeout(ok, 300));
    }
    if (pt) {
      resolved.push({ ...r, geoLat: pt.lat, geoLng: pt.lng, geoPrecision: "exact" });
    } else {
      notes.push({ line: 0, sourceRef: r.sourceRef, message: `no point: ${r.locality ?? "Mumbai"} centroid, locality precision (no map pin)` });
      resolved.push({ ...r, locality: r.locality ?? "Mumbai", geoLat: centroid.lat, geoLng: centroid.lng, geoPrecision: "locality" });
    }
  }
  if (dirty) writeFileSync(GEOCODE_CACHE, JSON.stringify(cache, null, 2) + "\n");
  return { resolved, notes };
}

const STORED_SQL = `
SELECT id, source_ref, name, kind::text AS kind, cost_tier::text AS cost_tier, phone_e164, alt_phone_e164,
       has_ambulance, is_24x7, hours_note, handles_wildlife, ward_id, locality,
       geo_precision::text AS geo_precision, ST_Y(geo::geometry) AS lat, ST_X(geo::geometry) AS lng,
       to_char(phone_verified_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS phone_verified_on, listed
  FROM care_providers WHERE source = $1`;

function values(r: ResolvedRecord): unknown[] {
  const c = columnsOf(r);
  return [
    c.name, c.kind, c.cost_tier, c.phone_e164, c.alt_phone_e164, c.has_ambulance, c.is_24x7, c.hours_note,
    c.handles_wildlife, c.ward_id, c.locality, c.geo_precision, `SRID=4326;POINT(${c.lng} ${c.lat})`,
    c.phone_verified_on,
  ];
}

// $1..$14 as in values(); the confirmed date is Mumbai midnight of that day.
const SET_SQL = `
  name = $1, kind = $2::care_kind, cost_tier = $3::care_cost_tier, phone_e164 = $4, alt_phone_e164 = $5,
  has_ambulance = $6, is_24x7 = $7, hours_note = $8, handles_wildlife = $9, ward_id = $10, locality = $11,
  geo_precision = $12::geo_precision, geo = $13::geography,
  phone_verified_at = CASE WHEN $14::date IS NULL THEN NULL ELSE ($14::date::timestamp AT TIME ZONE 'Asia/Kolkata') END,
  listed = TRUE`;

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(none)";
  if (typeof v === "number") return String(Math.round(v * 1e6) / 1e6);
  return JSON.stringify(v);
}

export async function runImport(args: Args, log: (s: string) => void = console.log): Promise<number> {
  // pnpm --filter runs scripts in packages/db; resolve the path from where pnpm was run.
  const text = readFileSync(path.resolve(process.env.INIT_CWD ?? process.cwd(), args.file), "utf8");
  const { records, errors, warnings } = readRecords(parseCsv(text));
  errors.push(...duplicateKeys(records));

  log(`care import: ${args.apply ? "APPLY" : "DRY RUN"} of ${args.file} as source "${args.source}"`);
  for (const w of warnings) log(`  warn   line ${w.line} [${w.sourceRef}] ${w.message}`);
  if (errors.length) {
    for (const e of errors) log(`  ERROR  ${e.line ? `line ${e.line} ` : ""}[${e.sourceRef}] ${e.message}`);
    log(`${errors.length} error(s): fix the file and run again. Nothing was written.`);
    return 1;
  }

  const { resolved, notes } = await resolve(records, args.geocode);
  for (const n of notes) log(`  note   [${n.sourceRef}] ${n.message}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // One monthly import per source at a time (two maintainers, one workflow run and a laptop).
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('care-import:' || $1))`, [args.source]);
    const stored = (await client.query<StoredRow>(STORED_SQL, [args.source])).rows.map((r) => ({
      ...r,
      lat: Number(r.lat),
      lng: Number(r.lng),
    }));
    const takenRes = await client.query<{ id: string; source: string; name: string; phone_e164: string | null }>(
      `SELECT id, source, name, phone_e164 FROM care_providers
        WHERE source <> $1 AND (name, COALESCE(phone_e164, '')) IN (SELECT * FROM unnest($2::text[], $3::text[]))`,
      [args.source, resolved.map((r) => r.name), resolved.map((r) => r.phone ?? "")],
    );
    const taken = new Map(takenRes.rows.map((r) => [uniqueKey(r.name, r.phone_e164), { id: r.id, source: r.source }]));
    const p = plan(stored, resolved, taken);

    for (const a of p.adds) log(`  add     [${a.sourceRef}] ${a.name} (${a.kind}, ${a.geoPrecision})`);
    for (const u of p.updates) {
      log(`  ${u.relist ? "relist " : "update "} [${u.record.sourceRef}] ${u.record.name}`);
      for (const c of u.changes) log(`            ${c.column}: ${fmt(c.from)} -> ${fmt(c.to)}`);
    }
    for (const r of p.retires) log(`  retire  [${r.source_ref}] ${r.name}`);
    for (const c of p.conflicts) {
      log(`  conflict [${c.record.sourceRef}] ${c.record.name}: same name and phone as a "${c.otherSource}" row (${c.otherId})${args.claim ? ", claiming it" : "; skipped (--claim to take it over)"}`);
    }
    const listedCount = stored.filter((s) => s.listed).length;
    log(
      `summary: ${p.adds.length} to add, ${p.updates.filter((u) => !u.relist).length} to update, ` +
        `${p.updates.filter((u) => u.relist).length} to relist, ${p.retires.length} to retire, ` +
        `${p.unchanged} unchanged, ${p.conflicts.length} conflict(s)`,
    );

    if (tooManyRetires(listedCount, p.retires.length) && !args.allowMassRetire) {
      log(`REFUSED: this would retire ${p.retires.length} of ${listedCount} listed rows. Is the file complete? Re-run with --allow-mass-retire if it is.`);
      await client.query("ROLLBACK");
      return 1;
    }
    if (!args.apply) {
      await client.query("ROLLBACK");
      log("dry run: nothing was written. Re-run with --apply to make these changes.");
      return 0;
    }

    for (const a of p.adds) {
      await client.query(
        `INSERT INTO care_providers
           (name, kind, cost_tier, phone_e164, alt_phone_e164, has_ambulance, is_24x7, hours_note,
            handles_wildlife, ward_id, locality, geo_precision, geo, phone_verified_at, listed, source, source_ref)
         VALUES ($1, $2::care_kind, $3::care_cost_tier, $4, $5, $6, $7, $8, $9, $10, $11, $12::geo_precision,
                 $13::geography,
                 CASE WHEN $14::date IS NULL THEN NULL ELSE ($14::date::timestamp AT TIME ZONE 'Asia/Kolkata') END,
                 TRUE, $15, $16)`,
        [...values(a), args.source, a.sourceRef],
      );
    }
    for (const u of p.updates) {
      await client.query(`UPDATE care_providers SET ${SET_SQL} WHERE id = $15`, [...values(u.record), u.id]);
    }
    if (args.claim) {
      for (const c of p.conflicts) {
        await client.query(`UPDATE care_providers SET ${SET_SQL}, source = $15, source_ref = $16 WHERE id = $17`, [
          ...values(c.record),
          args.source,
          c.record.sourceRef,
          c.otherId,
        ]);
      }
    }
    if (p.retires.length) {
      await client.query(`UPDATE care_providers SET listed = FALSE WHERE id = ANY($1::uuid[])`, [p.retires.map((r) => r.id)]);
    }
    await client.query("COMMIT");
    log("applied.");
    return 0;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop() ?? "")) {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    console.error(`care import: ${args}\n\nusage: pnpm --filter @hetja/db import:care -- --file <csv> --source <name> [--apply] [--claim] [--geocode] [--allow-mass-retire]`);
    process.exit(2);
  }
  runImport(args)
    .then(async (code) => {
      await pool.end();
      process.exit(code);
    })
    .catch(async (err) => {
      console.error("care import failed:", err);
      await pool.end().catch(() => undefined);
      process.exit(1);
    });
}
