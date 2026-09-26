/**
 * The care-agent JSONL converter, and the importer's handling of what it
 * produces: the committed 2026-09-26 file must convert to a CSV the importer
 * reads with no errors, keep all 31 rows, mark no number confirmed and guess
 * no cost tier.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsonlToCsv, toCsvRow, wardsNamedIn } from "./care-jsonl-to-csv.js";
import { fallbackPoint, parseCsv, readRecords } from "./import-care.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, "..", "data", "care");

describe("care-jsonl-to-csv", () => {
  it("maps the fields: govt is government and free, no confirmation date, notes name the source", () => {
    const govt = toCsvRow({
      candidate_id: "bmc-x",
      name: "BMC Dog Control Office",
      kind: "govt",
      cost_tier: null,
      phone: "9987798436",
      ward: "G/S",
      locality: "Mahalaxmi",
      source_url: "https://mcgm.gov.in/x.pdf",
      confidence: "high",
    });
    expect(govt).toMatchObject({ source_id: "bmc-x", cost_tier: "free", is_government: "yes", is_person: "no", confirmed_on: "", notes: "Checked against https://mcgm.gov.in/x.pdf" });
    const ngo = toCsvRow({ candidate_id: "n", name: "An NGO", kind: "ngo", cost_tier: null, confidence: "low", source_url: "https://e.org" });
    expect(ngo).toMatchObject({ cost_tier: "", is_government: "no", notes: "Checked against https://e.org, confidence low" });
  });

  it("derives a single ward from the locality, or lists several without guessing one", () => {
    expect(wardsNamedIn("Kandivali / Borivali / Dahisar (service area)")).toEqual(["R-South", "R-Central", "R-North"]);
    expect(toCsvRow({ candidate_id: "m", name: "M", kind: "ngo", locality: "Kandivali / Borivali / Dahisar" })).toMatchObject({ ward: "", wards: "R/S; R/C; R/N" });
    expect(toCsvRow({ candidate_id: "g", name: "G", kind: "ngo", locality: "Goregaon" })).toMatchObject({ ward: "P/S", wards: "" });
  });

  it("never writes an em dash and quotes commas", () => {
    const { csv } = jsonlToCsv(JSON.stringify({ candidate_id: "q", name: `A${String.fromCharCode(0x2014)}B, Trust`, kind: "ngo" }));
    expect(csv.includes(String.fromCharCode(0x2014))).toBe(false);
    expect(csv).toContain('"A, B, Trust"');
  });

  it("the committed 2026-09-26 file converts to the committed CSV, which imports with no errors", () => {
    const { csv, rows } = jsonlToCsv(readFileSync(path.join(dataDir, "verified-2026-09-26.jsonl"), "utf8"));
    expect(rows).toBe(31);
    expect(readFileSync(path.join(dataDir, "2026-09-26.csv"), "utf8").replace(/\r\n/g, "\n")).toBe(csv);
    const { records, errors, warnings } = readRecords(parseCsv(csv), "2026-09-26");
    expect(errors).toEqual([]);
    expect(records).toHaveLength(31);
    expect(records.every((r) => r.confirmedOn === null)).toBe(true);
    expect(records.filter((r) => r.kind === "govt").every((r) => r.costTier === "free" && r.isGovernment)).toBe(true);
    expect(records.filter((r) => r.costTier === null).length).toBe(17);
    expect(warnings.some((w) => /imported as unknown/.test(w.message))).toBe(true);
  });
});

describe("importer: unknown cost tier and the fallback point", () => {
  const H = "source_id,name,kind,cost_tier,ward,phone,ambulance,is_24x7,handles_wildlife";
  it("an empty cost tier is unknown with a warning; a typo is still an error; empty on govt is free", () => {
    const r = readRecords(parseCsv([H, "a,An NGO,ngo,,K/W,+91 98200 00000,no,no,no", "b,Typo,ngo,frree,K/W,,yes,no,no", "c,BMC Office,govt,,A,,yes,no,no"].join("\n")), "2026-09-26");
    expect(r.records.map((x) => [x.sourceRef, x.costTier])).toEqual([
      ["a", null],
      ["c", "free"],
    ]);
    expect(r.errors.map((e) => e.sourceRef)).toEqual(["b"]);
  });

  it("places a row with no point at its locality, else its ward's centre, else a locality named in the text", () => {
    expect(fallbackPoint("Malad", null)).toEqual(fallbackPoint("Malad", "A"));
    expect(fallbackPoint("Apollo Bunder", "A")).toEqual({ lat: 18.918, lng: 72.828 });
    const k = fallbackPoint("Kandivali / Borivali / Dahisar (service area)", null);
    expect(k).toEqual(fallbackPoint("Kandivali", null));
    expect(fallbackPoint("Nowhere", null)).toEqual(fallbackPoint("Mumbai", null));
  });
});
