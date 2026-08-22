import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AuthOtpRequest,
  AuthOtpVerify,
  AuthRefresh,
  type FeederRole,
} from "@hetja/contracts";
import { query, withTx } from "@hetja/db";
import { signAccessToken, signRefreshToken, verifyRefreshToken, decodeJwtPayload } from "../lib/jwt.js";
import { verifyDeviceToken } from "../lib/device.js";
import {
  ADDRESS_NOT_ELIGIBLE_MESSAGE,
  resolveIdentityHmac,
} from "../lib/email.js";
import { issueOtp, verifyOtp } from "../lib/otp.js";
import { sendOtpEmail } from "../lib/mailer.js";
import { GLOBAL_SUBJECT, otpGlobal, otpPerIdentity } from "../lib/rate-limit.js";

interface FeederRow {
  id: string;
  display_name: string;
  role: string;
  trust_score: number;
  home_ward: string | null;
}

async function upsertFeeder(
  identityHmacVal: string,
  consentVersion: number,
  isMinor: boolean,
): Promise<FeederRow> {
  // `SET identity_hmac = EXCLUDED.identity_hmac` (a self-assignment) is what
  // makes the conflict branch a deliberate no-op rather than an error, and
  // what it protects is privilege: a returning user must never be able to
  // change their own role or trust_score by re-verifying an OTP — re-login is
  // authentication, not authorisation. Role changes happen only through the
  // admin grant path; trust_score is derived from trust_events by
  // recomputeScore and would be silently rewritten by the next replay if it
  // were written here.
  //
  // What deliberately does advance on conflict: `consent_version` and
  // `is_minor`. Freezing them made sense for nothing except brevity of the
  // clause — but a consent version that can never move means a feeder who
  // accepted DPDP notice v2 stays recorded as v1 forever, and a user who
  // turns 18 stays flagged a minor (with whatever gating that drags behind
  // it) for as long as the row lives. Both are facts ABOUT the account that
  // the user themselves attests at each verify, like display_name; they are
  // not privileges, so the no-op reasoning above does not apply to them.
  const res = await query<FeederRow>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
     VALUES ($1, 'Hetja Feeder', 'feeder', 30, $2, $3)
     ON CONFLICT (identity_hmac) DO UPDATE SET
       identity_hmac = EXCLUDED.identity_hmac,
       consent_version = EXCLUDED.consent_version,
       is_minor = EXCLUDED.is_minor
     RETURNING id, display_name, role, trust_score, home_ward`,
    [identityHmacVal, String(consentVersion), isMinor],
  );
  return res.rows[0];
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/auth/otp", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = AuthOtpRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "email must be a valid email address", code: "INVALID_EMAIL" } });
    }
    const { email } = parsed.data;

    // Which identity_hmac does this address belong under — an existing
    // account's hash (grandfathered, whatever domain it is) or the canonical
    // hash of a genuinely new signup? lib/email.ts owns the rule; /verify
    // MUST call it again with the same input or codes get issued against one
    // hash and verified against another. The signup-domain restriction is a
    // production policy (lib/email.ts header explains why); dev/test login
    // stays open to any address.
    const resolved = await resolveIdentityHmac(email, app.config.HETJA_HMAC_PEPPER, {
      enforceNewSignupDomain: app.config.NODE_ENV === "production",
    });
    if (!resolved.ok) {
      // Vague by policy (lib/email.ts header): no provider, domain or reason.
      return reply
        .status(400)
        .send({ ok: false, error: { message: ADDRESS_NOT_ELIGIBLE_MESSAGE, code: "ADDRESS_NOT_ELIGIBLE" } });
    }
    const idHmac = resolved.hmac;

    // Rate limit BEFORE issuing anything.
    //
    // Order matters twice over. `issueOtp` overwrites any pending code for this
    // identity, so limiting afterwards would still let an attacker invalidate a
    // real user's in-flight code at will — a denial of service that needs no
    // email to be sent at all. And the send is synchronous, so limiting
    // afterwards would not protect the SMTP quota either.
    //
    // Keyed on identity_hmac and on a global bucket, never on IP: INVARIANT 6
    // forbids per-IP limits because Indian carrier CGNAT puts hundreds of real
    // subscribers behind one address. See lib/rate-limit.ts.
    //
    // Keyed on the RESOLVED hmac rather than the raw typed string, for the same
    // reason login canonicalises at all: `j.o.h.n@`, `john+7@` and `john@` are
    // one mailbox, so they must be one rate-limit bucket too — otherwise
    // rotating dot placements buys a fresh send budget per request and the cap
    // protects nothing. Legacy accounts whose stored hash predates
    // canonicalisation split their bucket across renderings; that weakens one
    // grandfathered user's own throttle but cannot be helped without knowing
    // which renderings are theirs.
    //
    // Both limits are checked before either is consumed, so a request refused
    // by the global cap does not also burn the user's personal allowance.
    const perIdentity = otpPerIdentity.consume(idHmac);
    if (!perIdentity.allowed) {
      return reply
        .status(429)
        .header("retry-after", String(perIdentity.retryAfterSec))
        .send({
          ok: false,
          error: {
            message: "Too many codes requested for this address. Try again shortly.",
            code: "RATE_LIMITED",
          },
        });
    }
    const global = otpGlobal.consume(GLOBAL_SUBJECT);
    if (!global.allowed) {
      // Deliberately vague to the caller and loud in the log: this is either an
      // attack in progress or a genuine surge, and both need an operator to see
      // it. The daily mail quota is a hard vendor ceiling — running it to zero
      // means no user can log in until midnight.
      req.log.error(
        { retryAfterSec: global.retryAfterSec },
        "OTP global send budget exhausted — refusing further sends to protect the daily mail quota",
      );
      return reply
        .status(429)
        .header("retry-after", String(global.retryAfterSec))
        .send({
          ok: false,
          error: { message: "Sign-in is temporarily busy. Try again shortly.", code: "RATE_LIMITED" },
        });
    }

    const { code, expiresAt } = await issueOtp(idHmac, app.config.HETJA_HMAC_PEPPER);

    if (app.config.NODE_ENV === "production") {
      await sendOtpEmail(email, code, {
        host: app.config.BREVO_SMTP_HOST,
        port: app.config.BREVO_SMTP_PORT,
        user: app.config.BREVO_SMTP_USER,
        pass: app.config.BREVO_SMTP_PASS,
        from: app.config.MAIL_FROM,
      });
    }

    return {
      ok: true,
      data: {
        expiresAt: new Date(expiresAt).toISOString(),
        devCode: app.config.NODE_ENV === "production" ? undefined : code,
      },
    };
  });

  app.post("/api/v1/auth/verify", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = AuthOtpVerify.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid verify payload", code: "INVALID_VERIFY" } });
    }
    const { email, code, deviceToken, consentVersion, isMinor } = parsed.data;

    if (!verifyDeviceToken(deviceToken, app.config.HETJA_DEVICE_SECRET)) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "attested device token required", code: "BAD_DEVICE_TOKEN" } });
    }

    const idHmacRes = await resolveIdentityHmac(email, app.config.HETJA_HMAC_PEPPER, {
      enforceNewSignupDomain: app.config.NODE_ENV === "production",
    });
    if (!idHmacRes.ok) {
      // Unreachable through the normal flow (an ineligible address can never
      // have been issued a code), but keeping both routes on the same resolver
      // is what guarantees an issued code and its verification land on the
      // same identity_hmac. Refusing the same way also keeps /verify from
      // becoming the looser of the two gates.
      return reply
        .status(400)
        .send({ ok: false, error: { message: ADDRESS_NOT_ELIGIBLE_MESSAGE, code: "ADDRESS_NOT_ELIGIBLE" } });
    }
    const idHmac = idHmacRes.hmac;

    const result = await verifyOtp(idHmac, code, app.config.HETJA_HMAC_PEPPER);
    if (result !== "ok") {
      const status = result === "too_many_attempts" ? 429 : 400;
      return reply.status(status).send({ ok: false, error: { message: result, code: result.toUpperCase() } });
    }

    const feeder = await upsertFeeder(idHmac, consentVersion, isMinor);

    const accessToken = signAccessToken(feeder.id, app.config.JWT_SECRET, app.config.JWT_ACCESS_TTL);
    const refreshToken = signRefreshToken(feeder.id, app.config.JWT_SECRET, app.config.JWT_REFRESH_TTL);

    // RECORD THE MINTED REFRESH TOKEN. Before migration 0017 nothing stored
    // issuance, so rotation could not be one-time-use: every token ever
    // minted was replayable for 30 days with no way to detect or revoke it.
    // The row is what makes POST /auth/refresh's reuse detection possible —
    // without it, the first refresh would find no row, look exactly like a
    // replay, and lock the feeder out.
    //
    // Not in the same transaction as upsertFeeder deliberately: a crash here
    // leaves an account whose refresh attempt later fails honestly (no row →
    // REFRESH_REUSED), which is recoverable by signing in again — whereas a
    // failed login that had already consumed the OTP would not be. The jti
    // comes from decoding the just-signed token; lib/jwt.ts documents why
    // decodeJwtPayload must never meet an externally-supplied token.
    const refreshPayload = decodeJwtPayload(refreshToken);
    await query(
      `INSERT INTO refresh_tokens (jti, feeder_id, expires_at)
       VALUES ($1, $2, $3)`,
      [refreshPayload.jti, feeder.id, new Date(refreshPayload.exp * 1000).toISOString()],
    );

    return {
      ok: true,
      data: {
        accessToken,
        refreshToken,
        feeder: {
          displayName: feeder.display_name,
          trustScore: feeder.trust_score,
          role: feeder.role as FeederRole,
          homeWard: feeder.home_ward ?? undefined,
        },
      },
    };
  });

  /**
   * Exchange a refresh token for a fresh pair. NO auth header — the token IS
   * the credential, so this route's security rests entirely on the signature
   * check and the one-time-use store.
   *
   * THE EXCHANGE IS ONE CONDITIONAL UPDATE, and that is the whole security
   * model:
   *
   *     UPDATE refresh_tokens SET used_at = now(), replaced_by = $new
   *      WHERE jti = $1 AND used_at IS NULL AND revoked_at IS NULL
   *      RETURNING feeder_id
   *
   * The WHERE clause makes the row claim itself atomically: two concurrent
   * presentations of the same token serialise on the row lock and exactly one
   * wins; the loser sees zero rows. Zero rows means the token was already
   * spent, revoked, or never recorded — all three are treated as THEFT,
   * because a legitimate holder presents each token exactly once (the web
   * client stores the replacement the moment it receives it). The response to
   * theft is fail-closed family-wide revocation: every live row for the
   * feeder is revoked and 401 REFRESH_REUSED returned. Yes, this can log out
   * a legitimate concurrent session (two devices sharing one token chain);
   * the alternative is leaving an attacker's copy of a 30-day bearer token
   * working after it has been observed in replay. Honest logout of one device
   * needs per-device chains, which this table is shaped for but no route uses
   * yet.
   *
   * Error codes, each meaning something different:
   *   400 INVALID_REFRESH    body malformed (no/garbage refreshToken field)
   *   401 BAD_REFRESH_TOKEN  signature/expiry/type failure — nobody was ever
   *                          holding a live credential shaped like this
   *   401 REFRESH_REUSED     replay detected → family revoked (see above)
   *   401 FEEDER_GONE        row claimed but the feeders row vanished between
   *                          UPDATE and SELECT — unreachable while the ON
   *                          DELETE CASCADE holds (deletion removes both),
   *                          kept because the cascade is a schema promise,
   *                          not something this code path can verify
   */
  app.post("/api/v1/auth/refresh", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = AuthRefresh.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid refresh payload", code: "INVALID_REFRESH" } });
    }

    let presented;
    try {
      presented = verifyRefreshToken(parsed.data.refreshToken, app.config.JWT_SECRET);
    } catch {
      return reply.status(401).send({
        ok: false,
        error: { message: "invalid or expired refresh token", code: "BAD_REFRESH_TOKEN" },
      });
    }
    const sub = presented.sub as string;

    // Mint BEFORE claiming: replaced_by needs the new jti, and if the claim
    // loses (replay) the transaction rolls back having inserted nothing — the
    // new pair simply never becomes usable.
    const accessToken = signAccessToken(sub, app.config.JWT_SECRET, app.config.JWT_ACCESS_TTL);
    const refreshToken = signRefreshToken(sub, app.config.JWT_SECRET, app.config.JWT_REFRESH_TTL);
    const freshPayload = decodeJwtPayload(refreshToken);

    const claimedFeederId = await withTx(async (client) => {
      const claimed = await client.query<{ feeder_id: string }>(
        `UPDATE refresh_tokens SET used_at = now(), replaced_by = $2
          WHERE jti = $1 AND used_at IS NULL AND revoked_at IS NULL
          RETURNING feeder_id`,
        [presented.jti, freshPayload.jti],
      );
      if (claimed.rows.length === 0) return null;
      await client.query(
        `INSERT INTO refresh_tokens (jti, feeder_id, expires_at)
         VALUES ($1, $2, $3)`,
        [freshPayload.jti, claimed.rows[0].feeder_id, new Date(freshPayload.exp * 1000).toISOString()],
      );
      return claimed.rows[0].feeder_id;
    });

    if (claimedFeederId === null) {
      // Reuse path — revoke EVERY live token this feeder holds, then refuse.
      // Keyed on `sub` rather than any row's feeder_id: when the presented jti
      // has no row at all, the JWT's subject is the only identity there is.
      const revoked = await query<{ jti: string }>(
        `UPDATE refresh_tokens SET revoked_at = now()
          WHERE feeder_id = $1 AND used_at IS NULL AND revoked_at IS NULL
          RETURNING jti`,
        [sub],
      );
      req.log.warn(
        { feederId: sub, revokedCount: revoked.rowCount ?? 0 },
        "refresh token reuse detected — revoking every live session for this feeder",
      );
      return reply.status(401).send({
        ok: false,
        error: { message: "refresh token already used", code: "REFRESH_REUSED" },
      });
    }

    // The live role read, for the same reasons lib/require-role.ts insists on
    // it everywhere else: what this response says about role/trust must be
    // what the database says now, not what a 30-day-old minting moment knew.
    const feederRes = await query<FeederRow>(
      `SELECT id, display_name, role, trust_score, home_ward FROM feeders WHERE id = $1`,
      [claimedFeederId],
    );
    const feeder = feederRes.rows[0];
    if (!feeder) {
      return reply.status(401).send({
        ok: false,
        error: { message: "account no longer exists", code: "FEEDER_GONE" },
      });
    }

    return {
      ok: true,
      data: {
        accessToken,
        refreshToken,
        feeder: {
          displayName: feeder.display_name,
          trustScore: feeder.trust_score,
          role: feeder.role as FeederRole,
          homeWard: feeder.home_ward ?? undefined,
        },
      },
    };
  });
}
