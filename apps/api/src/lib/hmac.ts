/**
 * HMAC helpers — INVARIANT 3 (never store bare contact info; only HMACs of
 * it) and QR slug signing/verification.
 *
 * identityHmac(identity, pepper) = HMAC-SHA256(key=pepper, msg=identity) as
 * hex. `identity` is whatever channel we verify a feeder through (an email
 * address, as of the phone -> email OTP migration; the function itself is
 * channel-agnostic and its algorithm is unchanged from when it hashed
 * phone numbers). The pepper lives OUTSIDE env files in production
 * (KMS/secret manager).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function identityHmac(identity: string, pepper: string): string {
  return createHmac("sha256", pepper).update(identity).digest("hex");
}

/** HMAC signature for a QR slug — base64url (matches collar HMAC-signed QR). */
export function signSlug(slug: string, secret: string): string {
  return createHmac("sha256", secret).update(slug).digest("base64url");
}

/** Constant-time verification of a slug signature. */
export function verifySlugSig(slug: string, sig: string, secret: string): boolean {
  const expected = Buffer.from(signSlug(slug, secret));
  const provided = Buffer.from(sig);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
