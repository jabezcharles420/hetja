/**
 * Subject-keyed rate limiting.
 *
 * There was no rate limiter anywhere in this API. The consequence was concrete
 * and cheap to trigger: `POST /api/v1/auth/otp` is unauthenticated, takes an
 * email address, and sends a real message through a provider with a 300/day
 * free tier, synchronously, inside the request. So roughly three hundred
 * unauthenticated requests exhausted the quota and **nobody could log in for
 * the rest of the day**. Anyone reading this public repository could do it with
 * a shell loop.
 *
 * WHY NOT `@fastify/rate-limit`. Its natural key is the IP address, and
 * INVARIANT 6 forbids that outright:
 *
 *   > Rate limits are per account or per attested device token, never per IP.
 *   > Indian mobile carriers do large-scale CGNAT: hundreds of real
 *   > subscribers can share one public IP.
 *
 * A per-IP limit on this system either fails to stop one abuser (who churns
 * addresses) or locks out an entire carrier's users at once. The plugin can be
 * re-keyed, but then it is carrying a dependency, a store, and a hook chain to
 * do what forty lines do, and it invites the next person to reach for the
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
import { isIP } from "node:net";
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
 * A named limiter. One instance per policy, not per subject; subjects are the
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
   * advance time without sleeping. A limiter tested with real sleeps is a
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

  /**
   * Would `consume` allow `subject` right now? Reads the bucket without taking
   * a token, so a caller gating one action on TWO limiters can check both
   * before charging either; otherwise a request refused by the second limiter
   * has already spent a token on the first. routes/auth.ts's OTP send is that
   * caller: its comment promised "both limits are checked before either is
   * consumed" while the code consumed the per-identity bucket, then checked the
   * global one, so a user turned away by the global cap also lost one of their
   * five personal codes for nothing.
   */
  peek(subject: string, now: number = Date.now()): RateLimitDecision {
    const existing = this.buckets.get(subject);
    if (!existing) return { allowed: true, retryAfterSec: 0 };
    const elapsedSec = Math.max(0, (now - existing.refilledAt) / 1000);
    const tokens = Math.min(this.rule.burst, existing.tokens + elapsedSec * this.rule.refillPerSec);
    if (tokens >= 1) return { allowed: true, retryAfterSec: 0 };
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((1 - tokens) / this.rule.refillPerSec)),
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
 * The subject is `identity_hmac`, NOT the raw email and NOT the IP: the same
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
 * added, this becomes a per-process cap and the real ceiling doubles, at which
 * point the counter belongs in PostgreSQL, next to `otp_codes`.
 */
export const otpGlobal = new RateLimiter({ refillPerSec: 200 / 86_400, burst: 40 }, 1);

/**
 * Device-token mints, whole system.
 *
 * INVARIANT 7's 2/day + 5/week SOS cap is keyed on the attested device, but
 * the token minting itself was uncapped: token issuance costs one proof-of-work
 * solve, and at DEVICE_POW_DIFFICULTY=16 a native solver does that in ~0.09 s
 * (config.ts records the measurement), so ~950 fresh devices per hour, each
 * carrying its own untouched SOS budget. The PoW is a throttle, not a bound
 * (devices.ts says this in its SECURITY NOTES); this bucket is part of what
 * actually bounds it.
 *
 * 200/day sustained against a burst of 20: deliberately the same scale as
 * `otpGlobal`, because it answers the same question ("how many anonymous
 * credentials does a pilot-scale system legitimately need per day?"). Real
 * demand is a handful of strangers' phones; an attacker burning the whole
 * budget still faces the per-device SOS caps and has spent real hashing work
 * for every one of those mints. Like `otpGlobal`, this is per PROCESS: one
 * API process runs today; see that limiter's note before adding a second.
 *
 * Consumed ONLY after a solution verifies (see routes/devices.ts): garbage or
 * failed attempts must not drain a pool shared by every anonymous visitor, or
 * one noisy client could lock everyone out of attestation. What is capped is
 * successful mints, the thing an attacker actually wants.
 */
export const deviceTokenGlobal = new RateLimiter({ refillPerSec: 200 / 86_400, burst: 20 }, 1);

/** Fixed key for a limiter with a single global bucket. */
export const GLOBAL_SUBJECT = "global";

// ---------------------------------------------------------------------------
// Hardening batch 1 (2026-09-25): per-account / per-device write limiters.
//
// Every limiter below is keyed on an ACCOUNT (`acct:<feederId>`) or an
// attested DEVICE (`dev:<deviceId>`, the canonical subject from
// lib/device.ts deviceTokenSubject), never on an IP (INVARIANT 6). The one
// IP-keyed limiter in this file is `deviceMintPerIp`, and its comment says why
// it is the exception. Use `subjectKey()` so the prefixing is uniform.
// ---------------------------------------------------------------------------

/** The rate-limit key for an account or a device. */
export function subjectKey(feederId: string | null, deviceSubject: string | null): string {
  return feederId ? `acct:${feederId}` : `dev:${deviceSubject ?? ""}`;
}

/**
 * POST /api/v1/scans, per account or device: burst 30, then one a minute.
 * Checked after auth and BEFORE any photo is decoded. A real feeder doing a
 * morning round logs a dozen dogs; an offline queue flushing a day of feeds
 * fits in the burst; a script does not. 429 + retry-after, which apps/web's
 * offline queue retries rather than dropping.
 */
export const scanPerSubject = new RateLimiter({ refillPerSec: 1 / 60, burst: 30 });

/**
 * Photos accepted on scans, per account or device: 40 a day. Over budget the
 * scan is still recorded and answered 200 with `photoAccepted: false`: losing
 * a photo is cheap, losing the feed (the offline queue drops a permanent 4xx)
 * is not.
 */
export const photoPerSubject = new RateLimiter({ refillPerSec: 40 / 86_400, burst: 40 });

/**
 * POST /api/v1/reports, per account or device: burst 6, then one per ten
 * minutes. Deliberately above INVARIANT 7's 2/day + 5/week CASE cap, which it
 * does not replace: that cap counts cases opened, this bounds the request
 * rate (replays, photo re-uploads, dedupe lookups) before any decode or query.
 * A 429 here still carries `data.nearbyCare` when the dog has a position.
 */
export const reportPerSubject = new RateLimiter({ refillPerSec: 1 / 600, burst: 6 });

/** POST /api/v1/dogs/:slug/stories, per account: 5 a day. */
export const storyPerAccount = new RateLimiter({ refillPerSec: 5 / 86_400, burst: 5 });

/**
 * POST /api/v1/sos/cases/:id/ack, per account: burst 5, then 10 a day. A
 * responder acks a handful of cases in a bad week; probing case ids is not
 * that.
 */
export const sosAckPerAccount = new RateLimiter({ refillPerSec: 10 / 86_400, burst: 5 });

/**
 * Device-token mints, per client IP: burst 10, then 10 an hour.
 *
 * THE ONE IP-KEYED LIMIT IN THIS API, and a documented exception to
 * INVARIANT 6 (docs/INVARIANTS.md #6). There is no account or device to key
 * on here: minting the device token is the step that creates the device
 * subject every other limit uses. Without this, the single global bucket
 * (`deviceTokenGlobal`, 200/day) could be drained by one client in about
 * twenty seconds of solving, and anonymous SOS would then be unavailable to
 * every stranger in Mumbai for the rest of the day (audit A-07).
 *
 * Why it does not lock out a carrier's CGNAT pool the way INVARIANT 6 fears:
 * it only gates MINTING, which a real phone does once and then keeps the token;
 * the budget is generous for a shared address (10 at once, 10 more an hour);
 * and nothing else (reports, scans, sign-in) is keyed on the address. IPv6
 * clients are keyed on their /64, because one subscriber is routinely handed
 * a whole /64 and would otherwise have 2^64 fresh buckets.
 *
 * Relies on TRUST_PROXY=1 (the deploy workflow sets it): request.ip is then
 * the address cloudflared and Caddy forwarded, not the loopback proxy. With
 * TRUST_PROXY unset every request shares one bucket, which fails closed at
 * 10 an hour for everyone; that is why the deploy pins it.
 *
 * Consumed after the PoW verifies and the challenge is spent, and before the
 * global bucket, so a flood from one address is refused without touching the
 * pool everyone shares.
 */
export const deviceMintPerIp = new RateLimiter({ refillPerSec: 10 / 3600, burst: 10 });

// ---------------------------------------------------------------------------
// Design v5 (2026-09-25). Same rules as hardening batch 1: account or device
// first. The anonymous READS below (lookup, ward dogs) are called by pages
// that hold no credential at all (apps/web sends them with auth: false), so
// when no valid device token accompanies the request they fall back to the
// client address, IPv4 as is and IPv6 by its /64 (ipBucketKey). Those are the
// second and third IP-keyed limits in this API, recorded in docs/INVARIANTS.md
// #6 as that entry requires. Each is paired with a single global bucket, which
// is what actually bounds enumeration of the register through these reads.
// ---------------------------------------------------------------------------

/**
 * GET /api/v1/dogs/lookup, per device (or per IP without one): burst 10, then
 * one a minute. A stranger retyping a scratched code tries a handful; walking
 * the register four known characters at a time is not that.
 */
export const lookupPerSubject = new RateLimiter({ refillPerSec: 1 / 60, burst: 10 });

/** GET /api/v1/dogs/lookup, whole system: 3000 a day, burst 200. */
export const lookupGlobal = new RateLimiter({ refillPerSec: 3000 / 86_400, burst: 200 }, 1);

/** GET /api/v1/wards/:wardId/dogs, per device or IP: burst 10, then one a minute. */
export const wardDogsPerSubject = new RateLimiter({ refillPerSec: 1 / 60, burst: 10 });

/** GET /api/v1/wards/:wardId/dogs, whole system: 3000 a day, burst 200. */
export const wardDogsGlobal = new RateLimiter({ refillPerSec: 3000 / 86_400, burst: 200 }, 1);

/**
 * POST /api/v1/dogs/:slug/tag-reports, per account or device: burst 5, then 10
 * a day. The 24 h dedupe per (reporter, dog, kind) is separate and silent.
 */
export const tagReportPerSubject = new RateLimiter({ refillPerSec: 10 / 86_400, burst: 5 });

/**
 * Tag reports, per client IP: burst 10, then 20 an hour. On top of the device
 * limit, because device tokens are minted (10 an hour per address,
 * deviceMintPerIp) and each fresh one would otherwise carry a fresh budget.
 */
export const tagReportPerIp = new RateLimiter({ refillPerSec: 20 / 3600, burst: 10 });

/**
 * Tag reports, per DOG: burst 10, then 10 a day, whoever files them. However
 * many devices one person mints, one dog's feeders are not paged without
 * bound. Keyed `dog:<id>`.
 */
export const tagReportPerDog = new RateLimiter({ refillPerSec: 10 / 86_400, burst: 10 });

/**
 * Signed-in v5 writes (confirm, checkups, status reports, resolve, prints,
 * collars, decline), per account: burst 20, then one a minute.
 */
export const feederWritePerAccount = new RateLimiter({ refillPerSec: 1 / 60, burst: 20 });

/** GET /api/v1/feeders/me/export, per account: burst 3, then 5 a day. */
export const exportPerAccount = new RateLimiter({ refillPerSec: 5 / 86_400, burst: 3 });

/**
 * The key `deviceMintPerIp` uses: the IPv4 address as is, or the first four
 * hextets (the /64) of an IPv6 one. IPv4-mapped IPv6 (`::ffff:1.2.3.4`) is
 * treated as the IPv4 address it carries.
 */
export function ipBucketKey(ip: string | undefined | null): string {
  const raw = (ip ?? "").trim();
  if (!raw) return "ip:unknown";
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(raw);
  if (mapped) return `ip4:${mapped[1]}`;
  const kind = isIP(raw);
  if (kind === 4) return `ip4:${raw}`;
  if (kind !== 6) return `ip:${raw}`;
  return `ip6:${expandIpv6(raw).slice(0, 4).join(":")}`;
}

/** Eight lower-case hextets for a valid IPv6 address (zone id dropped). */
function expandIpv6(addr: string): string[] {
  const noZone = addr.split("%")[0].toLowerCase();
  // A trailing embedded IPv4 counts as two hextets.
  let text = noZone;
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    text = text.slice(0, v4.index) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const fill = tail !== undefined ? 8 - headParts.length - tailParts.length : 0;
  const parts = [...headParts, ...Array(Math.max(0, fill)).fill("0"), ...tailParts];
  return parts.map((h) => (h === "" ? "0" : h).replace(/^0+(?=.)/, ""));
}

/** What a 429 is keyed on, for the log line. Never the subject itself. */
export type SubjectKind = "account" | "device" | "identity" | "ip" | "global";

interface WarnLogger {
  warn(obj: object, msg?: string): void;
}

/**
 * The one log line every 429 writes: `{ event: "rate_limited", limiter,
 * subjectKind }`. Deliberately without the subject (an account id, a device
 * id, an identity HMAC or an address would turn the log into a tracking
 * record) so an operator can count and alert on refusals per limiter without
 * the log holding anything about who was refused.
 */
export function logRateLimited(log: WarnLogger, limiter: string, subjectKind: SubjectKind): void {
  log.warn({ event: "rate_limited", limiter, subjectKind }, "rate limited");
}

interface ReplyLike {
  status(code: number): ReplyLike;
  header(name: string, value: string): ReplyLike;
  send(payload: unknown): unknown;
}

/**
 * Consume one token from each (limiter, key) pair, in order, stopping at the
 * first refusal. On refusal: the standard log line, 429 RATE_LIMITED with
 * retry-after, and false. The design v5 routes gate on several limiters at
 * once (subject, IP, dog, global); peeking every one first means a request
 * turned away by the third does not spend the first two.
 */
export function enforceLimits(
  log: WarnLogger,
  reply: ReplyLike,
  checks: ReadonlyArray<{ limiter: RateLimiter; key: string; name: string; kind: SubjectKind }>,
  message = "too many requests; try again shortly",
): boolean {
  for (const c of checks) {
    const d = c.limiter.peek(c.key);
    if (!d.allowed) {
      logRateLimited(log, c.name, c.kind);
      reply
        .status(429)
        .header("retry-after", String(d.retryAfterSec))
        .send({ ok: false, error: { message, code: "RATE_LIMITED" } });
      return false;
    }
  }
  for (const c of checks) c.limiter.consume(c.key);
  return true;
}

/**
 * Dogless SOS (design v6, P8): a report naming no dog, located to the
 * reporter's ward, pages that ward's feeders. Per account or device: burst 2,
 * then 3 a day. Per client IP (docs/INVARIANTS.md #6): burst 3, then 6 a day.
 * Both on top of reportPerSubject and INVARIANT 7's case caps, which still
 * apply unchanged, and the one-open-case-per-ward dedupe in routes/sos.ts.
 */
export const doglessReportPerSubject = new RateLimiter({ refillPerSec: 3 / 86_400, burst: 2 });
export const doglessReportPerIp = new RateLimiter({ refillPerSec: 6 / 86_400, burst: 3 });

/**
 * "Tell her other feeders" on an unwell feed (design v6, L2), per DOG: burst
 * 2, then 4 a day, however many feeders file it. Keyed `dog:<id>`.
 */
export const unwellPushPerDog = new RateLimiter({ refillPerSec: 4 / 86_400, burst: 2 });
