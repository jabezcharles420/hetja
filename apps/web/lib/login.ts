/** Pure helpers for the Login screens (app/login). */

export const OTP_LENGTH = 6;
/** Resend cooldown, seconds (the mock's "Resend in 0:24" countdown). */
export const RESEND_COOLDOWN_S = 30;
/** The API's OTP_TTL_MS (apps/api/src/lib/otp.ts) is 5 minutes. */
export const OTP_MINUTES = 5;

/** Only same-origin paths may be a post-login destination (no open redirect). */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/me";
  return raw;
}

/** 24 -> "0:24". */
export function formatCountdown(s: number): string {
  const n = Math.max(0, Math.ceil(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
