/**
 * Tests for the shared ALTCHA v2 proof-of-work solver.
 *
 * This is the canonical pin for the client half of INVARIANT 6's device
 * attestation. `apps/scan` and `apps/web` both mint device tokens with the code
 * under test, and the derivation has to agree with `altcha-lib` on the server
 * *byte for byte* or `POST /api/v1/devices/token` answers `BAD_POW` — which
 * surfaces to a stranger as "Couldn't confirm the report automatically" on the
 * scan page, and to a feeder as a login that cannot succeed.
 *
 * On the reference implementation: `expectedDerivedKey` is written from ALTCHA's
 * *specification* — `SHA-256^cost(salt ‖ nonce ‖ uint32BE(counter))`, truncated
 * to `keyLength` — using Web Crypto directly, deliberately NOT by calling the
 * code under test. A test that checks an implementation against itself proves
 * only that it is deterministic. The definitive cross-check against the real
 * `altcha-lib` lives in `apps/api/src/routes/devices.test.ts`, where the library
 * is a genuine dependency; this file pins the client half so the two cannot
 * drift without something going red.
 *
 * Two defects shipped into the gap where these tests should have been, back when
 * this code lived in `apps/scan/src/device.ts` and `apps/scan` had no `test`
 * script at all:
 *
 *   - the effective difficulty was 20 bits, not the 18 that was configured
 *     (ALTCHA encodes difficulty as a hex prefix, so it rounds up to a nibble),
 *     and
 *   - the solver yielded with `setTimeout(0)` after every 48-hash batch, which
 *     the browser clamps to 4 ms once nesting exceeds 5 — ~87 s of pure timer
 *     delay against a 20 s budget.
 */
import { describe, expect, it } from "vitest";
import {
  bytesToHex,
  deriveKey,
  hexStartsWith,
  hexToBytes,
  isPowChallenge,
  makeYielder,
  powUnavailableReason,
  solveAltchaPoW,
  SOLVE_BATCH,
  YIELD_INTERVAL_MS,
  type PowChallengeParameters,
} from "./index.js";

function params(over: Partial<PowChallengeParameters> = {}): PowChallengeParameters {
  return {
    algorithm: "SHA-256",
    // 16-byte nonce and salt, matching what altcha-lib's createChallenge emits.
    nonce: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
    salt: "00112233445566778899aabbccddeeff",
    cost: 1,
    keyLength: 32,
    keyPrefix: "00",
    ...over,
  };
}

/** ALTCHA SHA-256 derivation, written from the spec rather than from our code. */
async function expectedDerivedKey(p: PowChallengeParameters, counter: number): Promise<string> {
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

describe("@hetja/pow", () => {
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

  describe("isPowChallenge", () => {
    it("accepts a well-formed challenge", () => {
      expect(isPowChallenge({ parameters: params(), signature: "sig" })).toBe(true);
    });

    it("rejects anything that would blow up inside deriveKey", () => {
      expect(isPowChallenge(undefined)).toBe(false);
      expect(isPowChallenge(null)).toBe(false);
      expect(isPowChallenge("challenge")).toBe(false);
      expect(isPowChallenge({})).toBe(false);
      // A string cost/keyLength is the realistic wire-level accident, and it is
      // the one that makes the solve loop spin to its deadline instead of
      // failing fast.
      expect(isPowChallenge({ parameters: { ...params(), cost: "1" } })).toBe(false);
      expect(isPowChallenge({ parameters: { ...params(), keyPrefix: 0 } })).toBe(false);
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

    it("solves the difficulty production actually configures", async () => {
      // DEVICE_POW_DIFFICULTY defaults to 16 -> keyPrefix "0000". This is the
      // real thing, not a scaled-down stand-in: ~65k expected attempts.
      const p = params({ keyPrefix: "0000" });
      const solution = await solveAltchaPoW({ parameters: p, signature: "x" }, 20_000);
      expect(solution).toBeDefined();
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
    it("yields on a wall-clock interval, not once per batch", () => {
      // The bug was one 4 ms-clamped timer per 48 hashes. 2**20/48 = 21,845
      // yields = ~87 s of timer delay alone. A wall-clock interval makes the
      // yield count independent of batch size.
      expect(YIELD_INTERVAL_MS).toBeGreaterThan(0);
      expect(SOLVE_BATCH).toBeGreaterThan(0);
      const yieldsIfPerBatch = 2 ** 20 / SOLVE_BATCH;
      expect(yieldsIfPerBatch * 4).toBeGreaterThan(20_000); // the old bug, stated
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

  describe("powUnavailableReason", () => {
    it("reports nothing to report where Web Crypto exists", () => {
      expect(powUnavailableReason()).toBeUndefined();
    });

    it("blames the insecure context when crypto.subtle is missing and the context says so", () => {
      // The plain-HTTP-over-LAN case: `http://192.168.1.5:3100` on a phone.
      // localhost is exempt (browsers treat it as a secure context), which is
      // why local dev works and this failure only shows up on a real device.
      const realCrypto = globalThis.crypto;
      const realSecure = (globalThis as { isSecureContext?: boolean }).isSecureContext;
      try {
        Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
        Object.defineProperty(globalThis, "isSecureContext", { value: false, configurable: true });
        expect(powUnavailableReason()).toBe("insecure-context");

        Object.defineProperty(globalThis, "isSecureContext", { value: true, configurable: true });
        expect(powUnavailableReason()).toBe("no-web-crypto");
      } finally {
        Object.defineProperty(globalThis, "crypto", { value: realCrypto, configurable: true });
        if (realSecure === undefined) {
          delete (globalThis as { isSecureContext?: boolean }).isSecureContext;
        } else {
          Object.defineProperty(globalThis, "isSecureContext", {
            value: realSecure,
            configurable: true,
          });
        }
      }
    });
  });
});
