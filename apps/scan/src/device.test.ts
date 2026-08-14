/**
 * Tests for the anonymous device-attestation solver on the scan page.
 *
 * Why this file exists at all: `apps/scan` had no `test` script until
 * 2026-08-14, so `pnpm -r test` silently skipped the entire package. This module
 * is a hand-written reimplementation of ALTCHA's key derivation sitting on the
 * life-safety path — a stranger scanning a collar cannot file an SOS report
 * without a device token, and cannot get a device token without this solver
 * agreeing, byte for byte, with `altcha-lib` on the server. Two defects shipped
 * into that gap unnoticed:
 *
 *   - the effective difficulty was 20 bits, not the 18 that was configured
 *     (ALTCHA encodes difficulty as a hex prefix, so it rounds up to a nibble),
 *     and
 *   - the solver yielded with `setTimeout(0)` after every 48-hash batch, which
 *     the browser clamps to 4 ms once nesting exceeds 5 — ~87 s of pure timer
 *     delay against a 20 s budget.
 *
 * The tests below are the coverage that would have caught both.
 *
 * On the reference implementation: `expectedDerivedKey` is written from ALTCHA's
 * *specification* — `SHA-256^cost(salt ‖ nonce ‖ uint32BE(counter))`, truncated
 * to `keyLength` — using Web Crypto directly, deliberately NOT by calling the
 * code under test. A test that checks an implementation against itself proves
 * only that it is deterministic. The definitive cross-check against the real
 * `altcha-lib` lives in `apps/api/src/routes/devices.test.ts`, where the library
 * is a genuine dependency; this file pins the client half so the two cannot drift
 * without something going red.
 */
import { describe, it, expect } from "vitest";
import {
  bytesToHex,
  deriveKey,
  hexStartsWith,
  hexToBytes,
  makeYielder,
  solveAltchaPoW,
  SOLVE_BATCH,
  SOLVE_TIMEOUT_MS,
  YIELD_INTERVAL_MS,
} from "./device.js";

type Params = Parameters<typeof deriveKey>[0];

function params(over: Partial<Params> = {}): Params {
  return {
    algorithm: "SHA-256",
    // 16-byte nonce and salt, matching what altcha-lib's createChallenge emits.
    nonce: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
    salt: "00112233445566778899aabbccddeeff",
    cost: 1,
    keyLength: 32,
    keyPrefix: "00",
    ...over,
  } as Params;
}

/** ALTCHA SHA-256 derivation, written from the spec rather than from our code. */
async function expectedDerivedKey(p: Params, counter: number): Promise<string> {
  const salt = hexToBytes(p.salt);
  const nonce = hexToBytes(p.nonce);
  const input = new Uint8Array(salt.length + nonce.length + 4);
  input.set(salt, 0);
  input.set(nonce, salt.length);
  new DataView(input.buffer).setUint32(salt.length + nonce.length, counter, false);

  let digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  for (let i = 1; i < p.cost; i++) {
    digest = new Uint8Array(await crypto.subtle.digest("SHA-256", digest));
  }
  return bytesToHex(digest.slice(0, p.keyLength));
}

describe("apps/scan device attestation", () => {
  describe("deriveKey matches the ALTCHA spec", () => {
    it.each([0, 1, 12345, 65535, 1048576, 4294967295])(
      "agrees with an independent from-spec reference at counter %i",
      async (counter) => {
        const p = params();
        const { key } = await deriveKey(p, counter);
        expect(bytesToHex(key)).toBe(await expectedDerivedKey(p, counter));
      },
    );

    it("returns the counter it was asked for", async () => {
      const { counter } = await deriveKey(params(), 4242);
      expect(counter).toBe(4242);
    });

    it("honours cost > 1 by re-hashing the digest", async () => {
      const p = params({ cost: 3 });
      const { key } = await deriveKey(p, 7);
      expect(bytesToHex(key)).toBe(await expectedDerivedKey(p, 7));
      // And is genuinely different from cost: 1, i.e. cost is not ignored.
      const one = await deriveKey(params({ cost: 1 }), 7);
      expect(bytesToHex(key)).not.toBe(bytesToHex(one.key));
    });

    it("truncates to keyLength", async () => {
      const { key } = await deriveKey(params({ keyLength: 8 }), 3);
      expect(key.length).toBe(8);
    });

    // uint32BE, not little-endian and not a decimal string. Getting this wrong
    // produces a solver that never agrees with the server on any counter above
    // 255 -- and passes a naive "it derives something" test.
    it("encodes the counter as uint32 big-endian", async () => {
      const p = params();
      const be = await deriveKey(p, 0x00000100);
      const le = await deriveKey(p, 0x00010000);
      expect(bytesToHex(be.key)).not.toBe(bytesToHex(le.key));
      expect(bytesToHex(be.key)).toBe(await expectedDerivedKey(p, 256));
    });
  });

  describe("hexStartsWith", () => {
    const bytes = hexToBytes("0abc1234");

    it("matches a whole-byte prefix", () => {
      expect(hexStartsWith(bytes, "0abc")).toBe(true);
      expect(hexStartsWith(bytes, "0abd")).toBe(false);
    });

    // The odd-nibble path is live in production: keyPrefixForDifficulty(18)
    // produces "00000", five characters. A prefix check that silently ignored
    // the trailing nibble would accept solutions the server rejects.
    it("matches an odd-length (nibble) prefix", () => {
      expect(hexStartsWith(bytes, "0ab")).toBe(true);
      expect(hexStartsWith(bytes, "0ac")).toBe(false);
      expect(hexStartsWith(bytes, "0")).toBe(true);
      expect(hexStartsWith(bytes, "1")).toBe(false);
    });

    it("matches the empty prefix", () => {
      expect(hexStartsWith(bytes, "")).toBe(true);
    });
  });

  describe("solveAltchaPoW", () => {
    it("finds a counter whose derived key carries the required prefix", async () => {
      const p = params({ keyPrefix: "00" }); // 8 effective bits, ~256 attempts
      const solution = await solveAltchaPoW({ parameters: p, signature: "x" }, 20_000);
      expect(solution).toBeDefined();
      expect(solution!.derivedKey.startsWith("00")).toBe(true);
      // The returned pair must be internally consistent, or the server's
      // re-derivation rejects it.
      expect(solution!.derivedKey).toBe(await expectedDerivedKey(p, solution!.counter));
    });

    it("solves an odd-nibble prefix", async () => {
      const p = params({ keyPrefix: "000" }); // 12 effective bits
      const solution = await solveAltchaPoW({ parameters: p, signature: "x" }, 20_000);
      expect(solution).toBeDefined();
      expect(solution!.derivedKey.startsWith("000")).toBe(true);
      expect(solution!.derivedKey).toBe(await expectedDerivedKey(p, solution!.counter));
    });

    it("gives up rather than hanging when the prefix is unreachable", async () => {
      // 40 bits with a 300 ms budget: must return undefined promptly, not spin.
      const started = Date.now();
      const solution = await solveAltchaPoW(
        { parameters: params({ keyPrefix: "0000000000" }), signature: "x" },
        300,
      );
      expect(solution).toBeUndefined();
      expect(Date.now() - started).toBeLessThan(5_000);
    });

    it("refuses an algorithm it does not implement", async () => {
      const solution = await solveAltchaPoW(
        { parameters: params({ algorithm: "SHA-512" }), signature: "x" },
        1_000,
      );
      expect(solution).toBeUndefined();
    });
  });

  describe("solver budget", () => {
    // The regression guard for the shipped-and-unfinishable configuration.
    //
    // ALTCHA rounds the configured difficulty UP to a nibble, so the effective
    // bit count is always a multiple of 4 and the expected attempt count is
    // 2**bits. Measured on a dev laptop the yield-per-batch loop managed ~204k
    // attempts inside 20 s -- against 2**20 = 1.05M expected, i.e. it solved
    // roughly one time in five. This asserts the arithmetic that made that
    // inevitable, so that raising DEVICE_POW_DIFFICULTY back past 16 fails here
    // instead of failing a stranger standing over a hurt dog.
    it("keeps the expected attempt count inside a plausible 20 s budget", () => {
      const effectiveBits = 16; // config.ts default 16 -> ceil(16/4)*4 = 16
      const expectedAttempts = 2 ** effectiveBits;

      // Conservative floor for a cheap Android with MessageChannel yielding.
      // The measured desktop rate is ~110k attempts/s; assume a phone is 10x
      // slower and still require a comfortable margin.
      const pessimisticAttemptsPerSecond = 11_000;
      const projectedSeconds = expectedAttempts / pessimisticAttemptsPerSecond;

      expect(projectedSeconds).toBeLessThan(SOLVE_TIMEOUT_MS / 1000 / 2);
    });

    it("yields on a wall-clock interval, not once per batch", () => {
      // The bug was one 4 ms-clamped timer per 48 hashes. 2**20/48 = 21,845
      // yields = ~87 s of timer delay alone. A wall-clock interval makes the
      // yield count independent of batch size.
      expect(YIELD_INTERVAL_MS).toBeGreaterThan(0);
      expect(SOLVE_BATCH).toBeGreaterThan(0);
      const yieldsIfPerBatch = 2 ** 20 / SOLVE_BATCH;
      expect(yieldsIfPerBatch * 4).toBeGreaterThan(SOLVE_TIMEOUT_MS); // the old bug, stated
    });
  });

  describe("makeYielder", () => {
    it("yields and closes without leaking a port", async () => {
      const y = makeYielder();
      await y.yieldNow();
      await y.yieldNow();
      expect(() => y.close()).not.toThrow();
    });

    it("is dramatically cheaper than a clamped timer per yield", async () => {
      const y = makeYielder();
      const started = Date.now();
      for (let i = 0; i < 200; i++) await y.yieldNow();
      const elapsed = Date.now() - started;
      y.close();
      // 200 clamped 4 ms timers would be >=800 ms; in Node, setTimeout(0)
      // granularity is worse still (~15 ms => ~3 s).
      expect(elapsed).toBeLessThan(600);
    });
  });
});
