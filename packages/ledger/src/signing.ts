/**
 * Hetja signed chain head — enhancement stack §D.1 (Phase 1, pick 16).
 *
 * The chain head alone proves nothing about the party that computed it
 * (INVARIANT 10: tamper-evidence only begins once the head is published
 * somewhere the operator does not solely control). Signing the head with a
 * per-vet Ed25519 key adds an accountable, non-repudiable statement:
 * "this vet's ledger stood at this head, Merkle root and record count at
 * this time".
 *
 * Keys are standard RFC 7517 JWKs, so the public half can be published on a
 * JWKS endpoint later — `did:web:hetja.in:vets/<vetId>` (see `jwks()`).
 * Signatures are JWS compact serialization (EdDSA / Ed25519), verifiable by
 * any JOSE library, not just this one.
 *
 * The package takes plain parameters (no ambient env), so a caller either
 * generates a pair with `generateLedgerKeyPair()` or passes an existing key
 * (a JWK object, or any jose `KeyInput` — e.g. imported from PEM via
 * `importSPKI`/`importPKCS8`). The application layer decides where the pair
 * comes from (env, secrets manager, …).
 */
import {
  SignJWT,
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importJWK,
  jwtVerify,
  type JWK,
  type JWTHeaderParameters,
  type KeyInput,
} from "jose";
import { recomputeHead, type LedgerRecord } from "./chain.js";
import { merkleRoot } from "./merkle.js";

/** JWS algorithm for Ed25519 — the only alg we sign or accept. */
export const SIGNING_ALG = "EdDSA";

/** Prefix for the vet identity — JWKS endpoint: did:web:hetja.in:vets/<id>. */
export const VET_DID_PREFIX = "did:web:hetja.in:vets";

/** vetDid: the did:web identifier carried in the signed head's `sub`. */
export function vetDid(vetId: string): string {
  return `${VET_DID_PREFIX}/${vetId}`;
}

/** ChainHead: the three numbers the signed head commits to. */
export interface ChainHead {
  /** recomputeHead(records) — the hash chain's current head. */
  head: string;
  /** merkleRoot(records) — Merkle root over every record hash. */
  merkleRoot: string;
  /** records.length — how many records the head covers. */
  recordCount: number;
}

/** chainHead: derive the signed payload directly from a dog's ledger. */
export function chainHead(records: LedgerRecord[]): ChainHead {
  return {
    head: recomputeHead(records),
    merkleRoot: merkleRoot(records),
    recordCount: records.length,
  };
}

export interface LedgerKeyPair {
  /** Public half — safe to publish (the JWKS document). */
  publicJwk: JWK;
  /** Private half — server-side secret, never leaves the operator. */
  privateJwk: JWK;
  /** RFC 7638 thumbprint of the public JWK — the `kid` for the JWKS endpoint. */
  kid: string;
}

/**
 * generateLedgerKeyPair: fresh Ed25519 pair, extractable so both halves can
 * be exported as JWKs and persisted by the caller.
 */
export async function generateLedgerKeyPair(): Promise<LedgerKeyPair> {
  const { publicKey, privateKey } = await generateKeyPair("Ed25519", {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  return { publicJwk, privateJwk, kid };
}

export interface SignChainHeadOptions {
  /** The vet the head belongs to — becomes `sub: did:web:hetja.in:vets/<vetId>`. */
  vetId: string;
  /** Optional key id for the JWS header; pass `LedgerKeyPair.kid` to match the JWKS. */
  kid?: string;
}

/** signChainHead: compact JWS over the chain head (+ Merkle root + count). */
export async function signChainHead(
  head: ChainHead,
  privateKey: KeyInput,
  options: SignChainHeadOptions,
): Promise<string> {
  const protectedHeader: JWTHeaderParameters = { alg: SIGNING_ALG };
  if (options.kid !== undefined) protectedHeader.kid = options.kid;
  return new SignJWT({
    head: head.head,
    merkleRoot: head.merkleRoot,
    recordCount: head.recordCount,
  })
    .setProtectedHeader(protectedHeader)
    .setSubject(vetDid(options.vetId))
    .setIssuedAt()
    .sign(privateKey);
}

/** SignedChainHead: a verified signature's claims, decoded for the caller. */
export interface SignedChainHead extends ChainHead {
  /** The vet parsed from `sub` — did:web:hetja.in:vets/<vetId>. */
  vetId: string;
  /** Issued-at epoch seconds, if present. */
  issuedAt?: number;
  /** Key id from the JWS header, if present. */
  kid?: string;
}

/**
 * verifyChainHead: check the signature, decode the claims, and confirm they
 * are a well-formed signed chain head. Returns null on any failure —
 * bad signature, wrong key, foreign alg, malformed claims — never throws.
 */
export async function verifyChainHead(
  token: string,
  publicKey: KeyInput,
): Promise<SignedChainHead | null> {
  try {
    const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
      algorithms: [SIGNING_ALG],
    });
    const { head, merkleRoot: merkle, recordCount, sub, iat, kid } = payload as Record<
      string,
      unknown
    >;
    if (typeof head !== "string" || typeof merkle !== "string") return null;
    if (typeof recordCount !== "number" || !Number.isInteger(recordCount)) return null;
    if (typeof sub !== "string" || !sub.startsWith(`${VET_DID_PREFIX}/`)) return null;
    return {
      head,
      merkleRoot: merkle,
      recordCount,
      vetId: sub.slice(VET_DID_PREFIX.length + 1),
      issuedAt: typeof iat === "number" ? iat : undefined,
      kid: typeof kid === "string" ? kid : protectedHeader.kid,
    };
  } catch {
    return null;
  }
}

/**
 * jwks: the RFC 7517 document for a future JWKS endpoint at
 * `did:web:hetja.in:vets/<vetId>/.well-known/jwks.json`. Publish only the
 * public half; the endpoint is what lets an auditor fetch the key that
 * `kid` in the signed head refers to.
 */
export function jwks(publicJwk: JWK, kid: string): { keys: JWK[] } {
  return { keys: [{ ...publicJwk, kid, use: "sig", alg: SIGNING_ALG }] };
}
