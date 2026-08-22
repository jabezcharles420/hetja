/**
 * Minimal HS256 JWT implementation (no runtime deps) — access tokens (15m)
 * and rotating refresh tokens (30d). Refresh rotation mints a fresh `jti` on
 * every issuance; `type` is embedded so tokens can't be used across scopes.
 *
 * The jti alone was never enough: until migration 0017 nothing recorded
 * issuance, so rotation could not be one-time-use and a replayed token was
 * undetectable for its whole 30-day life. The refresh_tokens table (see the
 * migration) is now the consumer: every minted refresh token's jti is stored
 * at issue time, POST /auth/refresh exchanges a row exactly once via a
 * conditional UPDATE, and any presentation of an already-used or unknown jti
 * is treated as theft and revokes every live token that feeder holds.
 * routes/auth.ts owns those rules.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const HEADER = { alg: "HS256", typ: "JWT" };

const b64url = (value: string): string =>
  Buffer.from(value).toString("base64url");

const fromB64url = (value: string): string =>
  Buffer.from(value, "base64url").toString("utf8");

export interface JwtPayload {
  sub: string;
  type: "access" | "refresh";
  iat: number;
  exp: number;
  jti: string;
  [key: string]: unknown;
}

export function parseTtl(ttl: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(ttl);
  if (!match) throw new Error(`invalid TTL: ${ttl}`);
  const value = Number(match[1]);
  const unit = match[2];
  const seconds = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  if (!seconds) throw new Error(`invalid TTL: ${ttl}`);
  return value * seconds;
}

function signToken(payload: Record<string, unknown>, secret: string, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const body = {
    ...payload,
    iat: now,
    exp: now + ttlSeconds,
    jti: randomUUID(),
  };
  const header = b64url(JSON.stringify(HEADER));
  const payloadPart = b64url(JSON.stringify(body));
  const sig = createHmac("sha256", secret).update(`${header}.${payloadPart}`).digest("base64url");
  return `${header}.${payloadPart}.${sig}`;
}

export function signAccessToken(sub: string, secret: string, ttl: string): string {
  return signToken({ sub, type: "access" }, secret, parseTtl(ttl));
}

export function signRefreshToken(sub: string, secret: string, ttl: string): string {
  return signToken({ sub, type: "refresh" }, secret, parseTtl(ttl));
}

export class JwtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwtError";
  }
}

export function verifyToken(token: string, secret: string, expectedType: "access" | "refresh"): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("malformed token");
  const [headerPart, payloadPart, sig] = parts;
  const expectedSig = createHmac("sha256", secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest("base64url");
  // `timingSafeEqual`, not `Buffer.equals`, for the same reason lib/hmac.ts and
  // lib/device.ts already use it: `equals` short-circuits on the first differing
  // byte, so how long a rejection takes leaks how much of a forged signature was
  // correct. This is the primitive that gates every authenticated route, and it
  // was the one place in the codebase still comparing with a variable-time
  // method. The length check stays because timingSafeEqual throws on a mismatch.
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new JwtError("bad signature");

  let payload: JwtPayload;
  try {
    payload = JSON.parse(fromB64url(payloadPart)) as JwtPayload;
  } catch {
    throw new JwtError("bad payload");
  }
  const header = JSON.parse(fromB64url(headerPart)) as { alg?: string };
  if (header.alg !== "HS256") throw new JwtError("unexpected alg");
  if (payload.type !== expectedType) throw new JwtError("token type mismatch");
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) {
    throw new JwtError("token expired");
  }
  return payload;
}

export const verifyAccessToken = (token: string, secret: string): JwtPayload =>
  verifyToken(token, secret, "access");

export const verifyRefreshToken = (token: string, secret: string): JwtPayload =>
  verifyToken(token, secret, "refresh");

/**
 * Decode a token's payload WITHOUT verifying it.
 *
 * Only for tokens this process itself just signed, where the signature is
 * known good and the caller needs what signToken generated — the `jti` to
 * record in refresh_tokens, the `exp` to store alongside it. Never use this
 * on a token received from outside: it performs no signature, algorithm or
 * expiry check, which is exactly what verifyToken exists to do.
 */
export function decodeJwtPayload(token: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("malformed token");
  try {
    return JSON.parse(fromB64url(parts[1])) as JwtPayload;
  } catch {
    throw new JwtError("bad payload");
  }
}
