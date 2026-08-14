/**
 * Tests for the feeder PWA's attested device token flow.
 *
 * What went wrong, and what these tests are therefore about: the login page used
 * to send a bare `uuid()` as its device token. `POST /api/v1/auth/verify` gates
 * on `verifyDeviceToken`, whose first act is to find the `.` separating the
 * base64url deviceId from its HMAC — a UUID has none, so the guard `dot <= 0`
 * rejected it and every web login attempt in the app's history returned 401.
 * There was no test asserting anything about the *shape* of what was sent, which
 * is precisely why it could ship and stay shipped.
 *
 * These tests drive the real `request<T>()` path with a mocked `fetch`, rather
 * than mocking `@/lib/api`, so they pin the actual HTTP conversation:
 * `POST /devices/challenge`, then `POST /devices/token` carrying the challenge
 * back unmodified with a solution, then a token that has the attested shape.
 *
 * The solution's correctness is checked against a from-spec ALTCHA derivation
 * written out here (`expectedDerivedKey`), not by calling the solver again. The
 * solver itself is pinned in `packages/pow/src/index.test.ts`; what matters here
 * is that this module hands the server a (counter, derivedKey) pair the server
 * will accept, because a mismatch is a 401 BAD_POW and therefore a feeder who
 * cannot log in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bytesToHex, hexToBytes, type PowChallenge } from "@hetja/pow";
import { API_BASE, getAccessToken, setAccessToken } from "./api";
import {
  DEVICE_TOKEN_KEY,
  deviceTokenFailureMessage,
  getDeviceToken,
  isAttestedTokenShape,
  LEGACY_DEVICE_TOKEN_KEY,
  readCachedDeviceToken,
  clearCachedDeviceToken,
  type DeviceTokenFailure,
} from "./device";

/** Shaped like a real `issueDeviceToken()` output: base64url(deviceId) "."
 * base64url(HMAC). Only the shape matters client-side. */
const MINTED = "MDZlNWFjM2YtODU5NS00OTZlLTg5YzAtZDYxZTY3YmVmMTllLA.qFq8kQ0mS7Vh2wAeQ1nZbGx0ZmYtc2ln";

/** The exact garbage a browser that ever opened the old login page still has
 * cached under `hetja.deviceToken`. */
const STALE_UUID = "06e5ac3f-8595-496e-89c0-d61e67bef19e";

function challenge(over: Partial<PowChallenge["parameters"]> = {}): PowChallenge {
  return {
    parameters: {
      algorithm: "SHA-256",
      nonce: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
      salt: "00112233445566778899aabbccddeeff",
      cost: 1,
      keyLength: 32,
      // 8 effective bits (~256 digests) -- enough to exercise the real loop
      // without spending the production difficulty's ~65k on every test run.
      keyPrefix: "00",
      ...over,
    },
    signature: "hmac-over-the-parameters",
  };
}

/** ALTCHA SHA-256 derivation from the specification, not from our solver. */
async function expectedDerivedKey(p: PowChallenge["parameters"], counter: number): Promise<string> {
  const salt = hexToBytes(p.salt);
  const nonce = hexToBytes(p.nonce);
  const input = new Uint8Array(salt.length + nonce.length + 4);
  input.set(salt, 0);
  input.set(nonce, salt.length);
  new DataView(input.buffer).setUint32(salt.length + nonce.length, counter, false);
  let digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  for (let i = 1; i < p.cost; i++) digest = new Uint8Array(await crypto.subtle.digest("SHA-256", digest));
  return bytesToHex(digest.slice(0, p.keyLength));
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface MintRoutes {
  challengeResponse?: () => Response;
  tokenResponse?: () => Response;
}

type FetchMock = ReturnType<typeof vi.fn>;

/** Routes the two mint calls by URL, so a test can break exactly one of them. */
function stubMint(routes: MintRoutes = {}): FetchMock {
  const okChallenge = () =>
    jsonResponse(200, { ok: true, data: { challenge: challenge(), difficulty: 8 } });
  const okToken = () => jsonResponse(200, { ok: true, data: { deviceToken: MINTED } });

  const fetchMock = vi.fn();
  fetchMock.mockImplementation((url: string) => {
    if (url === `${API_BASE}/devices/challenge`) {
      return Promise.resolve((routes.challengeResponse ?? okChallenge)());
    }
    if (url === `${API_BASE}/devices/token`) {
      return Promise.resolve((routes.tokenResponse ?? okToken)());
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function callsTo(fetchMock: FetchMock, path: string): [string, RequestInit][] {
  return (fetchMock.mock.calls as [string, RequestInit][]).filter(
    ([url]) => url === `${API_BASE}${path}`,
  );
}

function bodyOf(fetchMock: FetchMock, path: string): unknown {
  const call = callsTo(fetchMock, path)[0];
  if (!call) throw new Error(`no request to ${path}`);
  return JSON.parse(call[1].body as string);
}

describe("lib/device", () => {
  beforeEach(() => {
    // The module memoises only the *in-flight* mint, and that self-clears when the
    // promise settles, so a cold localStorage is all a test needs. (vitest.setup.ts
    // also clears the storage stub after every test.)
    clearCachedDeviceToken();
  });

  describe("isAttestedTokenShape", () => {
    it("accepts the two-part base64url shape issueDeviceToken produces", () => {
      expect(isAttestedTokenShape(MINTED)).toBe(true);
    });

    // The whole bug, as a single assertion.
    it("rejects the bare UUID the old login page sent", () => {
      expect(isAttestedTokenShape(STALE_UUID)).toBe(false);
    });

    it("rejects anything without exactly one usable separator", () => {
      expect(isAttestedTokenShape("")).toBe(false);
      expect(isAttestedTokenShape(null)).toBe(false);
      expect(isAttestedTokenShape(undefined)).toBe(false);
      expect(isAttestedTokenShape("nodot")).toBe(false);
      expect(isAttestedTokenShape(".sig")).toBe(false); // dot <= 0 on the server
      expect(isAttestedTokenShape("id.")).toBe(false);
      expect(isAttestedTokenShape("id.sig.extra")).toBe(false);
    });

    // Non-canonical base64url is what turned one proof-of-work solve into
    // unlimited SOS budget (see apps/api/src/lib/device.ts's header). The server
    // rejects these outright now, so a client that cached one must not keep
    // sending it and blaming the server.
    it("rejects padded and whitespace-padded variants", () => {
      expect(isAttestedTokenShape("aWQ.c2ln=")).toBe(false);
      expect(isAttestedTokenShape("aWQ.c2ln\n")).toBe(false);
      expect(isAttestedTokenShape("aWQ.c2ln!")).toBe(false);
      expect(isAttestedTokenShape(" aWQ.c2ln")).toBe(false);
    });
  });

  describe("readCachedDeviceToken", () => {
    it("returns a cached token that has the attested shape", () => {
      localStorage.setItem(DEVICE_TOKEN_KEY, MINTED);
      expect(readCachedDeviceToken()).toBe(MINTED);
    });

    // Not merely "ignores": if it were left in place, the next reader added to
    // this file would have to remember to screen it too.
    it("deletes a non-conforming value instead of returning it", () => {
      localStorage.setItem(DEVICE_TOKEN_KEY, STALE_UUID);
      expect(readCachedDeviceToken()).toBeUndefined();
      expect(localStorage.getItem(DEVICE_TOKEN_KEY)).toBeNull();
    });

    it("clears the legacy hetja.deviceToken key every browser still has", () => {
      localStorage.setItem(LEGACY_DEVICE_TOKEN_KEY, STALE_UUID);
      expect(readCachedDeviceToken()).toBeUndefined();
      expect(localStorage.getItem(LEGACY_DEVICE_TOKEN_KEY)).toBeNull();
    });

    it("never promotes the legacy value to the current key", () => {
      localStorage.setItem(LEGACY_DEVICE_TOKEN_KEY, STALE_UUID);
      readCachedDeviceToken();
      expect(localStorage.getItem(DEVICE_TOKEN_KEY)).toBeNull();
    });
  });

  describe("getDeviceToken", () => {
    it("mints a token the server would accept, and caches it", async () => {
      const fetchMock = stubMint();

      const outcome = await getDeviceToken();

      expect(outcome).toEqual({ ok: true, token: MINTED, minted: true });
      expect(localStorage.getItem(DEVICE_TOKEN_KEY)).toBe(MINTED);

      // The challenge must be handed back byte-identical: it carries an HMAC over
      // its own parameters, so a re-serialised or "tidied" copy fails with
      // BAD_CHALLENGE.
      const sent = bodyOf(fetchMock, "/devices/token") as {
        challenge: PowChallenge;
        solution: { counter: number; derivedKey: string };
      };
      expect(sent.challenge).toEqual(challenge());

      // And the solution must be one the server's own re-derivation reproduces.
      expect(sent.solution.derivedKey).toBe(
        await expectedDerivedKey(challenge().parameters, sent.solution.counter),
      );
      expect(sent.solution.derivedKey.startsWith("00")).toBe(true);
    });

    it("reuses the cached token without touching the network", async () => {
      localStorage.setItem(DEVICE_TOKEN_KEY, MINTED);
      const fetchMock = stubMint();

      await expect(getDeviceToken()).resolves.toEqual({ ok: true, token: MINTED, minted: false });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("shares one solve between concurrent callers", async () => {
      const fetchMock = stubMint();

      // The login page calls this twice on the happy path (speculatively when the
      // code is requested, then again at verify time). A second proof-of-work
      // solve would be pure waste on a phone.
      const [a, b] = await Promise.all([getDeviceToken(), getDeviceToken()]);

      expect(a).toEqual(b);
      expect(callsTo(fetchMock, "/devices/challenge")).toHaveLength(1);
    });

    it("reports challenge-unavailable when the challenge cannot be fetched", async () => {
      stubMint({ challengeResponse: () => jsonResponse(500, { ok: false, error: { message: "boom" } }) });
      await expect(getDeviceToken()).resolves.toEqual({ ok: false, reason: "challenge-unavailable" });
    });

    it("reports challenge-unavailable on a malformed challenge rather than throwing", async () => {
      // A string `cost` reaches DataView and throws from inside the solver if it
      // is not screened; the user would see an unhandled rejection, not a message.
      stubMint({
        challengeResponse: () =>
          jsonResponse(200, {
            ok: true,
            data: { challenge: { parameters: { ...challenge().parameters, cost: "1" } }, difficulty: 8 },
          }),
      });
      await expect(getDeviceToken()).resolves.toEqual({ ok: false, reason: "challenge-unavailable" });
    });

    it("reports pow-timeout when no solution can be produced", async () => {
      // An algorithm the solver does not implement makes solveAltchaPoW give up
      // immediately, which is the same outcome as exhausting the budget without
      // spending the real SOLVE_TIMEOUT_MS (20 s) to prove it.
      stubMint({
        challengeResponse: () =>
          jsonResponse(200, { ok: true, data: { challenge: challenge({ algorithm: "SHA-512" }), difficulty: 8 } }),
      });
      await expect(getDeviceToken()).resolves.toEqual({ ok: false, reason: "pow-timeout" });
    });

    it("reports mint-rejected when the server refuses the solution", async () => {
      // BAD_POW / CHALLENGE_EXPIRED / CHALLENGE_REUSED all land here.
      stubMint({
        tokenResponse: () =>
          jsonResponse(401, { ok: false, error: { message: "proof of work invalid", code: "BAD_POW" } }),
      });
      await expect(getDeviceToken()).resolves.toEqual({ ok: false, reason: "mint-rejected" });
      expect(localStorage.getItem(DEVICE_TOKEN_KEY)).toBeNull();
    });

    it("refuses to cache a minted value that is not shaped like a token", async () => {
      // Defensive: if the API ever starts answering with something else, the old
      // failure mode was to cache it and 401 forever after.
      stubMint({ tokenResponse: () => jsonResponse(200, { ok: true, data: { deviceToken: STALE_UUID } }) });
      await expect(getDeviceToken()).resolves.toEqual({ ok: false, reason: "mint-rejected" });
      expect(localStorage.getItem(DEVICE_TOKEN_KEY)).toBeNull();
    });

    it("never sends an Authorization header while minting", async () => {
      // These routes are unauthenticated by design -- they are how a browser with
      // no session gets its first credential -- and a 401 from them says nothing
      // about the session.
      setAccessToken("tok-abc");
      const fetchMock = stubMint();

      await getDeviceToken();

      for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
        expect(init.headers).not.toHaveProperty("authorization");
      }
      expect(getAccessToken()).toBe("tok-abc");
    });
  });

  describe("deviceTokenFailureMessage", () => {
    const reasons: DeviceTokenFailure[] = [
      "insecure-context",
      "no-web-crypto",
      "challenge-unavailable",
      "pow-timeout",
      "mint-rejected",
    ];

    it("has distinct, non-empty copy for every failure", () => {
      const messages = reasons.map(deviceTokenFailureMessage);
      for (const m of messages) expect(m.length).toBeGreaterThan(20);
      expect(new Set(messages).size).toBe(reasons.length);
    });

    // The trap this project actually has: crypto.subtle needs a secure context,
    // localhost counts as one, a LAN IP over plain HTTP does not. Testing from a
    // phone against `pnpm dev` therefore cannot sign in, and the message has to
    // say so rather than blaming the code the feeder typed.
    it("explains the plain-HTTP case in terms the user can act on", () => {
      const msg = deviceTokenFailureMessage("insecure-context");
      expect(msg).toContain("http");
      expect(msg.toLowerCase()).toContain("secure");
    });
  });
});
