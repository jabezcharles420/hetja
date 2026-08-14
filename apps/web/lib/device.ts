/**
 * Attested device tokens for the feeder PWA — the client half of INVARIANT 6,
 * and the reason a feeder can log in at all.
 *
 * THE BUG THIS FIXES
 *
 * `apps/api/src/routes/auth.ts` gates OTP verification on
 * `verifyDeviceToken(deviceToken, HETJA_DEVICE_SECRET)`. A real device token is
 * `<base64url(deviceId)>.<base64url(HMAC(secret, deviceId))>`. The login page
 * used to send a bare `uuid()` from `@/lib/idb`, cached under
 * `hetja.deviceToken` — no `.` separator at all, so `deviceTokenSubject` bailed
 * at its very first guard (`dot <= 0`) and `POST /api/v1/auth/verify` answered
 * 401 BAD_DEVICE_TOKEN. Every web login attempt failed, and always had; it was
 * never a regression, just a client that had never implemented the flow.
 * Verified by running both strings through the built `apps/api/dist/lib/device.js`:
 * the UUID is rejected, a token from `issueDeviceToken` is accepted.
 *
 * `apps/scan` already did this correctly, so the shape here is deliberately the
 * same: ask `POST /api/v1/devices/challenge` for an ALTCHA v2 SHA-256
 * proof-of-work, solve it, hand the solution to `POST /api/v1/devices/token`,
 * cache the minted token in localStorage. The solver lives in `@hetja/pow` so
 * that this app and the scan page cannot drift apart on a derivation that has to
 * match `altcha-lib` byte for byte.
 *
 * WHAT THIS MODULE DOES *NOT* DO, ON PURPOSE
 *
 * It never invents a token. The old code's fallback — "if storage is broken,
 * return a fresh uuid()" — is what made the failure invisible: the request went
 * out looking well-formed and came back 401 with a generic message. Every
 * failure here is named (see `DeviceTokenFailure`) and every name maps to
 * something a user can act on, because on the login path there is nothing to
 * degrade *to*. No token means no session.
 */
import {
  isPowChallenge,
  powUnavailableReason,
  solveAltchaPoW,
  type PowChallenge,
  type PowSolution,
} from "@hetja/pow";
import { api, ApiError } from "./api";

/**
 * Where the minted token lives.
 *
 * Shared with `apps/scan` deliberately (it uses this same key). In production
 * Caddy serves both from ONE hostname — the feeder PWA at `hetja.in/*` and the
 * collar landing page at `hetja.in/d/*` — so they read the same localStorage,
 * and a device token is not app-specific: one endpoint mints it, one secret
 * verifies it. A feeder who scanned a collar before signing in therefore pays
 * for the proof-of-work once rather than twice.
 *
 * That sharing joins no records server-side. `auth.ts` only *verifies* the token
 * and then discards it — nothing writes it, or the deviceId it attests, next to
 * a feeder row — while the deviceId is stored only for anonymous writes
 * (`scans.device_token`, keyed via `deviceTokenSubject`). So an anonymous SOS
 * and a later login from the same browser do not become linkable because they
 * shared this key.
 */
export const DEVICE_TOKEN_KEY = "hetja.deviceToken.v1";

/**
 * The key the broken implementation used. Every value it ever held is a bare
 * UUID that the API rejects, so there is nothing to migrate — but browsers that
 * ever opened the old login page still have one sitting there, and it must be
 * cleaned out rather than left to be read by some future code path that trusts
 * whatever it finds. `readCachedDeviceToken` removes it on first call.
 */
export const LEGACY_DEVICE_TOKEN_KEY = "hetja.deviceToken";

/**
 * Wall-clock budget for one proof-of-work solve.
 *
 * At the configured difficulty (DEVICE_POW_DIFFICULTY=16, i.e. 16 effective
 * bits, ~65k expected SHA-256 digests) this is roughly 1 s on a desktop and a
 * few seconds on a cheap Android — see the budget arithmetic in
 * `apps/scan/src/device.test.ts`. 20 s is the same budget the scan page uses,
 * for the same reason: the failure mode of being too impatient is worse than a
 * slow spinner, because here it is a feeder who cannot sign in.
 */
export const SOLVE_TIMEOUT_MS = 20_000;

/** Named failures, so the UI can say something true. `insecure-context` and
 * `no-web-crypto` are permanent for this browser/URL; the other three are worth
 * retrying. */
export type DeviceTokenFailure =
  | "insecure-context"
  | "no-web-crypto"
  | "challenge-unavailable"
  | "pow-timeout"
  | "mint-rejected";

export type DeviceTokenOutcome =
  | { ok: true; token: string; minted: boolean }
  | { ok: false; reason: DeviceTokenFailure };

/** True iff `value` has the *shape* `issueDeviceToken` produces: two non-empty
 * canonical-base64url parts separated by a single `.`.
 *
 * This is a screen, not a validation — only the server can check the HMAC. It
 * exists to catch the one value we know is in the wild: the bare `uuid()` the
 * old login page cached. A UUID's characters are all inside the base64url
 * alphabet, so the `.` is what gives it away, exactly as it does in
 * `deviceTokenSubject`'s `dot <= 0` guard. Anything that fails this screen is
 * garbage we would otherwise send to the server and get a 401 for. */
export function isAttestedTokenShape(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

/**
 * The cached token, if there is a usable one. Non-conforming values are
 * *deleted*, not ignored: leaving one in place means the next reader has to
 * remember to screen it too.
 */
export function readCachedDeviceToken(): string | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;

    // Unconditional: this key only ever held a bare UUID.
    localStorage.removeItem(LEGACY_DEVICE_TOKEN_KEY);

    const cached = localStorage.getItem(DEVICE_TOKEN_KEY);
    if (isAttestedTokenShape(cached)) return cached;
    if (cached !== null) localStorage.removeItem(DEVICE_TOKEN_KEY);
    return undefined;
  } catch {
    // Private mode, or storage disabled by policy. Not fatal: a mint still
    // works, it just cannot be remembered for next time.
    return undefined;
  }
}

/** Forget the cached token. Called when the server rejects it — the one case
 * where a syntactically fine token is known-bad (HETJA_DEVICE_SECRET rotated,
 * so every token minted under the old secret is now worthless). Without this,
 * a secret rotation would lock every returning browser out of login
 * permanently, with a cached token that can never verify again. */
export function clearCachedDeviceToken(): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(DEVICE_TOKEN_KEY);
  } catch {
    /* nothing to clear if storage is unavailable */
  }
}

function cacheDeviceToken(token: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(DEVICE_TOKEN_KEY, token);
  } catch {
    /* see readCachedDeviceToken -- the token is still returned to the caller */
  }
}

let inFlight: Promise<DeviceTokenOutcome> | undefined;

/**
 * Returns an attested device token: the cached one, or a freshly minted one.
 *
 * Concurrent callers share one mint. The login page calls this twice on the
 * happy path — once speculatively when the code is requested, once for real at
 * verify time — and a second proof-of-work solve would be pure waste.
 */
export async function getDeviceToken(): Promise<DeviceTokenOutcome> {
  const cached = readCachedDeviceToken();
  if (cached) return { ok: true, token: cached, minted: false };
  if (!inFlight) {
    inFlight = mintDeviceToken().finally(() => {
      inFlight = undefined;
    });
  }
  return inFlight;
}

/** The challenge as issued, or `undefined` if it could not be fetched or does not
 * have the shape the solver needs. Structurally validated rather than cast: a
 * malformed `parameters` would otherwise reach `deriveKey` and throw from inside
 * `DataView`, turning a bad response into an unhandled rejection. */
async function fetchChallenge(): Promise<PowChallenge | undefined> {
  try {
    const res = await api.requestDeviceChallenge();
    return isPowChallenge(res.challenge) ? res.challenge : undefined;
  } catch {
    return undefined;
  }
}

async function mintDeviceToken(): Promise<DeviceTokenOutcome> {
  // Checked before the network round-trip, not after: if Web Crypto is missing
  // there is no point asking for a challenge we cannot solve, and the user
  // deserves the real reason immediately rather than after a spinner.
  const unavailable = powUnavailableReason();
  if (unavailable) return { ok: false, reason: unavailable };

  const challenge = await fetchChallenge();
  if (!challenge) return { ok: false, reason: "challenge-unavailable" };

  const solution: PowSolution | undefined = await solveAltchaPoW(challenge, SOLVE_TIMEOUT_MS);
  if (!solution) {
    // Re-check: a page can lose nothing here, but "no crypto" and "too slow"
    // are different messages and the first is detectable.
    return { ok: false, reason: powUnavailableReason() ?? "pow-timeout" };
  }

  try {
    const { deviceToken } = await api.requestDeviceToken({ challenge, solution });
    if (!isAttestedTokenShape(deviceToken)) return { ok: false, reason: "mint-rejected" };
    cacheDeviceToken(deviceToken);
    return { ok: true, token: deviceToken, minted: true };
  } catch {
    // Includes the 401s the mint route raises: BAD_POW (our derivation
    // disagreed with the server's), CHALLENGE_EXPIRED (the solve outlived the
    // 120 s challenge TTL) and CHALLENGE_REUSED. All of them are worth one
    // retry with a fresh challenge, which is what the caller gets by calling
    // again.
    return { ok: false, reason: "mint-rejected" };
  }
}

/**
 * User-facing copy for a failure. Lives here rather than in the page so the
 * strings are testable and so the SOS path can reuse them when it is wired up.
 *
 * Note what the secure-context message has to explain, because it is a real trap
 * on this project: `crypto.subtle` exists only in a secure context. `localhost`
 * is exempt, so `pnpm dev` over plain HTTP works fine — but opening the same dev
 * server from a phone on the LAN (`http://192.168.1.5:3100`) is NOT a secure
 * context, so the proof-of-work is impossible and login cannot work there at
 * all. Production is unaffected: Cloudflare terminates TLS, so the browser
 * always sees `https://hetja.in`.
 */
export function deviceTokenFailureMessage(reason: DeviceTokenFailure): string {
  switch (reason) {
    case "insecure-context":
      return "Sign-in needs a secure connection. This page is on plain http:// — open Hetja over https:// (or on localhost) and try again.";
    case "no-web-crypto":
      return "This browser is missing the cryptography support sign-in needs. Please try a current Chrome, Safari or Firefox.";
    case "challenge-unavailable":
      return "Could not reach Hetja to confirm this device. Check your connection and try again.";
    case "pow-timeout":
      return "Confirming this device took too long here. Please try again — keep the screen on while it works.";
    case "mint-rejected":
      return "Hetja could not confirm this device. Please try again in a moment.";
  }
}

/** True for the API error that means "the device token you sent is not one of
 * ours" — the signal to throw the cached token away and mint a new one. */
export function isBadDeviceTokenError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401 && err.code === "BAD_DEVICE_TOKEN";
}
