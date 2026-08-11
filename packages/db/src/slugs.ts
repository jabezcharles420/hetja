/**
 * StrayNet slug generator — INVARIANT 1: slugs are random, never sequential.
 * base32 (lowercase, no vowels/confusables) of 40 random bits + 1 check char.
 * Statistical property: no monotonic component (tested in slugs.test.ts).
 */
import { createHmac, randomBytes } from "node:crypto";

const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789"; // 32 chars, no l/1/o/0

function toBase32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** 40 random bits -> 8 base32 chars, plus a check char (sum mod 32). */
export function generateSlug(): string {
  const raw = toBase32(randomBytes(5)); // 5 bytes = 40 bits -> 8 chars
  const check = [...raw].reduce((s, c) => s + ALPHABET.indexOf(c), 0) % 32;
  return raw + ALPHABET[check];
}

const SLUG_RE = /^[a-km-z2-9]{9}$/;

export function isValidSlug(slug: string): boolean {
  if (!SLUG_RE.test(slug)) return false;
  const body = slug.slice(0, 8);
  const check = [...body].reduce((s, c) => s + ALPHABET.indexOf(c), 0) % 32;
  return ALPHABET[check] === slug[8];
}

/** HMAC signature for QR codes (INVARIANT: laser-etched QR is HMAC-signed). */
export function signSlug(slug: string, secret: string): string {
  return createHmac("sha256", secret).update(slug).digest("base64url");
}

export function verifySlugSig(slug: string, sig: string, secret: string): boolean {
  const expected = signSlug(slug, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && a.equals(b);
}
