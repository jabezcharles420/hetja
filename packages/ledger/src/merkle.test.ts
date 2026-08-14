import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  EMPTY_MERKLE_ROOT,
  GENESIS_PREV_HASH,
  computeHash,
  merkleLeafHash,
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

/** Look a record up by id — verifyInclusion takes the record, not just its id. */
function rec(records: LedgerRecord[], id: string): LedgerRecord {
  const found = records.find((r) => r.id === id);
  if (!found) throw new Error(`test fixture has no record ${id}`);
  return found;
}

/**
 * The pre-fix construction, reimplemented here on purpose: raw record hashes as
 * leaves and `sha256(left‖right)` for every node, with no leaf/internal domain
 * separation. Tests 10 and 11 use it to build the exact forgeries that passed
 * against the old implementation, so a regression to that construction fails
 * loudly instead of silently.
 */
const rawSha256 = (...parts: Buffer[]): Buffer =>
  createHash("sha256").update(Buffer.concat(parts)).digest();

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
    // Both leaves and nodes carry a prefix byte, so no non-empty tree can ever
    // hash to the empty root: "empty" is not confusable with "has contents".
    expect(merkleRoot(loadSample())).not.toBe(EMPTY_MERKLE_ROOT);
  });

  it("4. verifyInclusion is true for every real record (even and odd trees)", () => {
    const base = loadSample(); // 3 records — odd tree
    const four = append(base, "ledger-0004", { kind: "surgery" }); // even tree
    const five = append(four, "ledger-0005", { kind: "checkup" }); // odd again

    for (const records of [base, four, five]) {
      const root = merkleRoot(records);
      for (const record of records) {
        const proof = merkleProof(records, record.id);
        expect(verifyInclusion(record, proof, root)).toBe(true);
        expect(proof.leafHash).toBe(record.hash); // proof commits the chain hash
        expect(proof.leafCount).toBe(records.length);
        expect(proof.root).toBe(root);
      }
    }
  });

  it("5. verifyInclusion is false for a tampered record", () => {
    const records = loadSample();
    const root = merkleRoot(records);
    const record = rec(records, "ledger-0002");
    const proof = merkleProof(records, "ledger-0002");

    // Tampered leaf (what an attacker who rewrote the record's payload would
    // produce). Now caught twice over: it no longer matches `record.hash`, and
    // it no longer recomputes to the root either.
    const tamperedLeaf = { ...proof, leafHash: "f".repeat(64) };
    expect(verifyInclusion(record, tamperedLeaf, root)).toBe(false);
    expect(verifyInclusion({ ...record, hash: "f".repeat(64) }, tamperedLeaf, root)).toBe(false);

    // Tampered sibling (garbage in the path).
    const tamperedSibling = {
      ...proof,
      siblings: proof.siblings.map((s, i) => (i === 0 ? "e".repeat(64) : s)),
    };
    expect(verifyInclusion(record, tamperedSibling, root)).toBe(false);

    // Tampered index (claims a different position than the path describes).
    expect(verifyInclusion(record, { ...proof, index: proof.index + 1 }, root)).toBe(false);

    // Tampered leaf count, where the lie changes the traversal.
    expect(verifyInclusion(record, { ...proof, leafCount: 2 }, root)).toBe(false);
    expect(verifyInclusion(record, { ...proof, leafCount: 1 }, root)).toBe(false);
    expect(verifyInclusion(record, { ...proof, leafCount: 5 }, root)).toBe(false);
    // …and the documented limitation, asserted rather than hand-waved: a leaf
    // count that yields the SAME traversal is not independently detectable
    // (index 1 walks identically in a 3- and a 4-leaf tree). Nothing in the tree
    // authenticates the count; the root is what binds the contents, and the real
    // 4-record ledger has a different root, so this buys an attacker nothing.
    expect(verifyInclusion(record, { ...proof, leafCount: 4 }, root)).toBe(true);
    expect(merkleRoot([...records, records[2]])).not.toBe(root);

    // Tampered root (auditor checks against a forged root).
    expect(verifyInclusion(record, proof, "0".repeat(64))).toBe(false);

    // Structural garbage: under-specified (path stops short of the root) and
    // over-specified (path runs past it) both fail.
    expect(verifyInclusion(record, { ...proof, siblings: [] }, root)).toBe(false);
    expect(
      verifyInclusion(record, { ...proof, siblings: [...proof.siblings, "a".repeat(64)] }, root),
    ).toBe(false);
    expect(verifyInclusion(record, { ...proof, index: -1 }, root)).toBe(false);
    expect(verifyInclusion(record, { ...proof, index: 1.5 }, root)).toBe(false);
  });

  it("6. verifyInclusion is false for a foreign record (another ledger's proof)", () => {
    const records = loadSample();
    const foreign = append(records, "ledger-0004", { kind: "surgery" }); // a different dog's ledger
    const foreignRoot = merkleRoot(foreign);
    const foreignProof = merkleProof(foreign, "ledger-0004");
    const foreignRecord = rec(foreign, "ledger-0004");

    // A proof from dog B does not verify against dog A's root…
    const homeRoot = merkleRoot(records);
    expect(verifyInclusion(foreignRecord, foreignProof, homeRoot)).toBe(false);
    // …but does against its own.
    expect(verifyInclusion(foreignRecord, foreignProof, foreignRoot)).toBe(true);

    // …and a proof for a different record does not verify under this id.
    const proof = merkleProof(records, "ledger-0001");
    expect(verifyInclusion(rec(records, "ledger-0002"), proof, homeRoot)).toBe(false);

    // A record that is not in the tree at all cannot be proven in, even with a
    // plausible-looking label and a real root.
    const ghost = { id: "ledger-9999", hash: "9".repeat(64) };
    const notIncluded = {
      recordId: "ledger-9999",
      leafHash: ghost.hash, // not any record hash in this chain
      index: 0,
      leafCount: foreign.length,
      siblings: foreignProof.siblings,
      root: foreignRoot,
    };
    expect(verifyInclusion(ghost, notIncluded, foreignRoot)).toBe(false);
  });

  it("7. proof size is O(log n)", () => {
    let records = loadSample();
    for (let i = 4; i <= 100; i++) records = append(records, `ledger-${String(i).padStart(4, "0")}`, { kind: "checkup", seq: i });
    expect(records).toHaveLength(100);
    // An RFC 6962 tree is deliberately unbalanced: it splits at the largest
    // power of two below n, so the left subtree is full and the right one is
    // shallower. Every path is therefore <= ceil(log2(n)) but not all are equal
    // — the first leaf sits under the full 64-leaf half (depth 7), the last one
    // under the 36-leaf remainder (depth 4). Bounded by log n is the property
    // that matters; uniform depth was an artifact of duplicating odd nodes to
    // pad every level to a power of two.
    const ceilLog2 = Math.ceil(Math.log2(records.length));
    expect(merkleProof(records, "ledger-0001").siblings.length).toBe(7); // ceil(log2(100))
    expect(merkleProof(records, "ledger-0100").siblings.length).toBe(4);
    for (const record of records) {
      const proof = merkleProof(records, record.id);
      expect(proof.siblings.length).toBeLessThanOrEqual(ceilLog2);
      expect(verifyInclusion(record, proof, proof.root)).toBe(true);
    }
  });

  it("8. merkleProof throws for an unknown recordId", () => {
    expect(() => merkleProof(loadSample(), "ledger-9999")).toThrow(/no record with id/);
  });

  it("9. genesis-only ledger: root is the single record's LEAF hash, proof verifies", () => {
    const genesis: LedgerRecord = {
      id: "ledger-0000",
      prev: GENESIS_PREV_HASH,
      payload: { kind: "registration" },
      vetId: "vet-01",
      ts: "2026-08-01T10:00:00.000Z",
      hash: computeHash(GENESIS_PREV_HASH, { kind: "registration" }, "vet-01", "2026-08-01T10:00:00.000Z"),
    };
    // RFC 6962: MTH({d0}) = SHA256(0x00 || d0), NOT d0 itself. The root of a
    // one-record ledger must not equal that record's chain hash — if it did, a
    // bare record hash would double as a valid published root.
    expect(merkleRoot([genesis])).toBe(merkleLeafHash(genesis.hash));
    expect(merkleRoot([genesis])).not.toBe(genesis.hash);
    const proof = merkleProof([genesis], "ledger-0000");
    expect(proof.siblings).toEqual([]);
    expect(proof.leafCount).toBe(1);
    expect(verifyInclusion(genesis, proof, merkleRoot([genesis]))).toBe(true);
  });

  it("10. REGRESSION: an internal node cannot be passed off as a leaf", () => {
    // The verified pre-fix forgery. With no domain separation a leaf and an
    // internal node are the same construction, so H(L0‖L1) could be submitted
    // as a leaf with H(L2‖L3) as its only sibling: that path recomputes to the
    // genuine published root, i.e. a passing inclusion proof for a record that
    // never existed. verifyInclusion("FAKE-RECORD", forged, R) returned true.
    const base = loadSample();
    const four = append(base, "ledger-0004", { kind: "surgery" });
    const leaves = four.map((r) => Buffer.from(r.hash, "hex"));

    // (a) The old, unprefixed tree — the forgery's own arithmetic still works…
    const oldN01 = rawSha256(leaves[0], leaves[1]);
    const oldN23 = rawSha256(leaves[2], leaves[3]);
    const oldRoot = rawSha256(oldN01, oldN23).toString("hex");
    // …but that root is not what this ledger commits to any more, because
    // leaves and nodes are domain-separated now.
    expect(merkleRoot(four)).not.toBe(oldRoot);

    // (b) The forgery against the CURRENT root: rebuild the same "internal node
    // presented as a leaf" attack with today's node hashing, and hand the
    // verifier the real published root.
    const node = (l: Buffer, r: Buffer): Buffer => rawSha256(Buffer.from([0x01]), l, r);
    const leafOf = (h: string): Buffer =>
      rawSha256(Buffer.from([0x00]), Buffer.from(h, "hex"));
    const n01 = node(leafOf(four[0].hash), leafOf(four[1].hash));
    const n23 = node(leafOf(four[2].hash), leafOf(four[3].hash));
    const realRoot = node(n01, n23).toString("hex");
    expect(realRoot).toBe(merkleRoot(four)); // our tree really is this shape

    const fake = { id: "FAKE-RECORD", hash: n01.toString("hex") };
    const forged = {
      recordId: "FAKE-RECORD",
      leafHash: fake.hash,
      index: 0,
      leafCount: 4,
      siblings: [n23.toString("hex")],
      root: realRoot,
    };
    // Rejected: the verifier hashes the claimed leaf as SHA256(0x00 || leaf),
    // and an internal node's preimage can never be that.
    expect(verifyInclusion(fake, forged, realRoot)).toBe(false);
    // Also rejected under the same leaf count/index it would have needed if the
    // attacker instead claimed a two-leaf tree.
    expect(
      verifyInclusion(fake, { ...forged, leafCount: 2, siblings: [n23.toString("hex")] }, realRoot),
    ).toBe(false);
    // And the domain separation is not a coincidence of these bytes:
    expect(merkleLeafHash(four[0].hash)).not.toBe(four[0].hash);
  });

  it("11. REGRESSION: a duplicated trailing record does not collide (CVE-2012-2459)", () => {
    // `duplicateOdd: true` paired an odd trailing node with itself, so
    // merkleRoot([L0,L1,L2]) and merkleRoot([L0,L1,L2,L2]) were byte-identical
    // (4cfe0e06…4b04da0b): an N-record ledger and an (N+1)-record ledger that
    // repeats its last record committed to the same root, and the last record
    // of any odd ledger was provable at two different indices under one root.
    const three = loadSample();
    const withDuplicate = [...three, three[2]];

    expect(merkleRoot(three)).not.toBe(merkleRoot(withDuplicate));

    // The old collision, reconstructed: under an unprefixed duplicateOdd tree
    // both ledgers hash to the same root. Kept as an explicit statement of what
    // used to be true, so nobody reintroduces the shape by accident.
    const dupOddRoot = (records: LedgerRecord[]): string => {
      let level: Buffer[] = records.map((r) => Buffer.from(r.hash, "hex"));
      while (level.length > 1) {
        if (level.length % 2 === 1) level = [...level, level[level.length - 1]];
        const next: Buffer[] = [];
        for (let i = 0; i < level.length; i += 2) next.push(rawSha256(level[i], level[i + 1]));
        level = next;
      }
      return level[0].toString("hex");
    };
    expect(dupOddRoot(three)).toBe(dupOddRoot(withDuplicate)); // the old bug
    expect(merkleRoot(three)).not.toBe(dupOddRoot(three)); // we are not that tree

    // The other half of the same defect: the last record of an odd ledger used
    // to sit at BOTH index 2 and index 3 of the padded tree, so it was provable
    // at two positions under one root. There is no index 3 in a 3-leaf RFC 6962
    // tree, and claiming one is rejected however the rest of the proof is
    // dressed up.
    const root3 = merkleRoot(three);
    const last = rec(three, "ledger-0003");
    const proof = merkleProof(three, last.id);
    expect(proof.index).toBe(2);
    expect(proof.leafCount).toBe(3);
    expect(verifyInclusion(last, proof, root3)).toBe(true);
    expect(verifyInclusion(last, { ...proof, index: 3 }, root3)).toBe(false);
    expect(verifyInclusion(last, { ...proof, index: 3, leafCount: 4 }, root3)).toBe(false);
  });

  it("12. REGRESSION: a proof for one record cannot be relabelled onto another", () => {
    // The old signature took a `recordId` string and trusted `proof.leafHash`
    // to be that record's hash, so the binding between "the record" and "the 32
    // bytes in the tree" was asserted by the attacker-supplied proof itself.
    // Now the caller passes the record they hold, and the proof has to match it.
    const records = loadSample();
    const root = merkleRoot(records);
    const first = rec(records, "ledger-0001");
    const second = rec(records, "ledger-0002");
    const proofForFirst = merkleProof(records, "ledger-0001");

    // A genuine, root-recomputing proof for record 1, relabelled as record 2.
    const relabelled = { ...proofForFirst, recordId: second.id };
    expect(verifyInclusion(second, relabelled, root)).toBe(false);

    // Same attempt from the other direction: keep record 1's id and leaf but
    // claim it proves record 2 — the leafHash/record.hash check catches it.
    expect(verifyInclusion({ ...second, id: first.id }, proofForFirst, root)).toBe(false);

    // A proof whose leafHash belongs to a different record than its recordId,
    // even with both taken from real records of this ledger.
    const mixed = { ...merkleProof(records, "ledger-0002"), leafHash: first.hash };
    expect(verifyInclusion(second, mixed, root)).toBe(false);
    expect(verifyInclusion(first, mixed, root)).toBe(false);
  });
});
