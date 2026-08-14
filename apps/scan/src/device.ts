/**
 * Anon-attested device token client (browser half of INVARIANT 6/7).
 *
 * The API previously had no `/api/v1/devices/*` route at all, so anonymous
 * POST /api/v1/reports always 401'd -- sheet.ts filed the report without a
 * device token and just showed "Couldn't confirm the report automatically
 * -- please also call below." on failure. This module gets a real token so
 * that degrade path stops firing on every single report.
 *
 * Obtained *lazily*: getDeviceToken() is only called from a write path that
 * actually needs one (sheet.ts's fileReport, on first severity tap) -- never
 * from main.ts's page-load path -- so the hot-path budget (this app's 40KB
 * gzipped gate) never pays a network round-trip or a PoW solve just for
 * loading a dog's profile. Once minted, the token is cached in localStorage
 * so later reports from the same browser reuse it instantly.
 *
 * The proof-of-work is an ALTCHA v2 SHA-256 challenge (the ALTCHA widget is
 * ~112 KB minified and would blow the 40 KB budget, so we solve the challenge
 * natively with Web Crypto -- the server does not care which client solves it).
 *
 * The solver itself no longer lives here: it moved to `@hetja/pow`, a
 * zero-dependency workspace package, because `apps/web`'s login page needs the
 * identical routine. `apps/api/src/routes/auth.ts` gates OTP verification on
 * `verifyDeviceToken`, and apps/web was sending a bare `uuid()` -- which has no
 * `.` separator and so failed the very first guard in `deviceTokenSubject`, i.e.
 * NO feeder could ever log in on the web app. The fix needed this exact
 * derivation in a second place, and a hand-copied crypto routine that has to
 * agree with `altcha-lib` byte for byte is precisely the shape of the bugs this
 * codebase has been digging out of. `@hetja/pow` has no dependencies and no
 * `@types/node` in scope, so importing it costs this bundle only the bytes the
 * solver already occupied. Measured on the same tree, same esbuild invocation:
 * 16,452 B gzipped total before the move, 16,462 B after -- +10 B (+2 B raw) out
 * of a 40,960 B budget, all of it minifier name-mangling noise, because esbuild
 * bundles the package's TypeScript source exactly as it bundled this file's.
 *
 * Every failure mode here (network, no challenge, no PoW solution within
 * the time budget, a bad response shape) resolves to `undefined` rather
 * than throwing -- callers keep the existing graceful fallback instead of a
 * crash.
 */
import { isPowChallenge, solveAltchaPoW, type PowChallenge, type PowSolution } from "@hetja/pow";

/**
 * Shared with apps/web deliberately. In production Caddy serves the feeder PWA
 * and this page from ONE hostname (hetja.in/* and hetja.in/d/*), so both read
 * the same localStorage -- and a device token is not app-specific: the same
 * endpoint mints it and the same secret verifies it. A feeder who scanned a
 * collar before signing in therefore pays for the proof-of-work once, not
 * twice. Nothing server-side links a token to a feeder identity (auth.ts
 * verifies it and discards it; only anonymous writes ever store the derived
 * deviceId), so sharing the key does not join those two records.
 */
const TOKEN_KEY = "hetja.deviceToken.v1";

/**
 * Wall-clock budget for one solve on this page. Deliberately generous: the
 * alternative to a slow solve is the "Couldn't confirm the report
 * automatically" degrade, in front of someone standing over an injured dog.
 * At the configured difficulty (16 effective bits, ~65k expected digests) a
 * cheap Android clears this with a large margin -- see the budget test in
 * device.test.ts, which fails if the arithmetic stops working.
 */
export const SOLVE_TIMEOUT_MS = 20_000;

let inFlight: Promise<string | undefined> | undefined;

export function getCachedDeviceToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function cacheDeviceToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable (private mode / quota) -- token is still returned
     * to the caller for this call, just not persisted for next time. */
  }
}

/**
 * Returns a usable device token: the cached one if present, otherwise mints
 * one via the challenge/PoW round-trip. Concurrent callers within the same
 * page share a single in-flight mint rather than each solving their own PoW.
 */
export async function getDeviceToken(): Promise<string | undefined> {
  const cached = getCachedDeviceToken();
  if (cached) return cached;
  if (!inFlight) {
    inFlight = mintDeviceToken().finally(() => {
      inFlight = undefined;
    });
  }
  return inFlight;
}

interface ChallengeData {
  challenge: PowChallenge;
  difficulty: number;
}

async function mintDeviceToken(): Promise<string | undefined> {
  const challengeData = await postJson<ChallengeData>("/api/v1/devices/challenge");
  if (!challengeData || !isPowChallenge(challengeData.challenge)) return undefined;

  const solution: PowSolution | undefined = await solveAltchaPoW(challengeData.challenge, SOLVE_TIMEOUT_MS);
  if (solution == null) return undefined;

  const tokenData = await postJson<{ deviceToken: string }>("/api/v1/devices/token", {
    challenge: challengeData.challenge,
    solution,
  });
  if (!tokenData || typeof tokenData.deviceToken !== "string" || !tokenData.deviceToken) return undefined;

  cacheDeviceToken(tokenData.deviceToken);
  return tokenData.deviceToken;
}

async function postJson<T>(url: string, body?: unknown): Promise<T | undefined> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: body ? { "content-type": "application/json", accept: "application/json" } : { accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return undefined;
    const parsed: unknown = await res.json();
    if (!parsed || typeof parsed !== "object" || !("data" in parsed)) return undefined;
    return (parsed as { data?: T }).data;
  } catch {
    return undefined;
  }
}
