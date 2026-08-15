/**
 * OTP store — Postgres-backed (packages/db/migrations/0010_identity_email.sql,
 * table otp_codes). Codes are never kept in plaintext — only a
 * SHA-256(pepper + ":" + code) hash (INVARIANT 3 spirit applied to OTPs).
 * 5-minute TTL, 3 attempts per issuance.
 *
 * This used to be an in-memory Map. That lost every pending code on
 * restart or redeploy, and would never work across more than one API
 * process. Moving it into Postgres, keyed on identity_hmac (never the bare
 * email — see the migration), fixes both: a code now survives a restart,
 * and any process talking to the same database sees the same pending code.
 * Every function here is therefore async where the old ones were sync —
 * callers (apps/api/src/routes/auth.ts) must await them.
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { query } from "@hetja/db";

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 3;

export type OtpVerifyResult = "ok" | "invalid_code" | "expired" | "too_many_attempts";

interface OtpRow {
  code_hash: string;
  expires_at: string;
  attempts_used: number;
}

const hashCode = (code: string, pepper: string): string =>
  createHash("sha256").update(`${pepper}:${code}`).digest("hex");

export async function issueOtp(
  identityHmacVal: string,
  pepper: string,
): Promise<{ code: string; expiresAt: number }> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = Date.now() + OTP_TTL_MS;
  await query(
    `INSERT INTO otp_codes (identity_hmac, code_hash, expires_at, attempts_used)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (identity_hmac)
     DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts_used = 0`,
    [identityHmacVal, hashCode(code, pepper), new Date(expiresAt).toISOString()],
  );
  return { code, expiresAt };
}

export async function verifyOtp(
  identityHmacVal: string,
  code: string,
  pepper: string,
): Promise<OtpVerifyResult> {
  // Claim an attempt ATOMICALLY, before looking at anything.
  //
  // This was a SELECT of attempts_used, a comparison against OTP_MAX_ATTEMPTS,
  // and a later UPDATE — three statements with no lock between them. Under
  // concurrency every request read the same attempts_used, so N simultaneous
  // POSTs to /api/v1/auth/verify each saw "0 attempts used" and the 3-attempt
  // cap simply did not engage. A 6-digit code is 10^6 wide; a cap that can be
  // bypassed by issuing requests in parallel is not a cap, and OTP issuance is
  // itself unauthenticated and uncapped, so the code could be re-minted freely
  // while guessing.
  //
  // `UPDATE ... RETURNING` takes a row lock and returns the post-increment
  // value, so N concurrent callers serialise and see 1, 2, 3 … — each attempt
  // is counted exactly once no matter how they interleave.
  const claimed = await query<OtpRow>(
    `UPDATE otp_codes
        SET attempts_used = attempts_used + 1
      WHERE identity_hmac = $1
      RETURNING code_hash, expires_at, attempts_used`,
    [identityHmacVal],
  );
  const record = claimed.rows[0];
  if (!record) return "invalid_code";

  if (Date.now() > new Date(record.expires_at).getTime()) {
    await query(`DELETE FROM otp_codes WHERE identity_hmac = $1`, [identityHmacVal]);
    return "expired";
  }
  // attempts_used is now post-increment, so it counts THIS attempt: exceeding
  // the budget means strictly greater than the maximum.
  if (record.attempts_used > OTP_MAX_ATTEMPTS) {
    await query(`DELETE FROM otp_codes WHERE identity_hmac = $1`, [identityHmacVal]);
    return "too_many_attempts";
  }

  if (!hashesEqual(hashCode(code, pepper), record.code_hash)) {
    if (record.attempts_used >= OTP_MAX_ATTEMPTS) {
      await query(`DELETE FROM otp_codes WHERE identity_hmac = $1`, [identityHmacVal]);
    }
    return "invalid_code";
  }

  await query(`DELETE FROM otp_codes WHERE identity_hmac = $1`, [identityHmacVal]);
  return "ok";
}

/**
 * Constant-time comparison of two hex SHA-256 digests.
 *
 * `!==` on the hex strings short-circuits at the first differing character, so
 * the rejection time leaks a prefix-match length. Both operands are digests of
 * peppered input rather than the secret itself, which bounds what that leak is
 * worth, but this is the login path and the codebase already compares HMACs,
 * device tokens and JWT signatures in constant time.
 */
function hashesEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Test helper — forget an OTP without consuming an attempt. */
export async function clearOtp(identityHmacVal: string): Promise<void> {
  await query(`DELETE FROM otp_codes WHERE identity_hmac = $1`, [identityHmacVal]);
}
