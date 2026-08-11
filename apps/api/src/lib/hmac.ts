/**
 * HMAC helpers — INVARIANT 3 (never store bare phones; only HMACs of them)
 * and QR slug signing/verification.
 *
 * phoneHmac(e164, pepper) = HMAC-SHA256(key=pepper, msg=e164) as hex.
 * The pepper lives OUTSIDE env files in production (KMS/secret manager).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function phoneHmac(e164: string, pepper: string): string {
  return createHmac("sha256", pepper).update(e164).digest("hex");
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
