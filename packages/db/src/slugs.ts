/**
 * Hetja slug generator — INVARIANT 1: slugs are random, never sequential.
 * base32 (lowercase, confusables reduced) of 40 random bits + 1 check char.
 * Statistical property: no monotonic component (tested in slugs.test.ts).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// 32 characters: lowercase base32 with confusables `l`, `0`, `1` removed
// (but `o` is kept — only those three are absent). Previously this string
// was 33 chars ("...789") while the comment claimed 32 and toBase32 masks
// with & 31 / % 32, so index 32 (`9`) was never emitted — the generator's
// effective alphabet was the 32 chars without `9`. The fix drops the
// unreachable trailing `9` so length matches the mask (32) WITHOUT reindexing
// any other character: every value 0..31 keeps the same letter/digit, so
// already-issued slugs keep the same check character. Validators still accept
// `9` (`/^[a-km-z2-9]{9}$/` here and in apps/web/lib/collar.ts) for
// hand-minted compatibility — `isValidSlug` therefore stays permissive for
// 9 via VALIDATOR_ALPHABET — but the generator never emits `9`.
const ALPHABET = "abcdefghijkmnopqrstuvwxyz2345678"; // 32 chars
const VALIDATOR_ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789"; // 33 chars, includes 9 for compatibility

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
  // Use VALIDATOR_ALPHABET so a hand-minted body containing `9` (accepted by
  // SLUG_RE but never emitted by the generator) still validates — see the test
  // "keeps validating slugs whose body contains 9". For bodies without `9`,
  // both alphabets give the same sum.
  const check = [...body].reduce((s, c) => s + VALIDATOR_ALPHABET.indexOf(c), 0) % 32;
  return VALIDATOR_ALPHABET[check] === slug[8];
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
