/**
 * Hetja slug generator — INVARIANT 1: slugs are random, never sequential.
 * base32 (lowercase, confusables reduced) of 40 random bits + 1 check char.
 * Statistical property: no monotonic component (tested in slugs.test.ts).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Documentation archaeology, recorded so nobody has to re-derive it: this
// string is 33 characters — NOT 32 as its old comment claimed, and it does
// contain `o` despite that same comment claiming "no l/1/o/0" (only l, 0 and
// 1 are actually absent).
//
// It is also, functionally, one character too long, and that off-by-one is
// deliberately left in place rather than "fixed": toBase32 masks with & 31
// and the check digit reduces with % 32, so index 32 — the digit `9` — can
// never be emitted. The generator's effective output alphabet is exactly the
// 32 characters `2345678abcdefghijkmnopqrstuvwxyz`, which is what every
// validator already accepts (/^[a-km-z2-9]{9}$/, here and in
// apps/web/lib/collar.ts) and what every collar printed so far was drawn
// from. Removing a character (dropping `o`) or otherwise reindexing the
// alphabet would shift the value of nearly every letter and digit, silently
// changing the check character of already-issued slugs and making valid,
// glued-to-a-dog collar codes fail isValidSlug. Until there is a migration
// story for physical collars, the honest options are: leave the arithmetic
// alone and tell the truth about it (this comment), or break every issued
// collar for a cosmetic gain. `9` remains accepted by validators even though
// never generated, so hand-minted or legacy values keep resolving.
const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789"; // 33 chars; see above

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

/**
 * Constant-time verification, matching apps/api/src/lib/hmac.ts's
 * verifySlugSig. The string `.equals()` this used to be (`a.equals(b)`) is
 * not constant-time. Nothing in the repo currently calls THIS copy — the API
 * route verifies through its own lib/hmac.ts, and seed.ts only signs — but
 * it is exported, so two verification functions for one credential scheme
 * differing in exactly their resistance to a timing oracle was a trap waiting
 * for the next importer.
 */
export function verifySlugSig(slug: string, sig: string, secret: string): boolean {
  const expected = Buffer.from(signSlug(slug, secret));
  const provided = Buffer.from(sig);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
