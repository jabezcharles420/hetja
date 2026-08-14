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
 * SINGLE-USE (enhancement stack D.4): the hand-rolled design this replaces
 * embedded expiry in the challenge but had NO server-side store of spent
 * challenges, so a solved (challenge, nonce) pair stayed valid for whoever
 * held it until expiry -- replayable to mint more than one token. That is
 * closed here by `spentChallenges`, an in-process LRU keyed on the challenge
 * signature (unique per issuance because every challenge draws a fresh
 * random nonce+salt): the registry is consulted and updated synchronously
 * (no `await` between the has/check and the set, so the check-then-set is
 * atomic within this process) immediately after a solution verifies, and a
 * challenge already present is rejected with CHALLENGE_REUSED. Entries live
 * in the cache for CHALLENGE_TTL_MS plus slack, so a spent challenge cannot
 * be replayed even in the last moments before it expires.
 *
 * The registry is process-local. That is the right trade-off here: the API
 * runs as a single service (one systemd unit, one process), the entries live
 * only as long as the challenge is valid (~2 minutes), and there is no Redis
 * in the stack. A multi-replica deployment would need a shared store; the
 * enhancement stack doc's durable fix ("a server-side spent set, TTL'd past
 * challenge expiry") is exactly what this is, scoped to the running process.
 *
 * SECURITY NOTES (read before touching DEVICE_POW_DIFFICULTY, config.ts):
 *
 * - Difficulty is weak today, by design of the existing default, not this
 *   change. DEVICE_POW_DIFFICULTY defaults to 14 bits -- ~2^14 = 16,384
 *   SHA-256 attempts, a few *milliseconds* on any real CPU. For a token
 *   whose entire job is being the rate-limit subject for INVARIANT 7 (anon
 *   SOS capped 2/day, 5/week per token), that is barely a speed bump.
 *   As of 2026-08-13 (enhancement stack Phase 0 #6) the shipped default IS
 *   18 bits and the production .env.production carries DEVICE_POW_DIFFICULTY=18.
 *   ALTCHA's hex-prefix encoding rounds this UP to 20 effective bits, still
 *   inside the 18-20 range the doc recommends and under the 20-bit ceiling
 *   for the desktop solver. Do not raise past 20 without revisiting the
 *   solver budget and the mobile attestation path.
 *
 * - Nothing in this file logs the challenge, nonce, counter, or minted token.
 */
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { LRUCache } from "lru-cache";
import { createPoWChallenge, effectivePowDifficulty, issueDeviceToken, verifyPoW } from "../lib/device.js";

// Short-lived on purpose -- see the replay note above. Long enough for a
// desktop-web PoW solve at any difficulty this route is actually configured
// with, short enough to keep the reuse window small.
const CHALLENGE_TTL_MS = 120_000;

// Entries survive a little longer than the challenge itself so a challenge
// spent near the end of its life stays rejected until it expires.
const SPENT_TTL_MS = CHALLENGE_TTL_MS + 30_000;

// 100k spent signatures at SPENT_TTL_MS ≈ 1,500s of budget ≈ ~66 mints/sec
// sustained before the LRU evicts oldest -- well past any legitimate burst,
// and past that the only effect is a very old challenge becoming reusable,
// which the 120s expiry independently forbids.
const spentChallenges = new LRUCache<string, true>({ max: 100_000, ttl: SPENT_TTL_MS });

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

    // Single-use: the signature is unique per issuance (fresh nonce+salt every
    // challenge), so it is the registry key. The has/check and set run with no
    // await between them -- atomic within this process -- so two concurrent
    // replays of the same challenge cannot both pass.
    const spentKey = challenge.signature;
    if (spentChallenges.has(spentKey)) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "challenge already used", code: "CHALLENGE_REUSED" } });
    }
    spentChallenges.set(spentKey, true);

    const deviceToken = issueDeviceToken(app.config.HETJA_DEVICE_SECRET);
    return { ok: true, data: { deviceToken } };
  });
}
