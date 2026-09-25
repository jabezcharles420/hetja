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

/** Where "Cancel" on the sign-in step goes: back where the feeder came from. */
export function cancelHref(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  // A page that needs a session would only bounce back here.
  return next === "/welcome" || next.startsWith("/welcome?") ? "/" : next;
}

/** N1 (/welcome) first, then wherever the feeder was going. */
export function welcomeHref(next: string): string {
  return next === "/me" ? "/welcome" : `/welcome?next=${encodeURIComponent(next)}`;
}

/**
 * POST /auth/verify answers a bad code with the raw result as its message
 * ("invalid_code", "expired", "too_many_attempts"). Say it in words.
 */
const VERIFY_COPY: Record<string, string> = {
  INVALID_CODE: "That code didn't match. Check the email and try again.",
  EXPIRED: `That code has run out. Codes work for ${OTP_MINUTES} minutes, so tap Resend for a new one.`,
  TOO_MANY_ATTEMPTS: "Too many tries with that code. Tap Resend for a new one.",
};

export function verifyErrorMessage(code: string | undefined, message: string): string {
  const key = (code ?? message).toUpperCase();
  return VERIFY_COPY[key] ?? VERIFY_COPY[message.toUpperCase()] ?? message;
}
