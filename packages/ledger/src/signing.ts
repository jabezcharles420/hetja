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
 * Two properties the first version of this file did not have, and which the
 * "this vet's ledger stood at…" sentence above is meaningless without:
 *
 *   - **The token names its ledger.** The claims used to be
 *     `{head, merkleRoot, recordCount}` with no ledger identifier at all, so a
 *     token was only ever a statement about *some* ledger of that vet. A vet
 *     treating dog A's signed head as dog B's, or replaying an old ledger's
 *     head against a different one, was not detectable from the token.
 *     `ledger` is now a signed claim and `verifyChainHead` REQUIRES the caller
 *     to say which ledger it is asking about.
 *   - **The token expires.** It used to carry only `iat`, and verification
 *     never looked at it — so a head signed at record 40 verified cleanly,
 *     forever, as a current attestation of a ledger that was on record 55.
 *     A published head that never goes stale defeats the purpose of publishing
 *     it (INVARIANT 10): the whole mechanism is "compare today's ledger
 *     against a recent independently-held anchor", and an unbounded-lifetime
 *     token lets the operator answer with an old, still-valid one. Every token
 *     now carries `exp`, verification rejects a missing `exp` outright, and the
 *     caller can demand something tighter than the default TTL via
 *     `maxAgeSeconds`.
 *
 * Note on JWT semantics, since it reads slightly oddly: strictly the vet is
 * the *issuer* of this statement and the ledger is its *subject*. `sub` holds
 * the vet's did:web anyway, because that identifier is the published
 * `did:web:hetja.in:vets/<vetId>` story and the JWKS lookup path — churning it
 * would break the thing it exists for. The ledger therefore gets an explicit
 * `ledger` claim rather than displacing `sub`.
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

/** ChainHead: what the signed head commits to — which ledger, and where it stood. */
export interface ChainHead {
  /**
   * Which ledger this is a statement about — the dog's identifier (slug/id;
   * INVARIANT 1 makes it random and non-sequential, so it is safe to sign and
   * publish). Not derivable from the records themselves, which is why
   * `chainHead` takes it: a `LedgerRecord` knows its vet, not its dog.
   */
  ledgerId: string;
  /** recomputeHead(records) — the hash chain's current head. */
  head: string;
  /** merkleRoot(records) — Merkle root over every record hash. */
  merkleRoot: string;
  /** records.length — how many records the head covers. */
  recordCount: number;
}

/** chainHead: derive the signed payload directly from a dog's ledger. */
export function chainHead(ledgerId: string, records: LedgerRecord[]): ChainHead {
  return {
    ledgerId,
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

/**
 * Default token lifetime, in seconds. INVARIANT 10 publishes the head daily,
 * so a signed head is expected to be superseded within 24 h; 48 h is two
 * publish cycles, which tolerates one missed anchor run without making a
 * months-old attestation presentable as current. Callers that need tighter
 * freshness than "some time in the last two days" should not lower this —
 * they should pass `maxAgeSeconds` on verify, which is the side of the
 * exchange that actually cares.
 */
export const DEFAULT_HEAD_TTL_SECONDS = 48 * 60 * 60;

/**
 * Clock skew allowance between the signing worker and a verifying auditor.
 * Small relative to a daily anchor, and large enough that two machines a few
 * seconds apart do not produce a spurious "expired".
 */
const CLOCK_TOLERANCE_SECONDS = 5;

export interface SignChainHeadOptions {
  /** The vet the head belongs to — becomes `sub: did:web:hetja.in:vets/<vetId>`. */
  vetId: string;
  /** Optional key id for the JWS header; pass `LedgerKeyPair.kid` to match the JWKS. */
  kid?: string;
  /**
   * Lifetime in seconds; defaults to `DEFAULT_HEAD_TTL_SECONDS`. Sets `exp`,
   * which is never omitted — an attestation of "where the ledger stood" with
   * no end date is a claim about the present that stays true forever.
   */
  ttlSeconds?: number;
  /**
   * Epoch seconds to stamp as `iat` (and to measure `exp` from); defaults to
   * now. Provided so the daily anchor job can attest a head *as of* the
   * anchor's own timestamp rather than the moment the signature happened to be
   * computed — the two differ if a run is retried.
   */
  issuedAt?: number;
}

/** signChainHead: compact JWS over the chain head (ledger id, head, root, count). */
export async function signChainHead(
  head: ChainHead,
  privateKey: KeyInput,
  options: SignChainHeadOptions,
): Promise<string> {
  const protectedHeader: JWTHeaderParameters = { alg: SIGNING_ALG };
  if (options.kid !== undefined) protectedHeader.kid = options.kid;
  const issuedAt = options.issuedAt ?? Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds ?? DEFAULT_HEAD_TTL_SECONDS;
  return new SignJWT({
    ledger: head.ledgerId,
    head: head.head,
    merkleRoot: head.merkleRoot,
    recordCount: head.recordCount,
  })
    .setProtectedHeader(protectedHeader)
    .setSubject(vetDid(options.vetId))
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttl)
    .sign(privateKey);
}

/** SignedChainHead: a verified signature's claims, decoded for the caller. */
export interface SignedChainHead extends ChainHead {
  /** The vet parsed from `sub` — did:web:hetja.in:vets/<vetId>. */
  vetId: string;
  /** Issued-at epoch seconds. Always present: verification rejects a token without it. */
  issuedAt: number;
  /** Expiry epoch seconds. Always present: verification rejects a token without it. */
  expiresAt: number;
  /**
   * Key id from the JWS *protected header*, if present. Taken from the header
   * and nowhere else: RFC 7515 puts `kid` in the header, and a token carrying a
   * `kid` claim in its payload would otherwise shadow the real one for a caller
   * doing a JWKS lookup — i.e. point them at a different key than the one the
   * signature was actually made with. A payload `kid` is ignored outright.
   */
  kid?: string;
}

export interface VerifyChainHeadOptions {
  /**
   * Which ledger the caller is asking about. REQUIRED, deliberately: the point
   * of the `ledger` claim is that "is this head for the ledger in front of me?"
   * cannot be a question the caller forgets to ask. A token for ledger A
   * returns null when checked as ledger B.
   */
  ledgerId: string;
  /**
   * Reject a token issued more than this many seconds ago. Defaults to
   * `DEFAULT_HEAD_TTL_SECONDS` — the same window the default TTL allows, so
   * the default costs nothing but means a token signed with a longer custom
   * TTL still has to argue for itself. Pass something smaller when the caller
   * needs a genuinely current head (e.g. 3600 for "signed within the hour").
   */
  maxAgeSeconds?: number;
}

/**
 * verifyChainHead: check the signature, decode the claims, and confirm they
 * are a well-formed, still-current signed chain head FOR THE REQUESTED LEDGER.
 * Returns null on any failure — bad signature, wrong key, foreign alg,
 * malformed claims, wrong ledger, expired, or older than `maxAgeSeconds` —
 * never throws.
 *
 * A non-null result means: this key's holder stated that ledger
 * `options.ledgerId` stood at this head / root / count, recently enough to
 * still count. Comparing those values against the ledger the caller actually
 * has is still the caller's job — the signature says who claimed what, not
 * whether it matches today's database.
 */
export async function verifyChainHead(
  token: string,
  publicKey: KeyInput,
  options: VerifyChainHeadOptions,
): Promise<SignedChainHead | null> {
  try {
    const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
      algorithms: [SIGNING_ALG],
      // `exp` is enforced by jose; `maxTokenAge` is the caller's own, tighter
      // freshness bound and additionally makes `iat` mandatory.
      maxTokenAge: options.maxAgeSeconds ?? DEFAULT_HEAD_TTL_SECONDS,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    });
    const { ledger, head, merkleRoot: merkle, recordCount, sub, iat, exp } = payload as Record<
      string,
      unknown
    >;
    if (typeof head !== "string" || typeof merkle !== "string") return null;
    if (typeof recordCount !== "number" || !Number.isInteger(recordCount)) return null;
    if (typeof sub !== "string" || !sub.startsWith(`${VET_DID_PREFIX}/`)) return null;
    // A head that does not name its ledger, or names a different one, is not a
    // statement about the ledger we were asked about — regardless of signature.
    if (typeof ledger !== "string" || ledger !== options.ledgerId) return null;
    // A token with no explicit expiry is not a well-formed Hetja signed head:
    // jose can only enforce `exp` when it is there, so its absence is rejected
    // here rather than silently treated as "never expires".
    if (typeof iat !== "number" || typeof exp !== "number") return null;
    return {
      ledgerId: ledger,
      head,
      merkleRoot: merkle,
      recordCount,
      vetId: sub.slice(VET_DID_PREFIX.length + 1),
      issuedAt: iat,
      expiresAt: exp,
      kid: protectedHeader.kid,
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
