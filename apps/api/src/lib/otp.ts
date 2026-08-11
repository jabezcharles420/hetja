/**
 * Dev-mode OTP store. Codes are never kept in plaintext — only a
 * SHA-256(pepper + ":" + code) hash (INVARIANT 3 spirit applied to OTPs).
 * 5-minute TTL, 3 attempts per issuance. In-memory: dev-mode only.
 */
import { createHash, randomInt } from "node:crypto";

export const OTP_TTL_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 3;

interface OtpRecord {
  hash: string;
  expiresAt: number;
  attemptsUsed: number;
}

export type OtpVerifyResult = "ok" | "invalid_code" | "expired" | "too_many_attempts";

const store = new Map<string, OtpRecord>();

const hashCode = (code: string, pepper: string): string =>
  createHash("sha256").update(`${pepper}:${code}`).digest("hex");

export function issueOtp(phone: string, pepper: string): { code: string; expiresAt: number } {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = Date.now() + OTP_TTL_MS;
  store.set(phone, { hash: hashCode(code, pepper), expiresAt, attemptsUsed: 0 });
  return { code, expiresAt };
}

export function verifyOtp(phone: string, code: string, pepper: string): OtpVerifyResult {
  const record = store.get(phone);
  if (!record) return "invalid_code";
  if (Date.now() > record.expiresAt) {
    store.delete(phone);
    return "expired";
  }
  if (record.attemptsUsed >= OTP_MAX_ATTEMPTS) {
    store.delete(phone);
    return "too_many_attempts";
  }
  const candidate = hashCode(code, pepper);
  if (candidate !== record.hash) {
    record.attemptsUsed += 1;
    if (record.attemptsUsed >= OTP_MAX_ATTEMPTS) store.delete(phone);
    return "invalid_code";
  }
  store.delete(phone);
  return "ok";
}

/** Test helper — forget an OTP without consuming an attempt. */
export function clearOtp(phone: string): void {
  store.delete(phone);
}
