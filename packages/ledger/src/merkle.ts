/**
 * Hetja ledger Merkle inclusion proofs — enhancement stack §D.1 (Phase 1, pick 15).
 *
 * On every append the caller builds a Merkle tree over the chain entries and
 * persists the root next to the chain head. The leaf DATA of each record is
 * the SAME canonical per-record hash the hash chain already commits to
 * (`LedgerRecord.hash`, hex SHA-256), so the Merkle tree and the chain always
 * agree: a record that fails `verifyChain` can never be proven into the tree,
 * and a proof only ever certifies a hash the chain itself produces.
 *
 * Tree shape: RFC 6962 (Certificate Transparency) §2.1, adopted wholesale
 * rather than approximated. This file previously used merkletreejs with
 * `duplicateOdd: true` and cited RFC 6962 for its empty-root convention only;
 * two real forgeries came out of that gap, so the whole construction is now
 * RFC 6962 and the dependency is gone (see "Why RFC 6962, not merkletreejs"
 * below).
 *
 *   - MTH({})      = SHA256("")                       — the empty-ledger root
 *   - MTH({d0})    = SHA256(0x00 || d0)               — a LEAF
 *   - MTH(D[n])    = SHA256(0x01 || MTH(D[0:k]) || MTH(D[k:n])) — an INTERNAL
 *                    node, where k is the largest power of two < n
 *
 * The two things that matter about that definition:
 *
 * 1. **Domain separation.** A leaf is hashed with a `0x00` prefix and an
 *    internal node with `0x01`, so the two constructions can never collide.
 *    Without the prefixes a leaf and an internal node are both "SHA-256 of 32
 *    or 64 bytes" and an internal node can be presented to the verifier AS a
 *    leaf: with leaves L0..L3 and root R = H(H(L0‖L1) ‖ H(L2‖L3)), the proof
 *    `{leafHash: H(L0‖L1), index: 0, siblings: [H(L2‖L3)]}` recomputes to the
 *    genuine published R. That is a passing inclusion proof for a record that
 *    does not exist, against the real root — verified against this package
 *    before the fix. The prefixes close it off: a verifier hashes the claimed
 *    leaf as `SHA256(0x00 || leaf)`, which an internal node's preimage can
 *    never equal.
 *
 * 2. **No odd-node duplication.** Bitcoin-style trees pair an odd trailing
 *    node with itself, which is CVE-2012-2459: `merkleRoot([L0,L1,L2])` and
 *    `merkleRoot([L0,L1,L2,L2])` came out byte-identical here, so an N-record
 *    ledger and an (N+1)-record ledger that duplicates its last record
 *    committed to the same root — and the last record of any odd ledger could
 *    be proven at two different indices under one root. RFC 6962 never
 *    duplicates; it splits at the largest power of two below n and lets the
 *    right subtree be shallower. The trees for n and n+1 are then structurally
 *    different and the roots differ by construction.
 *
 * Why RFC 6962, not merkletreejs: the collision above was merkletreejs'
 * `duplicateOdd` option doing exactly what it says, and the workaround it
 * forced (hand-walking the library's layers, because its own proof extraction
 * drops the self-duplicate sibling for the last leaf of an odd tree) was
 * itself a symptom. An RFC 6962 tree is the ~40 lines below, is a published
 * standard an external auditor can check us against, and removes a dependency
 * whose default behaviour was the bug. `merkletreejs` is no longer imported
 * anywhere in this package.
 *
 * `verifyInclusion` needs only the record and its proof, never the whole
 * table: an auditor with (record, proof, published root) can check membership
 * in O(log n) — that is the point of the proof.
 */
import { createHash } from "node:crypto";
import type { LedgerRecord } from "./chain.js";

/** sha256 over the concatenation of raw byte runs — same primitive the chain uses. */
const sha256 = (...parts: Uint8Array[]): Buffer =>
  createHash("sha256").update(Buffer.concat(parts)).digest();

/**
 * RFC 6962 §2.1 domain-separation prefixes. These are the whole defence
 * against an internal node being replayed as a leaf; they are one byte each
 * and they are not optional.
 */
const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

/**
 * Root of an empty ledger. RFC 6962 defines the Merkle root of an empty tree
 * as SHA-256 of the empty input; we adopt the same convention so an empty dog
 * ledger has a well-defined, auditable root instead of an error. Note this is
 * NOT reachable as any leaf or node hash (both of those have a prefix byte),
 * so "empty" cannot be confused with "contains something".
 */
export const EMPTY_MERKLE_ROOT = sha256().toString("hex");

/** A leaf: SHA256(0x00 || record.hash) over the record's canonical chain hash. */
function leafHash(recordHash: string): Buffer {
  return sha256(LEAF_PREFIX, Buffer.from(recordHash, "hex"));
}

/** An internal node: SHA256(0x01 || left || right). Order is load-bearing. */
function nodeHash(left: Buffer, right: Buffer): Buffer {
  return sha256(NODE_PREFIX, left, right);
}

/**
 * merkleLeafHash: the tree leaf for a record's canonical chain hash, in hex.
 * Exported because it is part of the auditable spec, not an internal detail:
 * an auditor reimplementing verification from RFC 6962 needs to know that our
 * leaf DATA is the chain hash and the leaf HASH is that data with the `0x00`
 * prefix applied. `merkleLeafHash(h) !== h` for every h — that inequality is
 * the domain separation.
 */
export function merkleLeafHash(recordHash: string): string {
  return leafHash(recordHash).toString("hex");
}

/**
 * RFC 6962's split point: the largest power of two strictly less than n
 * (n >= 2). This — not "pair the orphan with itself", not "promote the orphan"
 * — is what makes the tree for n leaves structurally distinct from the tree
 * for n+1 leaves.
 */
function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** MTH over already-hashed leaves. Recursion depth is O(log n). */
function mth(leaves: Buffer[]): Buffer {
  if (leaves.length === 1) return leaves[0];
  const k = splitPoint(leaves.length);
  return nodeHash(mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}

/**
 * RFC 6962's PATH(m, D[n]): the audit path for leaf m, bottom-up. The deeper
 * siblings come back from the recursive call first and the top-level sibling
 * subtree root is appended last, so `siblings[0]` is the leaf's immediate
 * sibling — the order `verifyInclusion` consumes.
 */
function auditPath(leaves: Buffer[], index: number): Buffer[] {
  if (leaves.length === 1) return [];
  const k = splitPoint(leaves.length);
  if (index < k) {
    return [...auditPath(leaves.slice(0, k), index), mth(leaves.slice(k))];
  }
  return [...auditPath(leaves.slice(k), index - k), mth(leaves.slice(0, k))];
}

/** merkleRoot: the Merkle root over the chain entries' canonical hashes. */
export function merkleRoot(records: LedgerRecord[]): string {
  if (records.length === 0) return EMPTY_MERKLE_ROOT;
  return mth(records.map((r) => leafHash(r.hash))).toString("hex");
}

export interface MerkleProof {
  /** The record this proof is for. */
  recordId: string;
  /**
   * The record's canonical chain hash — the leaf DATA committed to the tree.
   * The verifier applies the `0x00` leaf prefix itself; this field is the
   * un-prefixed chain hash so it can be compared directly to `record.hash`.
   */
  leafHash: string;
  /** Leaf position in append order. */
  index: number;
  /**
   * How many leaves the tree had. Required, not decorative: an RFC 6962 tree's
   * shape is a function of (index, leafCount), so the verifier cannot decide
   * left-vs-right at each level without it, and it is what makes `index >=
   * leafCount` — the second position an odd trailing leaf used to occupy —
   * rejectable outright.
   *
   * Honest limitation: `leafCount` is not independently authenticated. Nothing
   * in the tree commits to it, so a lie about it that happens to yield the same
   * traversal (e.g. claiming 4 leaves while proving index 1 of a 3-leaf tree)
   * is not detectable here. That is not a hole, because the `root` comparison
   * still binds the actual contents: the 4-leaf ledger's real root is a
   * different value, so a proof only ever passes against the root of the tree
   * it was genuinely cut from. Treat `leafCount` as "the shape this path
   * describes", and the root as the thing being trusted.
   */
  leafCount: number;
  /** Sibling hashes, bottom-up (hex). Never contains the node itself. */
  siblings: string[];
  /** The root this proof was computed against (hex). */
  root: string;
}

/**
 * merkleProof: inclusion proof for one record of a ledger. Throws if the
 * recordId is not in this ledger.
 *
 * (Historical note for anyone diffing this: there used to be a hand-rolled
 * walk over merkletreejs' layers here, because the library's proof extraction
 * dropped the self-duplicate sibling for the last leaf of an odd-sized tree.
 * With RFC 6962 there are no self-duplicates to drop, so that workaround —
 * and the library — are gone.)
 */
export function merkleProof(records: LedgerRecord[], recordId: string): MerkleProof {
  const index = records.findIndex((r) => r.id === recordId);
  if (index === -1) {
    throw new Error(`merkleProof: no record with id "${recordId}" in this ledger`);
  }
  const leaves = records.map((r) => leafHash(r.hash));
  return {
    recordId,
    leafHash: records[index].hash,
    index,
    leafCount: records.length,
    siblings: auditPath(leaves, index).map((b) => b.toString("hex")),
    root: mth(leaves).toString("hex"),
  };
}

const HASH_RE = /^[0-9a-f]{64}$/;

/**
 * The minimum an auditor must hold about a record to check a proof for it:
 * its id and its canonical chain hash. A full `LedgerRecord` satisfies this
 * structurally, so callers normally just pass the record.
 */
export type ProvenRecord = Pick<LedgerRecord, "id" | "hash">;

/**
 * verifyInclusion: is `record` a leaf of the tree whose root is `root`?
 *
 * What this DOES prove, given a `root` the caller obtained independently (the
 * published daily anchor — INVARIANT 10): that a record with exactly
 * `record.hash` sat at position `proof.index` of a ledger of exactly
 * `proof.leafCount` records when that root was published. Tampering with the
 * leaf, a sibling, the index, the leaf count or the root all make it false.
 *
 * What it does NOT prove, and callers must not assume:
 *   - that `record.hash` is genuinely the hash of `record`'s payload/vet/ts.
 *     That is `verifyChain`'s job; this function takes `record.hash` as the
 *     thing being proven, so an auditor should run both.
 *   - that `root` is the real published root. A proof verifies against
 *     whatever root you hand it; the trust comes from where you got the root.
 *     By the same token `proof.leafCount` is only as trustworthy as that root —
 *     see the note on `MerkleProof.leafCount`.
 *   - anything about `recordId`. The record id is deliberately NOT in the
 *     tree — per INVARIANT 9 the chain hash covers
 *     `hash_prev‖payload‖vet_id‖ts`, not the id — so `proof.recordId` is a
 *     label for humans, checked only for agreement with `record.id`.
 *
 * The reason this takes the record rather than a `recordId` string: the
 * previous signature let the PROOF assert its own leaf↔record binding. It
 * validated `proof.leafHash` against `/^[0-9a-f]{64}$/` and compared
 * `proof.recordId` to a caller-supplied id, so nothing tied the 32 bytes being
 * proven to any real record — combined with the missing domain separation,
 * that is what made the forged-internal-node proof above pass. Requiring the
 * record means the binding is checked against data the auditor already holds
 * and the attacker does not supply.
 */
export function verifyInclusion(
  record: ProvenRecord,
  proof: MerkleProof,
  root: string,
): boolean {
  // The binding an attacker must not be able to assert for themselves.
  if (proof.recordId !== record.id) return false;
  if (proof.leafHash !== record.hash) return false;
  if (proof.root !== root) return false;
  if (!HASH_RE.test(proof.leafHash) || !HASH_RE.test(root)) return false;
  if (!Number.isInteger(proof.index) || !Number.isInteger(proof.leafCount)) return false;
  if (proof.leafCount < 1 || proof.index < 0 || proof.index >= proof.leafCount) return false;
  if (proof.siblings.some((s) => !HASH_RE.test(s))) return false;

  // RFC 6962 §2.1.1 audit-path verification. `fn` tracks the leaf's position
  // within the current subtree and `sn` the last position in it; when LSB(fn)
  // is set the sibling is on the left, and `fn === sn` is the "rightmost node
  // of a subtree that is shallower than a full one" case — the case an
  // odd-node-duplicating tree fudges by hashing the node with itself.
  let fn = proof.index;
  let sn = proof.leafCount - 1;
  let hash = leafHash(proof.leafHash);
  for (const sibling of proof.siblings) {
    // sn === 0 means we already collapsed to the root; a further sibling means
    // the path is longer than this tree can be, i.e. an over-specified proof.
    if (sn === 0) return false;
    const sib = Buffer.from(sibling, "hex");
    if (fn % 2 === 1 || fn === sn) {
      hash = nodeHash(sib, hash);
      if (fn % 2 === 0) {
        while (fn !== 0 && fn % 2 === 0) {
          fn >>>= 1;
          sn >>>= 1;
        }
      }
    } else {
      hash = nodeHash(hash, sib);
    }
    fn >>>= 1;
    sn >>>= 1;
  }
  // sn !== 0 means the path stopped short of the root (an under-specified
  // proof), which must fail even if the partial hash happens to look right.
  return sn === 0 && hash.toString("hex") === root;
}
