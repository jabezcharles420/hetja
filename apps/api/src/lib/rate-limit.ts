/**
 * Subject-keyed rate limiting.
 *
 * There was no rate limiter anywhere in this API. The consequence was concrete
 * and cheap to trigger: `POST /api/v1/auth/otp` is unauthenticated, takes an
 * email address, and sends a real message through a provider with a 300/day
 * free tier — synchronously, inside the request. So roughly three hundred
 * unauthenticated requests exhausted the quota and **nobody could log in for
 * the rest of the day**. Anyone reading this public repository could do it with
 * a shell loop.
 *
 * WHY NOT `@fastify/rate-limit`. Its natural key is the IP address, and
 * INVARIANT 6 forbids that outright:
 *
 *   > Rate limits are per account or per attested device token, never per IP.
 *   > Indian mobile carriers do large-scale CGNAT — hundreds of real
 *   > subscribers can share one public IP.
 *
 * A per-IP limit on this system either fails to stop one abuser (who churns
 * addresses) or locks out an entire carrier's users at once. The plugin can be
 * re-keyed, but then it is carrying a dependency, a store, and a hook chain to
 * do what forty lines do — and it invites the next person to reach for the
 * default. So: a token bucket, keyed by whatever subject the CALLER decides is
 * right, which forces that decision to be made explicitly at each call site.
 *
 * The shape is a token bucket rather than a fixed window because a fixed window
 * lets an attacker send the whole allowance twice across a boundary, and
 * because a bucket lets a legitimate user who mistypes their email retry
 * immediately while still bounding sustained abuse.
 *
 * Memory is bounded by an LRU. Evicting a bucket is equivalent to forgiving its
 * consumption, which is the safe direction to fail: under enough pressure to
 * evict, the global cap (below) is the backstop, and wrongly locking out a real
 * feeder on a life-safety adjacent system is worse than admitting one extra
 * request.
 */
import { LRUCache } from "lru-cache";

export interface RateLimitRule {
  /** Sustained rate, in requests per second. */
  refillPerSec: number;
  /** Maximum burst, i.e. bucket capacity. */
  burst: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Whole seconds until one token is available. 0 when allowed. */
  retryAfterSec: number;
}

interface Bucket {
  tokens: number;
  refilledAt: number;
}

/**
 * A named limiter. One instance per policy, not per subject — subjects are the
 * keys inside it.
 */
export class RateLimiter {
  private readonly buckets: LRUCache<string, Bucket>;

  constructor(
    private readonly rule: RateLimitRule,
    maxSubjects = 10_000,
  ) {
    this.buckets = new LRUCache<string, Bucket>({ max: maxSubjects });
  }

  /**
   * Consumes one token for `subject`. `now` is injectable so the tests can
   * advance time without sleeping — a limiter tested with real sleeps is a
   * limiter that is either slow or untested at its boundaries.
   */
  consume(subject: string, now: number = Date.now()): RateLimitDecision {
    const existing = this.buckets.get(subject);
    const bucket: Bucket = existing ?? { tokens: this.rule.burst, refilledAt: now };

    const elapsedSec = Math.max(0, (now - bucket.refilledAt) / 1000);
    bucket.tokens = Math.min(this.rule.burst, bucket.tokens + elapsedSec * this.rule.refillPerSec);
    bucket.refilledAt = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.buckets.set(subject, bucket);
      return { allowed: true, retryAfterSec: 0 };
    }

    this.buckets.set(subject, bucket);
    const deficit = 1 - bucket.tokens;
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil(deficit / this.rule.refillPerSec)),
    };
  }

  /** Test seam. Never call this from a route. */
  reset(): void {
    this.buckets.clear();
  }
}

/**
 * Login codes, per identity.
 *
 * The subject is `identity_hmac`, NOT the raw email and NOT the IP — the same
 * value the OTP row is keyed on, so an attacker cannot dodge the limit by
 * varying the case or the plus-addressing of an address that maps to one
 * account.
 *
 * 5 burst, refilling at one per 60s. A real person who mistypes an address and
 * retries a few times is unaffected; a script pointed at one address is capped
 * at roughly sixty mails an hour instead of the whole daily quota in a minute.
 */
export const otpPerIdentity = new RateLimiter({ refillPerSec: 1 / 60, burst: 5 });

/**
 * Login codes, whole system.
 *
 * The backstop that actually protects the vendor quota, because per-identity
 * limits do not compose: an attacker with ten thousand addresses is within
 * every per-identity budget and still drains the tier.
 *
 * 200/day sustained against a 300/day plan, with a burst of 40. The headroom is
 * deliberate: exhausting the quota means no user can log in until midnight,
 * whereas hitting this cap means the CURRENT wave is refused while genuine
 * users still have ~100 mails of room. Leaving that margin is the difference
 * between degraded and dead.
 *
 * NOTE: this is per PROCESS. One API process runs today. If a second is ever
 * added, this becomes a per-process cap and the real ceiling doubles — at which
 * point the counter belongs in PostgreSQL, next to `otp_codes`.
 */
export const otpGlobal = new RateLimiter({ refillPerSec: 200 / 86_400, burst: 40 }, 1);

/** Fixed key for a limiter with a single global bucket. */
export const GLOBAL_SUBJECT = "global";
