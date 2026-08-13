/**
 * Hetja ledger Merkle inclusion proofs — enhancement stack §D.1 (Phase 1, pick 15).
 *
 * On every append the caller builds a Merkle tree over the chain entries and
 * persists the root next to the chain head. The leaf of each record is the
 * SAME canonical per-record hash the hash chain already commits to
 * (`LedgerRecord.hash`, hex SHA-256), so the Merkle tree and the chain always
 * agree: a record that fails `verifyChain` can never be proven into the tree,
 * and a proof only ever certifies a hash the chain itself produces.
 *
 * Tree shape (must match on every rebuild, so roots are deterministic):
 *   - leaves are the raw 32 bytes of each record hash, in append order;
 *   - `duplicateOdd` — an odd node is paired with itself;
 *   - pairs are hashed left-then-right in position order, so the proof's
 *     `index` is load-bearing: relabel a leaf's position and the path no
 *     longer recomputes to the root.
 *
 * `verifyInclusion` needs only the record's proof, never the whole table:
 * an auditor with (record, proof, published root) can check membership in
 * O(log n) — that is the point of the proof.
 */
import { createHash } from "node:crypto";
import { MerkleTree } from "merkletreejs";
import type { LedgerRecord } from "./chain.js";

/** sha256 over raw bytes — same primitive the hash chain uses. */
const sha256 = (data: Uint8Array): Buffer => createHash("sha256").update(data).digest();

/**
 * Root of an empty ledger. RFC 6962 (Certificate Transparency) defines the
 * Merkle root of an empty tree as SHA-256 of the empty input; we adopt the
 * same convention so an empty dog ledger has a well-defined, auditable root
 * instead of an error.
 */
export const EMPTY_MERKLE_ROOT = sha256(Buffer.alloc(0)).toString("hex");

/** Normalize merkletreejs' "0x"-prefixed hex output to bare hex like the chain. */
function bareHex(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

/** A record's canonical chain hash is the Merkle leaf — chain and tree agree. */
function leafOf(record: LedgerRecord): Buffer {
  return Buffer.from(record.hash, "hex");
}

function buildTree(records: LedgerRecord[]): MerkleTree {
  return new MerkleTree(records.map(leafOf), sha256, { duplicateOdd: true });
}

/** merkleRoot: the Merkle root over the chain entries' canonical hashes. */
export function merkleRoot(records: LedgerRecord[]): string {
  if (records.length === 0) return EMPTY_MERKLE_ROOT;
  return bareHex(buildTree(records).getHexRoot());
}

export interface MerkleProof {
  /** The record this proof is for. */
  recordId: string;
  /** The record's canonical chain hash — the leaf committed to the tree. */
  leafHash: string;
  /** Leaf position in append order. */
  index: number;
  /** Sibling hashes, bottom-up (hex). For an odd duplicate the sibling is the node itself. */
  siblings: string[];
  /** The root this proof was computed against (hex). */
  root: string;
}

/**
 * merkleProof: inclusion proof for one record of a ledger. Throws if the
 * recordId is not in this ledger. merkletreejs builds the tree and supplies
 * the layers; we walk them ourselves because the library's own proof
 * extraction drops the self-duplicate sibling for the last leaf of an
 * odd-sized tree, which would make that record unverifiable.
 */
export function merkleProof(records: LedgerRecord[], recordId: string): MerkleProof {
  const index = records.findIndex((r) => r.id === recordId);
  if (index === -1) {
    throw new Error(`merkleProof: no record with id "${recordId}" in this ledger`);
  }
  const tree = buildTree(records);
  const root = bareHex(tree.getHexRoot());
  const layers = tree.getLayers();

  const siblings: string[] = [];
  let j = index;
  for (let level = 0; level < layers.length - 1; level++) {
    const layer = layers[level];
    // Right sibling for an even position; left for odd. An odd-length layer
    // duplicates its last node, so the last even position's sibling is itself.
    const pairIndex = j % 2 === 0 ? Math.min(j + 1, layer.length - 1) : j - 1;
    siblings.push(layer[pairIndex].toString("hex"));
    j = Math.floor(j / 2);
  }

  return { recordId, leafHash: records[index].hash, index, siblings, root };
}

const HASH_RE = /^[0-9a-f]{64}$/;

/**
 * verifyInclusion: does `recordId`'s proof commit to `root`? Pure — needs only
 * the proof, not the ledger table. False for a tampered proof, a foreign proof
 * (computed against a different root), or a recordId that does not match the
 * proof.
 */
export function verifyInclusion(recordId: string, proof: MerkleProof, root: string): boolean {
  if (proof.recordId !== recordId) return false;
  if (proof.root !== root) return false;
  if (!HASH_RE.test(proof.leafHash) || !HASH_RE.test(root)) return false;
  if (!Number.isInteger(proof.index) || proof.index < 0) return false;
  // With `siblings.length` merges the path must reach the root exactly:
  // the position bit-width is 2^siblings.length, so an index at or beyond it
  // means the proof is under-specified (never collapses to a single node).
  if (proof.index >= 2 ** proof.siblings.length) return false;
  if (proof.siblings.some((s) => !HASH_RE.test(s))) return false;

  let hash: Buffer = Buffer.from(proof.leafHash, "hex");
  let position = proof.index;
  for (const sibling of proof.siblings) {
    const sib = Buffer.from(sibling, "hex");
    hash =
      position % 2 === 0
        ? sha256(Buffer.concat([hash, sib]))
        : sha256(Buffer.concat([sib, hash]));
    position = Math.floor(position / 2);
  }
  return hash.toString("hex") === root;
}
