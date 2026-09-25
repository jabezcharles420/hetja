/**
 * Monthly care import: the pure parts (parsing, validation, planning).
 * The database half (dry run, apply, idempotent re-apply, retire) is exercised
 * against a disposable PostGIS database; see docs/VET-DATA-INTAKE.md.
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import {
  WARD_CODES,
  columnsOf,
  duplicateKeys,
  nearbySameKindWarnings,
  normaliseWard,
  parseArgs,
  parseCsv,
  plan,
  readRecords,
  sharedPhoneWarnings,
  todayInMumbai,
  tooManyRetires,
  type ResolvedRecord,
  type StoredRow,
} from "./import-care.js";

const HEADER =
  "source_id,name,kind,cost_tier,address,locality,ward,lat,lng,phone,alt_phone,ambulance,is_24x7,hours,handles_wildlife,confirmed_on,notes";

function csv(...lines: string[]): string {
  return [HEADER, ...lines].join("\n");
}

function resolved(over: Partial<ResolvedRecord> = {}): ResolvedRecord {
  return {
    sourceRef: "c-1",
    name: "Test Clinic",
    kind: "private_clinic",
    costTier: "paid",
    phone: "+912226000000",
    altPhone: null,
    hasAmbulance: false,
    is24x7: false,
    hoursNote: "Open till 9 pm",
    handlesWildlife: false,
    wardId: "K-West",
    locality: "Andheri",
    address: null,
    lat: 19.13,
    lng: 72.83,
    confirmedOn: "2026-09-01",
    geoLat: 19.13,
    geoLng: 72.83,
    geoPrecision: "exact",
    ...over,
  };
}

function stored(r: ResolvedRecord, over: Partial<StoredRow> = {}): StoredRow {
  return { id: `id-${r.sourceRef}`, source_ref: r.sourceRef, listed: true, ...columnsOf(r), ...over };
}

describe("normaliseWard", () => {
  it("accepts the canonical, slash and spaced forms", () => {
    expect(normaliseWard("K-West")).toBe("K-West");
    expect(normaliseWard("K/W")).toBe("K-West");
    expect(normaliseWard("k w")).toBe("K-West");
    expect(normaliseWard("R/C")).toBe("R-Central");
    expect(normaliseWard("a")).toBe("A");
    expect(normaliseWard("H/E")).toBe("H-East");
  });
  it("refuses what is not a ward", () => {
    for (const v of ["", "Z", "K/Q", "A/W", "Andheri West"]) expect(normaliseWard(v)).toBeNull();
  });
  it("keeps the same 24 codes as @hetja/contracts", async () => {
    // Imported by computed path so tsc (rootDir src) does not try to compile contracts.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const target = path.join(here, "..", "..", "contracts", "src", "schemas.ts");
    const { BMC_WARD_CODES } = (await import(target)) as { BMC_WARD_CODES: readonly string[] };
    expect([...WARD_CODES]).toEqual([...BMC_WARD_CODES]);
  });
});

describe("parseCsv", () => {
  it("handles quoted commas, doubled quotes, CRLF and newlines inside quotes", () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\r\n\r\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
    ]);
  });
});

describe("readRecords", () => {
  it("reads the template's two rows cleanly", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const text = readFileSync(path.join(here, "..", "data", "care", "TEMPLATE.csv"), "utf8");
    const { records, errors } = readRecords(parseCsv(text));
    expect(errors).toEqual([]);
    expect(records.map((r) => [r.sourceRef, r.kind, r.wardId, r.hasAmbulance])).toEqual([
      ["clinic-0001", "private_clinic", "K-West", false],
      ["ngo-0001", "ngo", "K-East", true],
    ]);
  });

  it("normalises phones to E.164 and warns (not fails) on a bad one", () => {
    const { records, warnings } = readRecords(
      parseCsv(csv("c-1,Clinic,private_clinic,paid,,,,,,022 2413 7518,12345,no,no,,no,2026-09-01,")),
    );
    expect(records[0].phone).toBe("+912224137518");
    expect(records[0].altPhone).toBeNull();
    expect(warnings.some((w) => /alt_phone/.test(w.message))).toBe(true);
  });

  it("errors on a guessed cost tier, an unknown kind, a bad ward, a missing or repeated id", () => {
    const { errors } = readRecords(
      parseCsv(
        csv(
          "c-1,A,private_clinic,cheap,,,,,,,,no,no,,no,,",
          "c-2,B,vet,paid,,,,,,,,no,no,,no,,",
          "c-3,C,ngo,free,,,Q/Z,,,,,no,no,,no,,",
          ",E,ngo,free,,,,,,,,no,no,,no,,",
          "c-6,F,ngo,free,,,,,,,,maybe,no,,no,,",
          "c-7,G,ngo,free,,,,,,,,no,no,,no,01/09/2026,",
          "c-8,H,ngo,free,,,,,,,,no,no,,no,,",
          "c-8,H2,ngo,free,,,,,,,,no,no,,no,,",
        ),
      ),
    );
    expect(errors.map((e) => e.sourceRef)).toEqual(["c-1", "c-2", "c-3", "", "c-6", "c-7", "c-8"]);
  });

  it("imports a point outside contracts MUMBAI_BOUNDS without a pin, as a warning", () => {
    // Pune (18.52, 73.85) and Vashi (19.08, 73.01, just east of the map box).
    const { records, errors, warnings } = readRecords(
      parseCsv(
        csv(
          "c-1,Pune Clinic,private_clinic,paid,,,,18.52,73.85,,,yes,no,,no,2026-09-01,",
          "c-2,Vashi Clinic,private_clinic,paid,,,,19.08,73.01,,,yes,no,,no,2026-09-01,",
          "c-3,Andheri Clinic,private_clinic,paid,,,,19.13,72.83,,,yes,no,,no,2026-09-01,",
        ),
      ),
      "2026-09-25",
    );
    expect(errors).toEqual([]);
    expect(records.map((r) => [r.sourceRef, r.lat, r.lng])).toEqual([
      ["c-1", null, null],
      ["c-2", null, null],
      ["c-3", 19.13, 72.83],
    ]);
    expect(warnings.filter((w) => /no pin/.test(w.message)).map((w) => w.sourceRef)).toEqual(["c-1", "c-2"]);
  });

  it("refuses a confirmed_on in the future (Mumbai date)", () => {
    const { records, errors } = readRecords(
      parseCsv(
        csv(
          "c-1,Clinic A,private_clinic,paid,,,,,,,,yes,no,,no,2026-09-26,",
          "c-2,Clinic B,private_clinic,paid,,,,,,,,yes,no,,no,2026-09-25,",
          "c-3,Clinic C,private_clinic,paid,,,,,,,,yes,no,,no,2026-02-30,",
        ),
      ),
      "2026-09-25",
    );
    expect(errors.map((e) => [e.sourceRef, /future/.test(e.message)])).toEqual([
      ["c-1", true],
      ["c-3", false],
    ]);
    expect(records.map((r) => r.sourceRef)).toEqual(["c-2"]);
    // 23:00 UTC on the 25th is already the 26th in Mumbai.
    expect(todayInMumbai(new Date("2026-09-25T23:00:00Z"))).toBe("2026-09-26");
  });

  it("warns when confirmed_on is more than 365 days old", () => {
    const { errors, warnings } = readRecords(
      parseCsv(
        csv(
          "c-1,Clinic A,private_clinic,paid,,,,,,,,yes,no,,no,2025-09-24,",
          "c-2,Clinic B,private_clinic,paid,,,,,,,,yes,no,,no,2025-09-25,",
        ),
      ),
      "2026-09-25",
    );
    expect(errors).toEqual([]);
    expect(warnings.filter((w) => /365 days old/.test(w.message)).map((w) => w.sourceRef)).toEqual(["c-1"]);
  });

  it("warns when one phone is on more than 3 rows under different names", () => {
    const row = (id: string, name: string, phone: string) =>
      `${id},${name},private_clinic,paid,,,,,,${phone},,no,no,,no,2026-09-01,`;
    const { records } = readRecords(
      parseCsv(
        csv(
          row("a-1", "Clinic One", "022 2413 7518"),
          row("a-2", "Clinic Two", "022 2413 7518"),
          row("a-3", "Clinic Three", "022 2413 7518"),
          row("a-4", "Clinic Four", "022 2413 7518"),
          // Exactly 3 rows: a small chain's shared line is fine.
          row("b-1", "Chain Andheri", "022 2600 0001"),
          row("b-2", "Chain Bandra", "022 2600 0001"),
          row("b-3", "Chain Dadar", "022 2600 0001"),
          // Many rows, one name: the same provider, not a clash.
          row("c-1", "Same Name", "022 2600 0002"),
          row("c-2", "same  name", "022 2600 0002"),
          row("c-3", "Same Name", "022 2600 0002"),
          row("c-4", "Same Name", "022 2600 0002"),
        ),
      ),
      "2026-09-25",
    );
    const w = sharedPhoneWarnings(records);
    expect(w.map((x) => x.sourceRef)).toEqual(["a-1, a-2, a-3, a-4"]);
    expect(w[0].message).toMatch(/\+912224137518 is on 4 rows/);
  });

  it("warns on two rows of the same kind within 30 m under different names", () => {
    // 0.0002 deg of latitude is about 22 m; 0.0004 is about 44 m.
    const pts = [
      { sourceRef: "p-1", name: "Paws Clinic", kind: "private_clinic", lat: 19.13, lng: 72.83 },
      { sourceRef: "p-2", name: "Paws Vet Clinic", kind: "private_clinic", lat: 19.1302, lng: 72.83 },
      { sourceRef: "p-3", name: "Far Clinic", kind: "private_clinic", lat: 19.1306, lng: 72.83 },
      { sourceRef: "p-4", name: "Street Rescue", kind: "ngo", lat: 19.1301, lng: 72.83 },
      { sourceRef: "p-5", name: "paws clinic", kind: "private_clinic", lat: 19.13, lng: 72.83 },
    ];
    const w = nearbySameKindWarnings(pts);
    expect(w.map((x) => x.sourceRef)).toEqual(["p-1, p-2", "p-2, p-5"]);
    expect(w[0].message).toMatch(/22 m apart/);
  });

  it("refuses a file without the load-bearing columns", () => {
    const { errors } = readRecords(parseCsv("name,phone\nX,1"));
    expect(errors.map((e) => e.message)).toEqual([
      'missing column "source_id"',
      'missing column "kind"',
      'missing column "cost_tier"',
    ]);
  });

  it("flags two ids with the same name and phone (the unique index would refuse the second)", () => {
    const a = resolved({ sourceRef: "a" });
    const b = resolved({ sourceRef: "b" });
    expect(duplicateKeys([a, b]).map((d) => d.sourceRef)).toEqual(["b"]);
  });
});

describe("plan", () => {
  it("adds new ids, updates changed ones column by column, leaves identical rows alone", () => {
    const same = resolved({ sourceRef: "same" });
    const moved = resolved({ sourceRef: "moved", hoursNote: "Open 24 hours", is24x7: true });
    const fresh = resolved({ sourceRef: "new", name: "New Clinic" });
    const db = [stored(same), stored(resolved({ sourceRef: "moved" }))];
    const p = plan(db, [same, moved, fresh], new Map());
    expect(p.adds.map((a) => a.sourceRef)).toEqual(["new"]);
    expect(p.unchanged).toBe(1);
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0].changes.map((c) => c.column).sort()).toEqual(["hours_note", "is_24x7"]);
    expect(p.retires).toEqual([]);
  });

  it("retires listed rows missing from the file, and relists a retired row that comes back", () => {
    const back = resolved({ sourceRef: "back" });
    const gone = resolved({ sourceRef: "gone" });
    const alreadyRetired = resolved({ sourceRef: "old" });
    const db = [stored(back, { listed: false }), stored(gone), stored(alreadyRetired, { listed: false })];
    const p = plan(db, [back], new Map());
    expect(p.updates).toEqual([{ id: "id-back", record: back, changes: [], relist: true }]);
    expect(p.retires.map((r) => r.source_ref)).toEqual(["gone"]);
  });

  it("reports a new row whose name and phone another source already holds as a conflict, not an add", () => {
    const r = resolved({ sourceRef: "n-1" });
    const p = plan([], [r], new Map([[`${r.name}|${r.phone}`, { id: "other", source: "verified-csv-2026-08" }]]));
    expect(p.adds).toEqual([]);
    expect(p.conflicts).toEqual([{ record: r, otherId: "other", otherSource: "verified-csv-2026-08" }]);
  });

  it("ignores sub-metre coordinate noise", () => {
    const r = resolved();
    const p = plan([stored(r, { lat: r.geoLat + 1e-7 })], [r], new Map());
    expect(p.unchanged).toBe(1);
  });

  it("only records a confirmation date for a row that has a phone", () => {
    expect(columnsOf(resolved({ phone: null })).phone_verified_on).toBeNull();
    expect(columnsOf(resolved()).phone_verified_on).toBe("2026-09-01");
  });
});

describe("guards", () => {
  it("treats retiring more than a quarter (and more than 3) as a mass retire", () => {
    expect(tooManyRetires(100, 3)).toBe(false);
    expect(tooManyRetires(100, 25)).toBe(false);
    expect(tooManyRetires(100, 26)).toBe(true);
    expect(tooManyRetires(8, 4)).toBe(true);
  });

  it("parses arguments, dry run by default, and refuses legacy or malformed sources", () => {
    expect(parseArgs(["--", "--file", "x.csv", "--source", "monthly-clinics"])).toMatchObject({
      file: "x.csv",
      source: "monthly-clinics",
      apply: false,
    });
    expect(parseArgs(["--file", "x.csv", "--source", "monthly-clinics", "--apply"])).toMatchObject({ apply: true });
    expect(parseArgs(["--file", "x.csv", "--source", "curated"])).toMatch(/legacy/);
    expect(parseArgs(["--file", "x.csv", "--source", "verified-csv-2026-08"])).toMatch(/legacy/);
    expect(parseArgs(["--file", "x.csv", "--source", "Bad Name"])).toMatch(/--source/);
    expect(parseArgs(["--source", "monthly-clinics"])).toMatch(/--file/);
    expect(parseArgs(["--file", "x", "--source", "monthly-x", "--wat"])).toMatch(/unknown/);
  });
});
