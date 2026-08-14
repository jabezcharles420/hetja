/**
 * Anonymous attested device tokens — INVARIANT 6: every anonymous write is
 * rate-limited by the device token (never by bare phone/IP).
 *
 * Token format: `<base64url(deviceId)>.<base64url(HMAC(secret, deviceId))>`
 * so attestation is stateless and self-contained. `deviceId` is a random UUID.
 *
 * The token string is a *transport* encoding, never an identity. Callers that
 * need a rate-limit subject must use `deviceTokenSubject()`, which returns the
 * `deviceId` the token attests. Keying a limit on the submitted string instead
 * was a real, verified INVARIANT 7 bypass: `Buffer.from(s, "base64url")`
 * silently discards every character outside the base64 alphabet — padding,
 * newlines, `!`, spaces, tabs — so `tok`, `tok=`, `tok==`, `tok\n` and `tok!`
 * all decode to the same bytes, recompute the same HMAC, and used to all
 * verify. Each was a distinct `scans.device_token` value, so one
 * proof-of-work solve bought an unbounded number of fresh 2/day + 5/week
 * budgets at zero marginal cost, and each report paged real responders'
 * phones. `deviceTokenSubject()` closes both halves: it rejects non-canonical
 * encodings outright, and it hands callers one canonical name per device.
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

/**
 * Authenticates a device token and returns the canonical `deviceId` it
 * attests — the value every INVARIANT 6/7 rate limit must key on — or `null`
 * if the token was not minted by `issueDeviceToken` with this secret.
 *
 * Three checks, in order:
 *
 * 1. **Canonical encoding.** The decoded bytes are re-encoded and must
 *    round-trip to exactly the submitted `deviceIdPart`. This is the load-
 *    bearing one, and it is not about malformed input: Node's base64 decoder
 *    ignores non-alphabet characters and padding, so a token and its padded /
 *    whitespace-appended / punctuation-appended variants all decode to the
 *    *same* bytes and therefore produce the *same* HMAC. Without this check
 *    they all verify while remaining distinct strings, which is precisely what
 *    turned one PoW solve into unlimited SOS budget (see the module header).
 *    Node never emits `=` padding for `base64url`, so the round-trip rejects
 *    padded forms too.
 * 2. **UTF-8 canonical.** A `deviceId` we minted is an ASCII UUID, so decoding
 *    to UTF-8 and re-encoding is lossless. Requiring that closes the same
 *    many-to-one door at the byte→string boundary that check 1 closes at the
 *    string→byte boundary, so the returned subject is a faithful name for
 *    exactly one token.
 * 3. **HMAC**, constant-time, over the decoded bytes.
 */
export function deviceTokenSubject(token: string, secret: string): string | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const deviceIdPart = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const decoded = Buffer.from(deviceIdPart, "base64url");
  if (decoded.length === 0) return null;
  if (decoded.toString("base64url") !== deviceIdPart) return null;

  const deviceId = decoded.toString("utf8");
  if (!Buffer.from(deviceId, "utf8").equals(decoded)) return null;

  const expected = createHmac("sha256", secret).update(decoded).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return deviceId;
}

/**
 * Boolean form, for callers that only gate on attestation and never use the
 * token as an identity (auth.ts's OTP verify). Deliberately delegates to
 * `deviceTokenSubject` so there is exactly one implementation of what "a valid
 * device token" means — a second, laxer copy here is how the non-canonical
 * bypass would come back.
 */
export function verifyDeviceToken(token: string, secret: string): boolean {
  return deviceTokenSubject(token, secret) !== null;
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
