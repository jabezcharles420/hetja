import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthOtpRequest, AuthOtpVerify, type FeederRole } from "@straynet/contracts";
import { query } from "@straynet/db";
import { phoneHmac } from "../lib/hmac.js";
import { signAccessToken, signRefreshToken } from "../lib/jwt.js";
import { verifyDeviceToken } from "../lib/device.js";
import { issueOtp, verifyOtp } from "../lib/otp.js";

interface FeederRow {
  id: string;
  display_name: string;
  role: string;
  trust_score: number;
  home_ward: string | null;
}

async function upsertFeeder(
  phoneHmacVal: string,
  consentVersion: number,
  isMinor: boolean,
): Promise<FeederRow> {
  const res = await query<FeederRow>(
    `INSERT INTO feeders (phone_hmac, display_name, role, trust_score, consent_version, is_minor)
     VALUES ($1, 'Hetja Feeder', 'feeder', 30, $2, $3)
     ON CONFLICT (phone_hmac) DO UPDATE SET phone_hmac = EXCLUDED.phone_hmac
     RETURNING id, display_name, role, trust_score, home_ward`,
    [phoneHmacVal, String(consentVersion), isMinor],
  );
  return res.rows[0];
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/auth/otp", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = AuthOtpRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "phone must be a +91 e164 mobile number", code: "INVALID_PHONE" } });
    }
    const { phone } = parsed.data;
    const { code, expiresAt } = issueOtp(phone, app.config.HETJA_HMAC_PEPPER);
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
    const { phone, code, deviceToken, consentVersion, isMinor } = parsed.data;

    if (!verifyDeviceToken(deviceToken, app.config.HETJA_DEVICE_SECRET)) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "attested device token required", code: "BAD_DEVICE_TOKEN" } });
    }

    const result = verifyOtp(phone, code, app.config.HETJA_HMAC_PEPPER);
    if (result !== "ok") {
      const status = result === "too_many_attempts" ? 429 : 400;
      return reply.status(status).send({ ok: false, error: { message: result, code: result.toUpperCase() } });
    }

    const feeder = await upsertFeeder(
      phoneHmac(phone, app.config.HETJA_HMAC_PEPPER),
      consentVersion,
      isMinor,
    );

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
