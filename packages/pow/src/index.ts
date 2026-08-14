/**
 * ALTCHA v2 SHA-256 proof-of-work solver — the client half of INVARIANT 6's
 * anonymous device attestation, shared by every browser surface that has to
 * mint a device token.
 *
 * WHY THIS IS A PACKAGE AND NOT A FILE IN EACH APP
 *
 * Two apps need this exact routine, for two different reasons:
 *
 *   - `apps/scan` (a stranger standing over an injured dog) needs a device
 *     token before `POST /api/v1/reports` will accept an anonymous SOS.
 *   - `apps/web` needs one before `POST /api/v1/auth/verify` will accept an
 *     OTP at all — `apps/api/src/routes/auth.ts` gates the whole login on
 *     `verifyDeviceToken`, so a feeder with no attested token cannot sign in.
 *
 * The second one is why this package exists. `apps/web`'s login page used to
 * send a bare `uuid()` as its "device token", which has no `.` separator and
 * therefore failed `deviceTokenSubject`'s very first guard (`dot <= 0`) —
 * every web login attempt 401'd, and always had. The obvious fix was to copy
 * the ~120 lines of solver out of `apps/scan/src/device.ts`. That is exactly
 * how this repository acquired its recent crop of bugs: a hand-copied crypto
 * routine drifts, and the copy that drifts is the one nobody is testing. The
 * derivation below has to agree with `altcha-lib` on the server *byte for
 * byte* or the mint fails with `BAD_POW`, so there is one implementation of
 * it, in one place, with one set of from-spec tests.
 *
 * WHY IT HAS NO DEPENDENCIES, AND MUST KEEP HAVING NONE
 *
 * `apps/scan` is a zero-install static page a stranger loads off a collar on
 * Mumbai 4G, and INVARIANT 13 caps it at 40 KB gzipped (enforced by
 * `apps/scan/scripts/size-gate.mjs`). It deliberately depended on no
 * `@hetja/*` package before this one, because `@hetja/contracts` would drag
 * zod into that page. This package is the exception that keeps the rule: no
 * dependencies at all, no `@types/node` (see tsconfig.json's `"types": []`),
 * nothing but Web Crypto and the DOM — so it costs the scan bundle only the
 * bytes of the code that was already there. Never add a dependency here. If
 * something needs zod, or Node's `crypto`, or a framework, it belongs in the
 * app, not in this package.
 *
 * It also ships as TypeScript *source* (`exports` points at `src/index.ts`,
 * there is no `dist/`) rather than as a built artifact. That is not laziness:
 * both consumers are bundlers that compile TS themselves (esbuild for scan,
 * SWC via `transpilePackages` for Next), and a `dist/` would add a build-order
 * prerequisite to `pnpm --filter @hetja/scan build` — which today is one
 * esbuild invocation with nothing to build first. It also lets esbuild
 * tree-shake and minify the real source instead of tsc's output, which is how
 * sharing the code costs the scan bundle essentially nothing.
 */

/** ALTCHA v2 challenge parameters, as issued by `POST /api/v1/devices/challenge`
 * (i.e. by `altcha-lib`'s `createChallenge` — see `apps/api/src/lib/device.ts`). */
export interface PowChallengeParameters {
  algorithm: string;
  nonce: string;
  salt: string;
  cost: number;
  keyLength: number;
  keyPrefix: string;
}

/** The full challenge object. `signature` is the server's HMAC over the
 * canonicalised parameters, so the challenge authenticates itself; the client
 * never inspects it, it just hands it back unmodified with the solution. */
export interface PowChallenge {
  parameters: PowChallengeParameters;
  signature?: string;
}

/** What `POST /api/v1/devices/token` expects alongside the challenge. */
export interface PowSolution {
  counter: number;
  derivedKey: string;
}

/**
 * How many `crypto.subtle.digest` calls are issued concurrently per batch.
 *
 * Web Crypto digests are dispatched to a thread pool, so a batch is roughly
 * free parallelism; the number only has to be big enough that the per-await
 * overhead is amortised and small enough that one batch stays well inside a
 * frame. It is deliberately NOT the thing that controls how often the main
 * thread is released — see YIELD_INTERVAL_MS.
 */
export const SOLVE_BATCH = 48;

/**
 * Hand the main thread back only once this much wall clock has passed since
 * the last yield — a frame's worth — rather than once per batch.
 *
 * This number is the whole fix for a solver that could not finish inside its
 * own timeout. One batch of 48 digests is well under a millisecond of real
 * work, so yielding after every batch spent almost all of the budget in the
 * scheduler rather than hashing: browsers clamp a `setTimeout(..., 0)` nested
 * inside a setTimeout-driven chain to 4 ms, which this self-chaining loop hit
 * on its second iteration, so at 20 effective bits (2^20 / 48 = 21,845
 * batches) the solve owed 21,845 x 4 ms = ~87 s of pure timer delay against a
 * 20,000 ms deadline. It could not succeed — measured 4 solves in 10 — and on
 * `apps/scan` that failure surfaces as "Couldn't confirm the report
 * automatically" to a stranger standing over an injured dog, while on
 * `apps/web` it surfaces as a feeder who cannot log in.
 *
 * Budgeting the yields instead makes the tax proportional to elapsed time
 * rather than to hash count: ~60 yields per second of solving, no matter how
 * fast the device hashes, while never blocking the main thread for longer than
 * one frame at a time.
 */
export const YIELD_INTERVAL_MS = 16;

/** Structural shape of the challenge as it arrives over the wire — before any
 * of it can be trusted. Both consumers validate with this rather than casting,
 * because a malformed challenge would otherwise reach `deriveKey` and throw
 * from inside `parseInt`/`DataView` rather than degrading. */
export function isPowChallenge(c: unknown): c is PowChallenge {
  if (!c || typeof c !== "object") return false;
  const p = (c as PowChallenge).parameters;
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

/** True iff the lowercase hex encoding of `bytes` starts with `hex` — the
 * same check altcha-lib's verifySolution applies to the derived key. Handles
 * odd-length prefixes (a trailing nibble compares against the high bits).
 *
 * The odd case is not hypothetical: the server's `keyPrefixForDifficulty`
 * emits one hex character per 4 bits, so difficulty 18 rounds up to 20 bits =
 * `"00000"`, five characters. A prefix check that ignored the trailing nibble
 * would happily return solutions the server rejects with `BAD_POW`. */
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
 * keyLength bytes. `counter` is the raw 32-bit big-endian value — not a
 * decimal string, and not little-endian. Getting that wrong produces a solver
 * that agrees with the server for counters 0..255 and never again, which is
 * indistinguishable from "the PoW is just hard" until someone writes the
 * from-spec test in index.test.ts.
 */
export async function deriveKey(
  params: PowChallengeParameters,
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
 * then continue me" primitive. It is not in the DOM lib types this package
 * compiles against, so it is probed structurally rather than declared as a
 * global. */
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
 * batches — the point of yielding at all — without the solver paying a
 * scheduler tax three orders of magnitude larger than the work it just did.
 * setTimeout stays as the last-resort fallback for a runtime with neither.
 *
 * One channel per solve, not one per yield: allocating 21k MessagePort pairs
 * would trade the timer tax for a GC one. Callers are expected to run at most
 * one solve at a time (both consumers de-duplicate concurrent mints behind a
 * single in-flight promise), and each solve owns its own channel anyway, so
 * two solves cannot interleave on one port.
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
 * Why a PoW solve is impossible in this environment, or `undefined` if it is
 * possible. Exists so a UI can say something true instead of showing a generic
 * failure: `apps/scan` degrades silently on the report path, but `apps/web`'s
 * login page has nowhere to degrade *to* — a feeder who cannot solve a PoW
 * cannot sign in, and deserves to be told which of the two reasons it is.
 *
 * - `"insecure-context"`: `crypto.subtle` is only exposed in a secure context.
 *   `http://localhost` counts as secure, so plain-HTTP local dev works — but
 *   plain-HTTP over the LAN (`http://192.168.x.y:3100`, i.e. testing the dev
 *   server from a phone) does NOT, and neither does any future plain-HTTP
 *   deployment. Production is fine: Cloudflare terminates TLS, so the browser
 *   always sees https://hetja.in.
 * - `"no-web-crypto"`: a secure context (or an unknown one) with no
 *   `crypto.subtle` at all — a genuinely ancient or stripped-down browser.
 *
 * `isSecureContext` is checked first and only when it is explicitly `false`,
 * because that is the case with an actionable explanation. It is `undefined`
 * outside a browser (Node, where these tests run), which must not be mistaken
 * for insecure.
 */
export type PowUnavailableReason = "insecure-context" | "no-web-crypto";

export function powUnavailableReason(): PowUnavailableReason | undefined {
  const secure = (globalThis as { isSecureContext?: boolean }).isSecureContext;
  const hasSubtle = typeof crypto !== "undefined" && !!crypto.subtle;
  if (hasSubtle) return undefined;
  if (secure === false) return "insecure-context";
  return "no-web-crypto";
}

/**
 * Brute-forces an ALTCHA v2 SHA-256 solution: finds a counter whose derived
 * key hex encoding starts with `challenge.parameters.keyPrefix`. Runs in
 * batches of SOLVE_BATCH concurrent Web Crypto digests and yields between
 * batches only once YIELD_INTERVAL_MS of wall clock has elapsed since the last
 * yield — a chunked loop rather than a single synchronous spin, so the main
 * thread is never held for longer than one frame, and the yields cost time
 * proportional to the solve's duration instead of to its hash count. See
 * YIELD_INTERVAL_MS for why yielding per batch made this function unable to
 * finish at all.
 *
 * Returns `undefined` rather than throwing on every failure — no Web Crypto, an
 * algorithm this does not implement, or no solution inside `timeoutMs` — so
 * callers keep one branch for "no token" instead of a try/catch plus a null
 * check. `timeoutMs` is the caller's budget, not ours: the two consumers wait
 * for different humans.
 */
export async function solveAltchaPoW(
  challenge: PowChallenge,
  timeoutMs: number,
): Promise<PowSolution | undefined> {
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
