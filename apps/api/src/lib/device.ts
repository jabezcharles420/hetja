/**
 * Anonymous attested device tokens — INVARIANT 6: every anonymous write is
 * rate-limited by the device token (never by bare phone/IP).
 *
 * Token format: `<base64url(deviceId)>.<base64url(HMAC(secret, deviceId))>`
 * so attestation is stateless and self-contained. `deviceId` is a random UUID.
 *
 * Desktop-web fallback: proof-of-work, issued and verified with ALTCHA
 * (altcha-lib v2, algorithm `SHA-256`). The server issues a signed challenge
 * ({ parameters, signature } where `parameters.keyPrefix` encodes the required
 * leading-zero-bit difficulty); the client brute-forces a counter whose derived
 * key starts with that prefix. `verifySolution` recomputes the challenge HMAC
 * and re-derives the key, so the challenge is self-authenticating and
 * tamper-proof. Single-use is enforced separately by the route via a server-side
 * spent-challenge registry (see routes/devices.ts).
 */
import { createChallenge, solveChallenge, verifySolution, type Challenge, type Solution } from "altcha-lib";
import { deriveKey as sha256DeriveKey } from "altcha-lib/algorithms/sha";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export function issueDeviceToken(secret: string): string {
  const deviceId = randomUUID();
  const sig = createHmac("sha256", secret).update(deviceId).digest("base64url");
  return `${Buffer.from(deviceId).toString("base64url")}.${sig}`;
}

export function verifyDeviceToken(token: string, secret: string): boolean {
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const deviceIdPart = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret)
    .update(Buffer.from(deviceIdPart, "base64url"))
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** ALTCHA v2 PoW algorithm this flow uses — plain SHA-256, solvable in any
 * Web Crypto environment (desktop-web fallback; no Argon2/scrypt here, which
 * need native bindings the browser fallback cannot rely on). */
export const POW_ALGORITHM = "SHA-256";

export const POW_KEY_LENGTH = 32;

/** ALTCHA encodes difficulty as a hex key prefix, whose granularity is a
 * nibble (4 bits). Effective difficulty therefore rounds the configured
 * bit count UP to the next nibble boundary, so the required work is never
 * below what DEVICE_POW_DIFFICULTY asked for. Reported to clients as the
 * real number of leading zero bits the solver must produce. */
export function effectivePowDifficulty(difficulty: number): number {
  return Math.ceil(difficulty / 4) * 4;
}

/** Hex prefix the derived key must start with for `difficulty` bits. */
export function keyPrefixForDifficulty(difficulty: number): string {
  return "0".repeat(effectivePowDifficulty(difficulty) / 4);
}

/** Issues a fresh ALTCHA v2 challenge. Each call draws a new random nonce +
 * salt, so no two challenges are ever equal — a prerequisite for the
 * single-use registry in routes/devices.ts. */
export async function createPoWChallenge(secret: string, difficulty: number, ttlMs: number): Promise<Challenge> {
  return createChallenge({
    algorithm: POW_ALGORITHM,
    cost: 1,
    keyLength: POW_KEY_LENGTH,
    keyPrefix: keyPrefixForDifficulty(difficulty),
    deriveKey: sha256DeriveKey,
    hmacSignatureSecret: secret,
    expiresAt: Math.floor(Date.now() / 1000) + Math.floor(ttlMs / 1000),
  });
}

export interface PoWVerifyResult {
  verified: boolean;
  expired: boolean;
  badSignature: boolean;
  badSolution: boolean;
}

/** Verifies an ALTCHA solution against the issued challenge: recomputes the
 * challenge HMAC (tamper check) and re-derives the key from the submitted
 * counter (PoW check), in that order, plus expiry. Does NOT enforce
 * single-use — the route does that atomically after a successful verify. */
export async function verifyPoW(challenge: Challenge, solution: Solution, secret: string): Promise<PoWVerifyResult> {
  const result = await verifySolution({
    challenge,
    solution,
    deriveKey: sha256DeriveKey,
    hmacSignatureSecret: secret,
  });
  return {
    verified: result.verified,
    expired: result.expired,
    badSignature: result.invalidSignature === true,
    badSolution: result.invalidSolution === true,
  };
}

/** Server-side solver (used by tests to drive the HTTP flow end to end with
 * the exact algorithm the client implements). The browser fallback in
 * apps/scan re-implements this with Web Crypto and yields between batches. */
export async function solvePoW(challenge: Challenge): Promise<Solution | null> {
  return solveChallenge({ challenge, deriveKey: sha256DeriveKey });
}
