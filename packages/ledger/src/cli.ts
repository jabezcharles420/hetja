#!/usr/bin/env node
/**
 * Hetja ledger:verify CLI — reads a ledger JSON file (array of records),
 * verifies the chain, prints a summary and exits 0 (valid) or 1 (invalid).
 * Defaults to ops/sample-ledger.json; override with $HETJA_LEDGER_PATH.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recomputeHead, verifyChain, type LedgerRecord } from "./chain.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER_PATH =
  process.env.HETJA_LEDGER_PATH ?? join(PACKAGE_ROOT, "ops", "sample-ledger.json");

function main(): number {
  let records: LedgerRecord[];
  try {
    const parsed: unknown = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("ledger must be an array of records");
    records = parsed as LedgerRecord[];
  } catch (err) {
    console.error(`ledger:verify: cannot read ${LEDGER_PATH}: ${(err as Error).message}`);
    return 1;
  }

  const { valid, brokenAt } = verifyChain(records);
  const head = recomputeHead(records);

  console.log(`ledger: ${LEDGER_PATH}`);
  console.log(`records: ${records.length}`);
  console.log(`head: ${head}`);
  if (valid) {
    console.log("verdict: VALID — chain intact");
    return 0;
  }
  console.log(`brokenAt: ${brokenAt}`);
  console.log("verdict: TAMPERED — chain broken");
  return 1;
}

process.exit(main());
