/**
 * StrayNet tamper-evident medical ledger — INVARIANT 9: every record hash is
 * SHA-256 over a LENGTH-PREFIXED concatenation, so field boundaries are
 * unambiguous and concatenation collisions are impossible.
 */
import { createHash } from "node:crypto";

export interface LedgerRecord {
  id: string;
  prev: string;
  payload: Record<string, unknown>;
  vetId: string;
  ts: string;
  hash: string;
}

export type LedgerPayload = Record<string, unknown>;

/** Genesis block has no predecessor: all-zero 256-bit hash. */
export const GENESIS_PREV_HASH = "0".repeat(64);

/** Stable, whitespace-free JSON: object keys sorted recursively. */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, (v as Record<string, unknown>)[k]]),
    );
  }) as string;
}

/** canonicalPayload(record): deterministic serialization of a record payload. */
export function canonicalPayload(payload: LedgerPayload): string {
  return canonicalJSON(payload);
}

/**
 * hashInput(prevHash, payload, vetId, ts) — the exact bytes fed to SHA-256:
 *   len(prev)||prev || len(payload)||payload || len(vetId)||vetId || len(ts)||ts
 * Each length is a 4-byte big-endian prefix, so "ab"+"c" and "a"+"bc" can never
 * produce the same input (INVARIANT 9).
 */
export function hashInput(
  prevHash: string,
  payload: string,
  vetId: string,
  ts: string,
): Buffer {
  const parts: Buffer[] = [];
  for (const field of [prevHash, payload, vetId, ts]) {
    const bytes = Buffer.from(field, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(bytes.length, 0);
    parts.push(len, bytes);
  }
  return Buffer.concat(parts);
}

/** computeHash: hex SHA-256 of hashInput over the canonical payload. */
export function computeHash(
  prevHash: string,
  payload: LedgerPayload | string,
  vetId: string,
  ts: string,
): string {
  const canonical = typeof payload === "string" ? payload : canonicalPayload(payload);
  return createHash("sha256").update(hashInput(prevHash, canonical, vetId, ts)).digest("hex");
}

/** recomputeHead: hash the head would have if the whole chain were re-seeded. */
export function recomputeHead(records: LedgerRecord[]): string {
  let prev = GENESIS_PREV_HASH;
  for (const r of records) prev = computeHash(prev, r.payload, r.vetId, r.ts);
  return prev;
}

export interface VerifyResult {
  valid: boolean;
  brokenAt?: number;
  records: LedgerRecord[];
}

/**
 * verifyChain: checks prev-link continuity and every stored hash. Returns the
 * index of the first record that fails (0-based), or valid=true.
 */
export function verifyChain(records: LedgerRecord[]): VerifyResult {
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const expectedPrev = i === 0 ? GENESIS_PREV_HASH : records[i - 1].hash;
    if (r.prev !== expectedPrev) {
      return { valid: false, brokenAt: i, records };
    }
    const expectedHash = computeHash(expectedPrev, r.payload, r.vetId, r.ts);
    if (r.hash !== expectedHash) {
      return { valid: false, brokenAt: i, records };
    }
  }
  return { valid: true, records };
}
