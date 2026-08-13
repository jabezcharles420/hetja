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
import { createHash, randomInt } from "node:crypto";
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
  const res = await query<OtpRow>(
    `SELECT code_hash, expires_at, attempts_used FROM otp_codes WHERE identity_hmac = $1`,
    [identityHmacVal],
  );
  const record = res.rows[0];
  if (!record) return "invalid_code";

  if (Date.now() > new Date(record.expires_at).getTime()) {
    await query(`DELETE FROM otp_codes WHERE identity_hmac = $1`, [identityHmacVal]);
    return "expired";
  }
  if (record.attempts_used >= OTP_MAX_ATTEMPTS) {
    await query(`DELETE FROM otp_codes WHERE identity_hmac = $1`, [identityHmacVal]);
    return "too_many_attempts";
  }

  const candidate = hashCode(code, pepper);
  if (candidate !== record.code_hash) {
    const attemptsUsed = record.attempts_used + 1;
    if (attemptsUsed >= OTP_MAX_ATTEMPTS) {
      await query(`DELETE FROM otp_codes WHERE identity_hmac = $1`, [identityHmacVal]);
    } else {
      await query(`UPDATE otp_codes SET attempts_used = $2 WHERE identity_hmac = $1`, [
        identityHmacVal,
        attemptsUsed,
      ]);
    }
    return "invalid_code";
  }

  await query(`DELETE FROM otp_codes WHERE identity_hmac = $1`, [identityHmacVal]);
  return "ok";
}

/** Test helper — forget an OTP without consuming an attempt. */
export async function clearOtp(identityHmacVal: string): Promise<void> {
  await query(`DELETE FROM otp_codes WHERE identity_hmac = $1`, [identityHmacVal]);
}
