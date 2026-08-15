/**
 * Rate limiter behaviour.
 *
 * There was no rate limiter in this API at all, and the endpoint that most
 * needed one — `POST /api/v1/auth/otp` — is unauthenticated and sends a real
 * email synchronously against a 300/day free tier. ~300 requests locked every
 * user out of login for the rest of the day.
 *
 * Time is injected rather than slept, so the refill boundaries are tested
 * exactly. A limiter verified with real sleeps is either slow or only tested
 * in the middle of its range, which is not where limiters go wrong.
 */
import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit.js";

describe("RateLimiter", () => {
  it("allows up to the burst, then refuses", () => {
    const rl = new RateLimiter({ refillPerSec: 1 / 60, burst: 3 });
    const t = 1_000_000;
    expect(rl.consume("a", t).allowed).toBe(true);
    expect(rl.consume("a", t).allowed).toBe(true);
    expect(rl.consume("a", t).allowed).toBe(true);
    expect(rl.consume("a", t).allowed).toBe(false);
  });

  it("keeps subjects independent — one abuser cannot lock out everyone", () => {
    // The whole point of subject-keying. Under a per-IP limiter, CGNAT would
    // make these two the same subject and INVARIANT 6 exists to forbid that.
    const rl = new RateLimiter({ refillPerSec: 1 / 60, burst: 2 });
    const t = 1_000_000;
    expect(rl.consume("attacker", t).allowed).toBe(true);
    expect(rl.consume("attacker", t).allowed).toBe(true);
    expect(rl.consume("attacker", t).allowed).toBe(false);
    // A different identity behind the very same address is untouched.
    expect(rl.consume("real-user", t).allowed).toBe(true);
  });

  it("refills over time, and not before", () => {
    const rl = new RateLimiter({ refillPerSec: 1 / 60, burst: 1 });
    const t0 = 1_000_000;
    expect(rl.consume("a", t0).allowed).toBe(true);
    expect(rl.consume("a", t0 + 59_000).allowed).toBe(false); // 59s: not yet
    expect(rl.consume("a", t0 + 60_000).allowed).toBe(true); // 60s: exactly one
  });

  it("never accumulates more than the burst, however long it idles", () => {
    // Guards the classic token-bucket bug: an account dormant for a month must
    // not bank a month of allowance and release it in one burst.
    const rl = new RateLimiter({ refillPerSec: 1, burst: 3 });
    const t0 = 1_000_000;
    rl.consume("a", t0);
    const muchLater = t0 + 30 * 24 * 3_600_000;
    expect(rl.consume("a", muchLater).allowed).toBe(true);
    expect(rl.consume("a", muchLater).allowed).toBe(true);
    expect(rl.consume("a", muchLater).allowed).toBe(true);
    expect(rl.consume("a", muchLater).allowed).toBe(false);
  });

  it("reports a retry-after that is actually long enough", () => {
    const rl = new RateLimiter({ refillPerSec: 1 / 60, burst: 1 });
    const t0 = 1_000_000;
    rl.consume("a", t0);
    const denied = rl.consume("a", t0);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThan(0);
    // Honouring the advice must actually work — a Retry-After that still fails
    // teaches clients to ignore it.
    expect(rl.consume("a", t0 + denied.retryAfterSec * 1000).allowed).toBe(true);
  });

  it("never returns a retry-after of zero when it refuses", () => {
    // 0 would read as "retry immediately", producing a hot loop against the
    // very endpoint being protected.
    const rl = new RateLimiter({ refillPerSec: 1000, burst: 1 });
    const t0 = 1_000_000;
    rl.consume("a", t0);
    const denied = rl.consume("a", t0);
    if (!denied.allowed) expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1);
  });
});
