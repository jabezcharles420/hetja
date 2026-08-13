import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthOtpRequest, AuthOtpVerify, type FeederRole } from "@hetja/contracts";
import { query } from "@hetja/db";
import { identityHmac } from "../lib/hmac.js";
import { signAccessToken, signRefreshToken } from "../lib/jwt.js";
import { verifyDeviceToken } from "../lib/device.js";
import { issueOtp, verifyOtp } from "../lib/otp.js";
import { sendOtpEmail } from "../lib/mailer.js";

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
  const res = await query<FeederRow>(
    `INSERT INTO feeders (identity_hmac, display_name, role, trust_score, consent_version, is_minor)
     VALUES ($1, 'Hetja Feeder', 'feeder', 30, $2, $3)
     ON CONFLICT (identity_hmac) DO UPDATE SET identity_hmac = EXCLUDED.identity_hmac
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
    const idHmac = identityHmac(email, app.config.HETJA_HMAC_PEPPER);
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

    const idHmac = identityHmac(email, app.config.HETJA_HMAC_PEPPER);
    const result = await verifyOtp(idHmac, code, app.config.HETJA_HMAC_PEPPER);
    if (result !== "ok") {
      const status = result === "too_many_attempts" ? 429 : 400;
      return reply.status(status).send({ ok: false, error: { message: result, code: result.toUpperCase() } });
    }

    const feeder = await upsertFeeder(idHmac, consentVersion, isMinor);

    const accessToken = signAccessToken(feeder.id, app.config.JWT_SECRET, app.config.JWT_ACCESS_TTL);
    const refreshToken = signRefreshToken(feeder.id, app.config.JWT_SECRET, app.config.JWT_REFRESH_TTL);

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
