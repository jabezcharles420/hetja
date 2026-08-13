/**
 * Hetja anonymous device-token issuance — the missing "issue" half of
 * INVARIANT 6. lib/device.ts already implements issueDeviceToken/
 * verifyDeviceToken/createPoWChallenge/verifyPoW, but nothing outside a
 * test file ever called issueDeviceToken() -- every consumer (auth/verify,
 * scans.ts, sos.ts) only *verified* a device token, and no HTTP route ever
 * minted one. The practical effect: a stranger could not file an anonymous
 * SOS report, could not submit an anonymous feed scan, and could not even
 * complete signup (auth/verify requires a device token) -- every one of
 * those paths 401'd with BAD_DEVICE_TOKEN / UNAUTHENTICATED_DEVICE. This
 * route is that missing half, desktop-web fallback only; native shells are
 * meant to attest via Play Integrity / App Attest instead (build guide
 * Step 2, Phase 1 -- out of scope here).
 *
 * POST /api/v1/devices/challenge -> { challenge, difficulty }
 *   Stateless, self-authenticating challenge, so no server-side store is
 *   needed to verify it later:
 *     challenge = "<powSeed>.<expiresAtMs>.<HMAC(HETJA_DEVICE_SECRET, powSeed|expiresAtMs)>"
 *   `powSeed` is device.ts's createPoWChallenge() (random bytes). The PoW
 *   itself is solved against the *entire* challenge string (not just
 *   powSeed) so a client can treat it as one opaque token -- no parsing
 *   required -- and so the proof-of-work is bound to the authenticated
 *   expiry too, not just the random seed.
 *
 * POST /api/v1/devices/token  body: { challenge, nonce } -> { deviceToken }
 *   Verified strictly in this order: (1) the challenge's HMAC -- proves we
 *   minted it and it has not been edited; (2) expiry -- proves it is not
 *   stale; (3) verifyPoW(challenge, nonce, difficulty) -- proves the client
 *   burned CPU for it. Only once all three pass does issueDeviceToken() run.
 *
 * SECURITY NOTES (read before touching DEVICE_POW_DIFFICULTY, config.ts):
 *
 * - Difficulty is weak today, by design of the existing default, not this
 *   change. DEVICE_POW_DIFFICULTY defaults to 14 bits -- ~2^14 = 16,384
 *   SHA-256 attempts, a few *milliseconds* on any real CPU. For a token
 *   whose entire job is being the rate-limit subject for INVARIANT 7 (anon
 *   SOS capped 2/day, 5/week per token), that is barely a speed bump: a
 *   script can mint thousands of fresh tokens per second to fan out under
 *   the cap. This route intentionally does NOT change the shipped default
 *   -- that is a product/ops call, not something to flip unilaterally in a
 *   bugfix. Recommendation for production: 18-20 bits (roughly 0.3-1s on a
 *   mid-range phone/laptop) -- still a one-time, once-per-device cost,
 *   invisible to a real user filing a report, but 16-64x more expensive to
 *   a scripted minter than the current default.
 *
 * - As of 2026-08-13 (enhancement stack Phase 0 #6) the shipped default IS
 *   18 bits and the production .env.production carries DEVICE_POW_DIFFICULTY=18.
 *   The desktop-web fallback solver (solvePoW, maxIterations 20_000_000)
 *   handles 18 bits in well under a second; 20 bits is the ceiling before
 *   low-end devices start to notice. Do not raise past 20 without revisiting
 *   the solver budget and the mobile attestation path.
 *
 * - Replay is bounded, not solved, by this stateless design. There is
 *   deliberately no server-side store of spent challenges/nonces here, so
 *   a solved (challenge, nonce) pair stays valid for whoever holds it until
 *   the embedded expiry (~120s) passes -- within that window it could in
 *   principle be resubmitted to mint more than one device token, which
 *   weakens (does not defeat) the per-token caps this token exists to
 *   enforce. The short TTL bounds the blast radius; it does not close it.
 *   A durable fix needs a server-side "spent" set (e.g. a Redis SETNX on
 *   the nonce, TTL'd past challenge expiry), which is out of scope for a
 *   deliberately stateless endpoint. The actual fix per the build guide is
 *   attested tokens via Play Integrity / App Attest in the native shell
 *   (Phase 1) -- proof-of-work was always understood to be the weaker
 *   desktop-web fallback, not a final answer.
 *
 * - Nothing in this file logs the challenge, nonce, or minted token.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createPoWChallenge, issueDeviceToken, verifyPoW } from "../lib/device.js";

// Short-lived on purpose -- see the replay note above. Long enough for a
// desktop-web PoW solve at any difficulty this route is actually configured
// with, short enough to keep the replay window small.
const CHALLENGE_TTL_MS = 120_000;

function signChallengeParts(powSeed: string, expiresAt: number, secret: string): string {
  return createHmac("sha256", secret).update(`${powSeed}|${expiresAt}`).digest("base64url");
}

function makeChallenge(secret: string): string {
  const powSeed = createPoWChallenge();
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  const sig = signChallengeParts(powSeed, expiresAt, secret);
  return `${powSeed}.${expiresAt}.${sig}`;
}

interface VerifiedChallenge {
  expiresAt: number;
}

/** Recomputes the HMAC over the challenge's own embedded fields -- true iff
 * we minted this exact string and no part of it was edited. */
function verifyChallengeHmac(challenge: string, secret: string): VerifiedChallenge | null {
  const parts = challenge.split(".");
  if (parts.length !== 3) return null;
  const [powSeed, expiresAtStr, sig] = parts;
  if (!powSeed || !expiresAtStr || !sig) return null;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt)) return null;

  const expected = signChallengeParts(powSeed, expiresAt, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { expiresAt };
}

const DeviceTokenInput = z.object({
  challenge: z.string().min(1).max(512),
  nonce: z.string().min(1).max(64),
});

export default async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/devices/challenge", async (_req: FastifyRequest, _reply: FastifyReply) => {
    const challenge = makeChallenge(app.config.HETJA_DEVICE_SECRET);
    return { ok: true, data: { challenge, difficulty: app.config.DEVICE_POW_DIFFICULTY } };
  });

  app.post("/api/v1/devices/token", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = DeviceTokenInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid device token request", code: "INVALID_DEVICE_TOKEN_REQUEST" } });
    }
    const { challenge, nonce } = parsed.data;

    const verified = verifyChallengeHmac(challenge, app.config.HETJA_DEVICE_SECRET);
    if (!verified) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "challenge not recognized", code: "BAD_CHALLENGE" } });
    }
    if (verified.expiresAt < Date.now()) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "challenge expired", code: "CHALLENGE_EXPIRED" } });
    }
    if (!verifyPoW(challenge, nonce, app.config.DEVICE_POW_DIFFICULTY)) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "proof of work invalid", code: "BAD_POW" } });
    }

    const deviceToken = issueDeviceToken(app.config.HETJA_DEVICE_SECRET);
    return { ok: true, data: { deviceToken } };
  });
}
