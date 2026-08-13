import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMPTY_MERKLE_ROOT,
  GENESIS_PREV_HASH,
  computeHash,
  merkleProof,
  merkleRoot,
  verifyChain,
  verifyInclusion,
  type LedgerRecord,
} from "./index.js";

function loadSample(): LedgerRecord[] {
  const url = new URL("../ops/sample-ledger.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as LedgerRecord[];
}

/** Append a record the way the app does: chain prev = last hash, same vet. */
function append(
  records: LedgerRecord[],
  id: string,
  payload: Record<string, unknown>,
  ts = "2026-08-04T09:00:00.000Z",
): LedgerRecord[] {
  const last = records[records.length - 1];
  const hash = computeHash(last.hash, payload, last.vetId, ts);
  return [...records, { id, prev: last.hash, payload, vetId: last.vetId, ts, hash }];
}

describe("merkle inclusion proofs (enhancement stack D.1, pick 15)", () => {
  it("1. merkle root changes on every append", () => {
    const base = loadSample();
    const root3 = merkleRoot(base);

    const plusOne = append(base, "ledger-0004", { kind: "surgery", note: "stitches" });
    const plusTwo = append(plusOne, "ledger-0005", { kind: "checkup", notes: "healed" });

    expect(merkleRoot(plusOne)).not.toBe(root3);
    expect(merkleRoot(plusTwo)).not.toBe(merkleRoot(plusOne));
    // The chain stays valid across the same appends.
    expect(verifyChain(plusTwo).valid).toBe(true);
  });

  it("2. merkle root is deterministic and agrees with the chain hashes", () => {
    const records = loadSample();
    expect(merkleRoot(records)).toBe(merkleRoot(records));
    // Leaf = canonical chain hash: mutating any record hash moves the root,
    // and the same mutation breaks the chain at the same place.
    const tampered = structuredClone(records);
    tampered[1] = { ...tampered[1], hash: "f".repeat(64) };
    expect(merkleRoot(tampered)).not.toBe(merkleRoot(records));
    expect(verifyChain(tampered).brokenAt).toBe(1);
  });

  it("3. empty ledger has the RFC 6962 null root", () => {
    expect(merkleRoot([])).toBe(EMPTY_MERKLE_ROOT);
    expect(EMPTY_MERKLE_ROOT).toMatch(/^[0-9a-f]{64}$/);
  });

  it("4. verifyInclusion is true for every real record (even and odd trees)", () => {
    const base = loadSample(); // 3 records — odd tree
    const four = append(base, "ledger-0004", { kind: "surgery" }); // even tree
    const five = append(four, "ledger-0005", { kind: "checkup" }); // odd again

    for (const records of [base, four, five]) {
      const root = merkleRoot(records);
      for (const record of records) {
        const proof = merkleProof(records, record.id);
        expect(verifyInclusion(record.id, proof, root)).toBe(true);
        expect(proof.leafHash).toBe(record.hash); // proof commits the chain hash
        expect(proof.root).toBe(root);
      }
    }
  });

  it("5. verifyInclusion is false for a tampered record", () => {
    const records = loadSample();
    const root = merkleRoot(records);
    const proof = merkleProof(records, "ledger-0002");

    // Tampered leaf (what an attacker who rewrote the record's payload would produce).
    const tamperedLeaf = { ...proof, leafHash: "f".repeat(64) };
    expect(verifyInclusion(proof.recordId, tamperedLeaf, root)).toBe(false);

    // Tampered sibling (garbage in the path).
    const tamperedSibling = {
      ...proof,
      siblings: proof.siblings.map((s, i) => (i === 0 ? "e".repeat(64) : s)),
    };
    expect(verifyInclusion(proof.recordId, tamperedSibling, root)).toBe(false);

    // Tampered index (claims a different position than the path describes).
    const tamperedIndex = { ...proof, index: proof.index + 1 };
    expect(verifyInclusion(proof.recordId, tamperedIndex, root)).toBe(false);

    // Tampered root (auditor checks against a forged root).
    expect(verifyInclusion(proof.recordId, proof, "0".repeat(64))).toBe(false);

    // Structural garbage.
    expect(verifyInclusion("ledger-0002", { ...proof, siblings: [] }, root)).toBe(false);
  });

  it("6. verifyInclusion is false for a foreign record (another ledger's proof)", () => {
    const records = loadSample();
    const foreign = append(records, "ledger-0004", { kind: "surgery" }); // a different dog's ledger
    const foreignRoot = merkleRoot(foreign);
    const foreignProof = merkleProof(foreign, "ledger-0004");

    // A proof from dog B does not verify against dog A's root…
    const homeRoot = merkleRoot(records);
    expect(verifyInclusion("ledger-0004", foreignProof, homeRoot)).toBe(false);

    // …and a proof for a different record does not verify under this id.
    const proof = merkleProof(records, "ledger-0001");
    expect(verifyInclusion("ledger-0002", proof, merkleRoot(records))).toBe(false);

    // A record that is not in the tree at all cannot be proven in.
    expect(verifyInclusion("ledger-0004", foreignProof, foreignRoot)).toBe(true);
    // …and a proof for a hash that is not a leaf of the tree fails, even
    // with a plausible label.
    const notIncluded = {
      recordId: "ledger-9999",
      leafHash: "9".repeat(64), // not any record hash in this chain
      index: 0,
      siblings: [],
      root: foreignRoot,
    };
    expect(verifyInclusion("ledger-9999", notIncluded, foreignRoot)).toBe(false);
  });

  it("7. proof size is O(log n)", () => {
    let records = loadSample();
    for (let i = 4; i <= 100; i++) records = append(records, `ledger-${String(i).padStart(4, "0")}`, { kind: "checkup", seq: i });
    expect(records).toHaveLength(100);
    expect(merkleProof(records, "ledger-0001").siblings.length).toBe(7); // ceil(log2(100))
    expect(merkleProof(records, "ledger-0100").siblings.length).toBe(7);
  });

  it("8. merkleProof throws for an unknown recordId", () => {
    expect(() => merkleProof(loadSample(), "ledger-9999")).toThrow(/no record with id/);
  });

  it("9. genesis-only ledger: root is the single record's hash, proof verifies", () => {
    const genesis: LedgerRecord = {
      id: "ledger-0000",
      prev: GENESIS_PREV_HASH,
      payload: { kind: "registration" },
      vetId: "vet-01",
      ts: "2026-08-01T10:00:00.000Z",
      hash: computeHash(GENESIS_PREV_HASH, { kind: "registration" }, "vet-01", "2026-08-01T10:00:00.000Z"),
    };
    expect(merkleRoot([genesis])).toBe(genesis.hash);
    const proof = merkleProof([genesis], "ledger-0000");
    expect(proof.siblings).toEqual([]);
    expect(verifyInclusion("ledger-0000", proof, genesis.hash)).toBe(true);
  });
});
