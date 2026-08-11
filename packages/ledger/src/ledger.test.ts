import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GENESIS_PREV_HASH,
  anchorMessage,
  computeHash,
  hashInput,
  recomputeHead,
  verifyChain,
  type LedgerRecord,
} from "./index.js";

function loadSample(): LedgerRecord[] {
  const url = new URL("../ops/sample-ledger.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as LedgerRecord[];
}

describe("ledger chain (INVARIANT 9: length-prefixed hash inputs)", () => {
  it("1. verifies the seeded sample chain", () => {
    const records = loadSample();
    expect(records).toHaveLength(3);
    const result = verifyChain(records);
    expect(result.valid).toBe(true);
  });

  it("2. a mutated payload invalidates the chain at the right record", () => {
    const records = loadSample();
    const mutated = structuredClone(records);
    mutated[1] = {
      ...mutated[1],
      payload: { ...mutated[1].payload, diagnosis: "TAMPERED" },
    };
    const result = verifyChain(mutated);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it("3. length-prefixing defeats ambiguous concatenation", () => {
    const naiveA = ["ab", "c", "x", "y"].join("");
    const naiveB = ["a", "bc", "x", "y"].join("");
    expect(naiveA).toBe(naiveB);

    const inputA = hashInput("ab", "c", "x", "y");
    const inputB = hashInput("a", "bc", "x", "y");
    expect(inputA.equals(inputB)).toBe(false);

    expect(computeHash("ab", "c", "x", "y")).not.toBe(
      computeHash("a", "bc", "x", "y"),
    );
  });

  it("4. genesis head recomputes from the seeded records", () => {
    const records = loadSample();
    expect(recomputeHead([])).toBe(GENESIS_PREV_HASH);
    expect(recomputeHead([records[0]])).toBe(records[0].hash);
    expect(recomputeHead(records)).toBe(records[records.length - 1].hash);
  });

  it("5. anchorMessage is deterministic and canonical", () => {
    const head = recomputeHead(loadSample());
    const publishedAt = "2026-08-12T00:00:00.000Z";
    const message = anchorMessage(head, 3, publishedAt);
    expect(anchorMessage(head, 3, publishedAt)).toBe(message);
    expect(message).toBe(
      `{"headHash":"${head}","publishedAt":"${publishedAt}","recordCount":3}`,
    );
    expect(anchorMessage(head, 2, publishedAt)).not.toBe(message);
  });
});
