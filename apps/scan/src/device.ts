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
 * ~112 KB minified and would blow the 40 KB budget, so scan solves the
 * challenge natively with Web Crypto -- the server does not care which client
 * solves it). The solve runs in small batches of concurrent Web Crypto
 * digests and hands the main thread back on a WALL-CLOCK budget -- see
 * YIELD_INTERVAL_MS -- so a slow solve on an underpowered device degrades
 * gracefully instead of freezing the tap that just opened the emergency sheet.
 *
 * Every failure mode here (network, no challenge, no PoW solution within
 * the time budget, a bad response shape) resolves to `undefined` rather
 * than throwing -- callers keep the existing graceful fallback instead of a
 * crash.
 */

const TOKEN_KEY = "hetja.deviceToken.v1";
export const SOLVE_TIMEOUT_MS = 20_000;
export const SOLVE_BATCH = 48;

/**
 * Hand the main thread back only once this much wall clock has passed since
 * the last yield -- a frame's worth -- rather than once per batch.
 *
 * This number is the whole fix for a solver that could not finish inside its
 * own timeout. One batch of 48 digests is well under a millisecond of real
 * work, so yielding after every batch spent almost all of the budget in the
 * scheduler rather than hashing: browsers clamp a `setTimeout(..., 0)` nested
 * inside a setTimeout-driven chain to 4 ms, which this self-chaining loop hit
 * on its second iteration, so at 20 effective bits (2^20 / 48 = 21,845
 * batches) the solve owed 21,845 x 4 ms = ~87 s of pure timer delay against a
 * 20,000 ms deadline. It could not succeed, and `getDeviceToken()` returning
 * undefined is exactly the "Couldn't confirm the report automatically" degrade
 * this module exists to prevent -- on the path where a stranger is standing
 * over an injured dog.
 *
 * Budgeting the yields instead makes the tax proportional to elapsed time
 * rather than to hash count: ~60 yields per second of solving, no matter how
 * fast the device hashes, while never blocking the main thread for longer than
 * one frame at a time.
 */
export const YIELD_INTERVAL_MS = 16;

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

/** ALTCHA v2 challenge as issued by POST /api/v1/devices/challenge. */
interface AltchaChallenge {
  parameters: {
    algorithm: string;
    nonce: string;
    salt: string;
    cost: number;
    keyLength: number;
    keyPrefix: string;
  };
  signature?: string;
}

interface AltchaSolution {
  counter: number;
  derivedKey: string;
}

interface ChallengeData {
  challenge: AltchaChallenge;
  difficulty: number;
}

function isValidChallenge(c: unknown): c is AltchaChallenge {
  if (!c || typeof c !== "object") return false;
  const p = (c as AltchaChallenge).parameters;
  return (
    !!p &&
    typeof p.algorithm === "string" &&
    typeof p.nonce === "string" &&
    typeof p.salt === "string" &&
    typeof p.cost === "number" &&
    typeof p.keyLength === "number" &&
    typeof p.keyPrefix === "string"
  );
}

async function mintDeviceToken(): Promise<string | undefined> {
  const challengeData = await postJson<ChallengeData>("/api/v1/devices/challenge");
  if (!challengeData || !isValidChallenge(challengeData.challenge)) return undefined;

  const solution = await solveAltchaPoW(challengeData.challenge, SOLVE_TIMEOUT_MS);
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

/*
 * The four helpers below are exported ONLY so the test suite can reach them.
 * apps/scan had no `test` script at all until 2026-08-14, which meant
 * `pnpm -r test` silently skipped this package -- and this file is a hand-written
 * reimplementation of ALTCHA's key derivation on the life-safety path. That is
 * how both a 16x difficulty increase and a solver that could not finish inside
 * its own timeout shipped unnoticed. Exporting costs nothing at runtime: esbuild
 * bundles from src/main.ts, and unused exports of a non-entry module are
 * tree-shaken (verified against the 40 KB size gate).
 */
export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function bytesToHex(bytes: Uint8Array<ArrayBuffer>): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, "0");
  return out;
}

/** True iff the lowercase hex encoding of `bytes` starts with `hex` -- the
 * same check altcha-lib's verifySolution applies to the derived key. Handles
 * odd-length prefixes (a trailing nibble compares against the high bits). */
export function hexStartsWith(bytes: Uint8Array<ArrayBuffer>, hex: string): boolean {
  const fullBytes = Math.floor(hex.length / 2);
  for (let i = 0; i < fullBytes; i++) {
    if (bytes[i] !== parseInt(hex.slice(i * 2, i * 2 + 2), 16)) return false;
  }
  if (hex.length % 2 === 1) {
    const nibble = parseInt(hex[fullBytes * 2]!, 16);
    if ((bytes[fullBytes]! >> 4) !== nibble) return false;
  }
  return true;
}

async function sha256(input: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

/**
 * ALTCHA v2 SHA-256 key derivation (matches altcha-lib/algorithms/sha):
 * derivedKey = SHA-256^cost(salt || nonce || counter_uint32BE), truncated to
 * keyLength bytes. `counter` is the raw 32-bit big-endian value.
 */
export async function deriveKey(
  params: AltchaChallenge["parameters"],
  counter: number,
): Promise<{ counter: number; key: Uint8Array<ArrayBuffer> }> {
  const nonceBytes = hexToBytes(params.nonce);
  const saltBytes = hexToBytes(params.salt);
  const password = new Uint8Array(nonceBytes.length + 4);
  password.set(nonceBytes, 0);
  new DataView(password.buffer).setUint32(nonceBytes.length, counter, false);

  const input = new Uint8Array(saltBytes.length + password.length);
  input.set(saltBytes, 0);
  input.set(password, saltBytes.length);

  let data = await sha256(input);
  for (let i = 1; i < params.cost; i++) data = await sha256(data);
  return { counter, key: data.slice(0, params.keyLength) };
}

/** `scheduler.yield()` (Chrome 129+) is the platform's own "let other work run,
 * then continue me" primitive. It is not in the DOM lib types this app compiles
 * against, so it is probed structurally rather than declared as a global. */
interface SchedulerWithYield {
  yield?: () => Promise<void>;
}

/**
 * Builds the cheapest available "hand the main thread back once" function,
 * plus a `close()` for the MessageChannel it may own.
 *
 * Deliberately NOT setTimeout(0) as the primary path. Measured per yield on the
 * dev box, 2026-08-14: setTimeout(0) 14.3 ms (Node on Windows, whose timer
 * granularity is ~15.6 ms; a browser clamps a nested one to 4 ms),
 * MessageChannel 0.016 ms. A MessageChannel round-trip is an ordinary macrotask
 * with no minimum delay, so paint and input still get their turn between
 * batches -- the point of yielding at all -- without the solver paying a
 * scheduler tax three orders of magnitude larger than the work it just did.
 * setTimeout stays as the last-resort fallback for a runtime with neither.
 *
 * One channel per solve, not one per yield: allocating 21k MessagePort pairs
 * would trade the timer tax for a GC one. Only one solve runs at a time (see
 * `inFlight` in getDeviceToken), so a single reused channel cannot interleave.
 */
export function makeYielder(): { yieldNow: () => Promise<void>; close: () => void } {
  const scheduler = (globalThis as { scheduler?: SchedulerWithYield }).scheduler;
  const schedulerYield = scheduler?.yield;
  if (typeof schedulerYield === "function") {
    return { yieldNow: () => schedulerYield.call(scheduler), close: () => {} };
  }
  if (typeof MessageChannel === "function") {
    const channel = new MessageChannel();
    return {
      yieldNow: () =>
        new Promise<void>((resolve) => {
          channel.port1.onmessage = () => resolve();
          channel.port2.postMessage(0);
        }),
      close: () => {
        channel.port1.close();
        channel.port2.close();
      },
    };
  }
  return { yieldNow: () => new Promise<void>((resolve) => setTimeout(resolve, 0)), close: () => {} };
}

/**
 * Brute-forces an ALTCHA v2 SHA-256 solution: finds a counter whose derived
 * key hex encoding starts with challenge.parameters.keyPrefix. Runs in batches
 * of SOLVE_BATCH concurrent Web Crypto digests and yields between batches only
 * once YIELD_INTERVAL_MS of wall clock has elapsed since the last yield -- a
 * chunked loop rather than a single synchronous spin, so the main thread is
 * never held for longer than one frame, and the yields cost time proportional
 * to the solve's duration instead of to its hash count. See YIELD_INTERVAL_MS
 * for why yielding per batch made this function unable to finish at all.
 */
export async function solveAltchaPoW(challenge: AltchaChallenge, timeoutMs: number): Promise<AltchaSolution | undefined> {
  if (typeof crypto === "undefined" || !crypto.subtle) return undefined;
  if (challenge.parameters.algorithm !== "SHA-256") return undefined;

  const deadline = Date.now() + timeoutMs;
  const { yieldNow, close } = makeYielder();
  try {
    let next = 0;
    let lastYield = Date.now();
    while (Date.now() < deadline) {
      const base = next;
      const results = await Promise.all(
        Array.from({ length: SOLVE_BATCH }, (_, k) => deriveKey(challenge.parameters, base + k)),
      );
      for (const r of results) {
        if (hexStartsWith(r.key, challenge.parameters.keyPrefix)) {
          return { counter: r.counter, derivedKey: bytesToHex(r.key) };
        }
      }
      next = base + SOLVE_BATCH;
      if (Date.now() - lastYield >= YIELD_INTERVAL_MS) {
        await yieldNow();
        lastYield = Date.now();
      }
    }
    return undefined;
  } finally {
    close();
  }
}
