/**
 * Minimal HS256 JWT implementation (no runtime deps) — access tokens (15m)
 * and rotating refresh tokens (30d). Refresh rotation is achieved by minting
 * a fresh `jti` on every issuance; `type` is embedded so tokens can't be
 * used across scopes.
 */
import { createHmac, randomUUID } from "node:crypto";

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
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !a.equals(b)) throw new JwtError("bad signature");

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
