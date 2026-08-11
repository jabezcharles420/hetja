/**
 * Anonymous attested device tokens — INVARIANT 6: every anonymous write is
 * rate-limited by the device token (never by bare phone/IP).
 *
 * Token format: `<base64url(deviceId)>.<base64url(HMAC(secret, deviceId))>`
 * so attestation is stateless and self-contained. `deviceId` is a random UUID.
 *
 * Desktop-web fallback: proof-of-work. The server issues a challenge; the
 * client returns a nonce whose SHA-256 digest starts with N zero bits
 * (N = DEVICE_POW_DIFFICULTY). Verified before minting the attested token.
 */
import { createHmac, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

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

export function createPoWChallenge(): string {
  return randomBytes(16).toString("base64url");
}

/** True when SHA-256(challenge + nonce) starts with `difficulty` zero bits. */
export function verifyPoW(challenge: string, nonce: string, difficulty: number): boolean {
  const digest = createHash("sha256")
    .update(`${challenge}${nonce}`)
    .digest();
  if (difficulty > digest.length * 8) return false;
  const fullBytes = Math.floor(difficulty / 8);
  for (let i = 0; i < fullBytes; i++) {
    if (digest[i] !== 0) return false;
  }
  const remaining = difficulty % 8;
  if (remaining > 0) {
    const mask = (1 << remaining) - 1;
    if ((digest[fullBytes] & ~mask) !== 0) return false;
  }
  return true;
}

export interface PoWSolution {
  nonce: string;
  iterations: number;
}

/** Brute-force a nonce with `difficulty` leading zero bits (desktop fallback). */
export function solvePoW(challenge: string, difficulty: number, maxIterations = 20_000_000): PoWSolution | null {
  for (let i = 0; i < maxIterations; i++) {
    const nonce = String(i);
    if (verifyPoW(challenge, nonce, difficulty)) return { nonce, iterations: i };
  }
  return null;
}
