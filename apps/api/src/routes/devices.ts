/**
 * Hetja anonymous device-token issuance — the missing "issue" half of
 * INVARIANT 6. lib/device.ts already implements issueDeviceToken/
 * verifyDeviceToken, but nothing outside a test file ever called
 * issueDeviceToken() -- every consumer (auth/verify, scans.ts, sos.ts) only
 * *verified* a device token, and no HTTP route ever minted one. This route
 * is that missing half, desktop-web fallback only; native shells are meant
 * to attest via Play Integrity / App Attest instead (build guide Step 2,
 * Phase 1 -- out of scope here).
 *
 * POST /api/v1/devices/challenge -> { challenge, difficulty }
 *   `challenge` is an ALTCHA v2 challenge object issued by altcha-lib:
 *     { parameters: { algorithm, nonce, salt, cost, keyLength, keyPrefix,
 *                      expiresAt }, signature }
 *   `signature` is HMAC-SHA256(HETJA_DEVICE_SECRET, canonicalJSON(parameters)),
 *   so the challenge is self-authenticating: any edit to the parameters is
 *   caught at verify time, no server-side store is needed to authenticate it.
 *   `difficulty` is the effective leading-zero-bit difficulty (the configured
 *   DEVICE_POW_DIFFICULTY rounded up to a nibble boundary -- ALTCHA encodes
 *   difficulty as a hex key prefix). The client solves for `keyPrefix`.
 *
 * POST /api/v1/devices/token  body: { challenge, solution } -> { deviceToken }
 *   `solution` = { counter, derivedKey } (the ALTCHA v2 solution). Also
 *   accepts the widget form { payload } where payload is base64 of
 *   JSON({ challenge, solution }) -- the exact shape the ALTCHA widget
 *   submits -- so a future widget integration needs no server change.
 *   Verified strictly in this order: (1) expiry, (2) the challenge HMAC --
 *   proves we minted it and it has not been edited; (3) re-derive the key
 *   from the submitted counter and compare to the prefix -- proves the client
 *   burned CPU for it; (4) single-use -- the challenge signature must not
 *   already be in the spent-challenge registry. Only then does
 *   issueDeviceToken() run.
 *
 * SINGLE-USE (enhancement stack D.4): durable via `spent_challenges`
 * (migration 0021). The old design had NO server-side store and the previous
 * file revision used a per-process LRU (`spentChallenges` via `lru-cache`)
 * keyed on the challenge signature (unique per issuance because every
 * challenge draws a fresh nonce+salt). That LRU was "single-use per process
 * lifetime": a restart, deploy or OOM-kill inside the 120s challenge TTL
 * emptied it and a held (challenge, solution) pair minted a second token.
 * AGENTS.md §g records `next build` OOM-killing live services on this box,
 * so the window was not theoretical.
 *
 * Durable now: `spent_challenges(challenge_hash TEXT PRIMARY KEY, spent_at,
 * expires_at)` — one row per spent challenge signature, `expires_at = now()
 * + 150s` (CHALLENGE_TTL 120s + 30s slack so a challenge spent near expiry
 * stays rejected until it expires). The check is one atomic
 * `INSERT ... ON CONFLICT (challenge_hash) DO NOTHING RETURNING` — the PK
 * makes check-then-set atomic across processes AND restarts with no advisory
 * lock. A stale sweep `DELETE WHERE expires_at < now()` keeps the table
 * small (also done by the worker retention job). Cost is one extra write per
 * mint, on a path that already costs the client a PoW solve.
 *
 * What a duplicate mint buys is still bounded by INVARIANT 7's 2/day + 5/week
 * cap keyed on canonical deviceId (lib/device.ts deviceTokenSubject,
 * routes/sos.ts), but now the duplicate cannot happen at all.
 *
 * SECURITY NOTES (read before touching DEVICE_POW_DIFFICULTY, config.ts):
 *
 * - Difficulty is a bot speed bump, NOT the anti-abuse mechanism, and it is
 *   important not to confuse the two. History: the default was 14 bits, was
 *   raised to 18 on 2026-08-13 (enhancement stack Phase 0 #6), and is 16 as
 *   of 2026-08-14. ALTCHA's hex-prefix encoding rounds the configured number
 *   UP to a nibble boundary, so 18 was really 20 effective bits -- ~2^20
 *   crypto.subtle digests, which the apps/scan browser solver could not finish
 *   inside its own 20s budget, so anonymous attestation silently degraded to
 *   "couldn't confirm the report automatically" on the life-safety path. 16
 *   rounds to 16 exactly, which the solver clears with real headroom on a slow
 *   phone. The reasoning and the measurements live on the field in config.ts;
 *   read that before changing this. `.max(20)` there is a hard ceiling now:
 *   the difficulty becomes a `"0".repeat(bits/4)` hex prefix, so an unbounded
 *   typo (`180`) made every mint unsolvable with no boot error at all.
 *
 * - What actually bounds abuse is INVARIANT 7's 2/day + 5/week cap, and that
 *   cap only holds because lib/device.ts's `deviceTokenSubject` rejects
 *   non-canonical base64url and routes/sos.ts keys the cap on the canonical
 *   deviceId rather than on the submitted token string. Before that fix, ONE
 *   solve at any difficulty -- 14, 18 or 20 bits -- bought unlimited SOS
 *   budget, because `tok`, `tok=`, `tok==` and `tok!` all verified as valid
 *   tokens while counting as four different devices. Difficulty was never
 *   what was holding the line: on this box a native SHA-256 loop runs ~696k
 *   h/s, i.e. ~1.5s per token at 20 bits and ~0.09s at 16.
 *
 * - Nothing in this file logs the challenge, nonce, counter, or minted token.
 */
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { query } from "@hetja/db";
import { createPoWChallenge, effectivePowDifficulty, issueDeviceToken, verifyPoW } from "../lib/device.js";
import { deviceTokenGlobal, GLOBAL_SUBJECT } from "../lib/rate-limit.js";

// Short-lived on purpose -- long enough for a desktop-web PoW solve at any
// difficulty this route is actually configured with, short enough to keep the
// reuse window small.
const CHALLENGE_TTL_MS = 120_000;

// Entries survive a little longer than the challenge itself so a challenge
// spent near the end of its life stays rejected until it expires.
const SPENT_TTL_MS = CHALLENGE_TTL_MS + 30_000;

const ChallengeParametersSchema = z.object({
  algorithm: z.string().min(1),
  nonce: z.string().min(1),
  salt: z.string().min(1),
  cost: z.number().int().positive(),
  keyLength: z.number().int().positive(),
  keyPrefix: z.string().min(1),
  expiresAt: z.number().optional(),
  keySignature: z.string().optional(),
  memoryCost: z.number().optional(),
  parallelism: z.number().optional(),
  data: z.record(z.string(), z.string().or(z.number()).or(z.boolean()).nullable()).optional(),
});

const ChallengeSchema = z.object({
  parameters: ChallengeParametersSchema,
  signature: z.string().min(1),
});

const SolutionSchema = z.object({
  counter: z.number().int().nonnegative(),
  derivedKey: z.string().min(1),
});

// Accepts the ALTCHA-native JSON form ({ challenge, solution }) and the
// widget form ({ payload }: base64 of JSON({ challenge, solution })).
const DeviceTokenInput = z.object({
  challenge: ChallengeSchema.optional(),
  solution: SolutionSchema.optional(),
  payload: z.string().min(1).max(8192).optional(),
});

type ParsedChallenge = z.infer<typeof ChallengeSchema>;
type ParsedSolution = z.infer<typeof SolutionSchema>;

const DecodedPayloadSchema = z.object({ challenge: ChallengeSchema, solution: SolutionSchema });
type DecodedPayload = z.infer<typeof DecodedPayloadSchema>;

function decodePayload(payload: string): DecodedPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  } catch {
    return null;
  }
  const check = DecodedPayloadSchema.safeParse(parsed);
  if (!check.success) return null;
  return check.data;
}

export default async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/devices/challenge", async (_req: FastifyRequest, _reply: FastifyReply) => {
    const challenge = await createPoWChallenge(
      app.config.HETJA_DEVICE_SECRET,
      app.config.DEVICE_POW_DIFFICULTY,
      CHALLENGE_TTL_MS,
    );
    return {
      ok: true,
      data: { challenge, difficulty: effectivePowDifficulty(app.config.DEVICE_POW_DIFFICULTY) },
    };
  });

  app.post("/api/v1/devices/token", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = DeviceTokenInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid device token request", code: "INVALID_DEVICE_TOKEN_REQUEST" } });
    }

    let challenge: ParsedChallenge;
    let solution: ParsedSolution;
    if (parsed.data.payload) {
      const decoded = decodePayload(parsed.data.payload);
      if (!decoded) {
        return reply
          .status(400)
          .send({ ok: false, error: { message: "invalid device token request", code: "INVALID_DEVICE_TOKEN_REQUEST" } });
      }
      challenge = decoded.challenge;
      solution = decoded.solution;
    } else if (parsed.data.challenge && parsed.data.solution) {
      challenge = parsed.data.challenge;
      solution = parsed.data.solution;
    } else {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid device token request", code: "INVALID_DEVICE_TOKEN_REQUEST" } });
    }

    const verified = await verifyPoW(challenge, solution, app.config.HETJA_DEVICE_SECRET);
    if (verified.expired) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "challenge expired", code: "CHALLENGE_EXPIRED" } });
    }
    if (verified.badSignature) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "challenge not recognized", code: "BAD_CHALLENGE" } });
    }
    if (!verified.verified || verified.badSolution) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "proof of work invalid", code: "BAD_POW" } });
    }

    // Single-use durable: the signature is unique per issuance (fresh
    // nonce+salt every challenge), so it is the PK of spent_challenges
    // (migration 0021). The PK makes check-then-set atomic across processes
    // AND restarts via one `INSERT ... ON CONFLICT DO NOTHING RETURNING` —
    // no advisory lock, no race window, unlike the old in-process LRU.
    const spentKey = challenge.signature;
    const expiresAt = new Date(Date.now() + SPENT_TTL_MS).toISOString();
    // Best-effort sweep of already-expired entries so the table does not grow
    // without bound between worker retention runs. Failure is non-fatal:
    // correctness is the PK insert below, not the sweep.
    try {
      await query(`DELETE FROM spent_challenges WHERE expires_at < now()`);
    } catch {}
    const spentInsert = await query(
      `INSERT INTO spent_challenges (challenge_hash, spent_at, expires_at)
        VALUES ($1, now(), $2)
        ON CONFLICT (challenge_hash) DO NOTHING
        RETURNING challenge_hash`,
      [spentKey, expiresAt],
    );
    if ((spentInsert.rowCount ?? 0) === 0) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "challenge already used", code: "CHALLENGE_REUSED" } });
    }

    // INVARIANT 7 backstop: a global cap on SUCCESSFUL mints. Checked after
    // verification and after the durable single-use insert on purpose, twice
    // over: a failed or replayed attempt has already been rejected above and
    // must not drain a bucket shared by every anonymous visitor, and rejecting
    // here -- before `issueDeviceToken` -- means a capped mint never comes into
    // existence at all. A solved challenge that lands on a full bucket is
    // burned (the durable row above already marked it spent), which is
    // acceptable: the client re-requests a challenge and solves again, and a
    // full bucket is by construction an abnormal condition an operator needs to
    // know about. See lib/rate-limit.ts for why the PoW alone cannot be the
    // bound.
    const mintBudget = deviceTokenGlobal.consume(GLOBAL_SUBJECT);
    if (!mintBudget.allowed) {
      req.log.warn(
        { retryAfterSec: mintBudget.retryAfterSec },
        "device token global mint budget exhausted — refusing further mints",
      );
      return reply
        .status(429)
        .header("retry-after", String(mintBudget.retryAfterSec))
        .send({
          ok: false,
          error: {
            message: "device attestation is temporarily unavailable. Try again shortly.",
            code: "DEVICE_TOKEN_RATE_LIMITED",
          },
        });
    }

    const deviceToken = issueDeviceToken(app.config.HETJA_DEVICE_SECRET);
    return { ok: true, data: { deviceToken } };
  });
}
