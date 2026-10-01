/** Pure helpers for the Login screens (app/login). */

export const OTP_LENGTH = 6;
/** Resend cooldown, seconds (the mock's "Resend in 0:24" countdown). */
export const RESEND_COOLDOWN_S = 30;
/** The API's OTP_TTL_MS (apps/api/src/lib/otp.ts) is 5 minutes. */
export const OTP_MINUTES = 5;

const BASE = "https://hetja.invalid";

/**
 * `raw` as a same-origin path, or null. Parsed the way the browser will parse
 * it, not by prefix: the URL parser drops tabs and newlines and reads `\` as
 * `/`, so `/<TAB>/evil.example` passed a `//` prefix check and then
 * navigated to evil.example after a real sign-in.
 */
function sameOriginPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/")) return null;
  try {
    const u = new URL(raw, BASE);
    return u.origin === BASE ? `${u.pathname}${u.search}${u.hash}` : null;
  } catch {
    return null;
  }
}

/** Only same-origin paths may be a post-login destination (no open redirect). */
export function safeNext(raw: string | null | undefined): string {
  return sameOriginPath(raw) ?? "/me";
}

/** 24 -> "0:24". */
export function formatCountdown(s: number): string {
  const n = Math.max(0, Math.ceil(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

/** Where "Cancel" on the sign-in step goes: back where the feeder came from. */
export function cancelHref(next: string | null | undefined): string {
  const path = sameOriginPath(next);
  if (!path) return "/";
  // A page that needs a session would only bounce back here.
  return path === "/welcome" || path.startsWith("/welcome?") ? "/" : path;
}

/**
 * The admin portal (v7): admin.hetja.in serves only /admin/**, /login and
 * assets, so a sign-in that started there must land back in /admin, never on
 * /welcome (which that host redirects away from, without the session).
 */
export function isAdminNext(next: string): boolean {
  return next === "/admin" || next.startsWith("/admin/") || next.startsWith("/admin?") || next.startsWith("/admin#");
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
  INVALID_CODE: "That's not the code. Check the newest email.",
  EXPIRED: `That code has run out. Codes work for ${OTP_MINUTES} minutes, so tap Resend for a new one.`,
  TOO_MANY_ATTEMPTS: "Too many tries with that code. Tap Resend for a new one.",
};

export function verifyErrorMessage(code: string | undefined, message: string): string {
  const key = (code ?? message).toUpperCase();
  return VERIFY_COPY[key] ?? VERIFY_COPY[message.toUpperCase()] ?? message;
}

/**
 * V6: when a new code can be asked for, from the 429's Retry-After (seconds,
 * via parseRetryAfter). "4:32 pm" and "in 14 minutes"; null when unknown.
 */
export function formatRetryAt(
  retryAfterSec: number | undefined,
  now: Date = new Date(),
): { clock: string; relative: string } | null {
  if (retryAfterSec === undefined || !Number.isFinite(retryAfterSec) || retryAfterSec <= 0) return null;
  const at = new Date(now.getTime() + retryAfterSec * 1000);
  const clock = new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  })
    .format(at)
    .replace(/\s?([ap])\.?m\.?/i, (_m, x: string) => ` ${x.toLowerCase()}m`);
  const mins = Math.max(1, Math.ceil(retryAfterSec / 60));
  return { clock, relative: `in ${mins} ${mins === 1 ? "minute" : "minutes"}` };
}
