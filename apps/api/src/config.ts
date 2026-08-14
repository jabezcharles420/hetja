/**
 * Hetja API configuration — every secret/env is validated at boot via zod.
 * KMS-held pepper for identity HMAC (email, since the phone -> email OTP
 * migration) lives OUTSIDE env files in production (INVARIANT 3); dev
 * fallbacks are clearly marked and never used in prod.
 */
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  // Bind address. In production this is 127.0.0.1: Caddy terminates TLS and
  // reverse-proxies to it, so the port must not be reachable from the internet.
  HOST: z.string().default("0.0.0.0"),
  PGHOST: z.string().default("127.0.0.1"),
  PGPORT: z.coerce.number().int().default(5432),
  PGDATABASE: z.string().default("hetja"),
  PGUSER: z.string().default("app_user"),
  PGPASSWORD: z.string().default("8ffe587d42b5b5a56109fc1234b4d59309e2a87efa1b3fe4e17a7141feea851e"),
  // INVARIANT 3: identity_hmac pepper (was phone_hmac's before the email OTP
  // migration; same key, same algorithm). Production MUST inject via
  // KMS/secret manager — never a committed env file.
  HETJA_HMAC_PEPPER: z.string().min(16).default("dev-pepper-not-for-prod-0001"),
  // HMAC key that signs QR slugs (matches the collar's laser-etched signature).
  HETJA_QR_SECRET: z.string().min(16).default("dev-qr-secret-change-me"),
  JWT_SECRET: z.string().min(16).default("dev-jwt-secret-change-me"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  // HMAC key that attests anonymous device tokens (INVARIANT 6 rate-limit subject).
  // Also signs the ALTCHA proof-of-work challenges issued for the desktop-web
  // fallback (routes/devices.ts) -- one secret, both halves of the flow.
  HETJA_DEVICE_SECRET: z.string().min(16).default("dev-device-secret-change-me"),
  // Anonymous device-token proof-of-work difficulty, in leading zero bits
  // (desktop fallback, ALTCHA v2 SHA-256). ALTCHA encodes difficulty as a hex
  // key prefix, so the EFFECTIVE difficulty rounds this UP to a nibble
  // boundary -- the required work is never below this number, but it can be
  // well above what was typed. That rounding is why the default is 16 and not
  // 18: 18 rounds to 20 effective bits, and 20 bits is a solve the browser
  // fallback in apps/scan could not finish inside its own 20 s budget.
  // Measured on a dev laptop, 2026-08-14: 0.009 ms per crypto.subtle SHA-256
  // attempt, so 2^20 expected attempts is ~9.4 s of pure hashing there and
  // simply does not land on a mid-range phone several times slower. 16 rounds
  // to 16 (~0.6 s on the same box), which leaves real headroom for a slow
  // handset -- the whole point of this path is a stranger standing over an
  // injured dog getting a report filed, not the "couldn't confirm the report
  // automatically" degrade.
  //
  // What lowering it costs, stated plainly: an attacker's cost per minted
  // token drops from ~2^20 to ~2^16 hashes. On this box a native SHA-256 loop
  // runs ~696k h/s, i.e. 1.5 s per token at 20 bits versus 0.09 s at 16 -- so
  // the PoW was never the thing bounding abuse at either setting. What bounds
  // it is INVARIANT 7's 2/day + 5/week cap, and that cap only actually holds
  // because lib/device.ts now rejects non-canonical token encodings and
  // routes/sos.ts keys the cap on the canonical deviceId; before that fix one
  // solve at ANY difficulty bought unlimited budget.
  //
  // The upper bound is not cosmetic. `keyPrefixForDifficulty` turns this into
  // a `"0".repeat(bits / 4)` hex prefix, so a fat-fingered `180` would ask for
  // a 45-nibble prefix: every mint becomes unsolvable, anonymous SOS
  // attestation stops working entirely, and nothing errors at boot or appears
  // in any dashboard. 20 is the ceiling because 20 is already past what the
  // desktop/mobile solver can carry (see above), so anything higher is a typo
  // by definition.
  DEVICE_POW_DIFFICULTY: z.coerce.number().int().min(8).max(20).default(16),
  // RESEARCH-2: pin to the real reverse proxy hop count (0 = no proxy) — never `true`.
  TRUST_PROXY: z.coerce.number().int().min(0).max(4).default(0),
  // Comma-separated exact browser origins allowed in production. Exact origins
  // rather than regexes: a suffix pattern like /\.hetja\.in$/ silently fails to
  // match the apex (https://hetja.in) and matches evil-hetja.in lookalikes.
  CORS_ORIGINS: z
    .string()
    .default("https://hetja.in,https://www.hetja.in"),
  // Object storage (S3-compatible). Dev default: local disk backend.
  STORAGE_BACKEND: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("data/photos"),
  S3_ENDPOINT: z.string().default(""),
  S3_BUCKET: z.string().default("hetja"),
  S3_ACCESS_KEY: z.string().default(""),
  S3_SECRET_KEY: z.string().default(""),
  // Brevo SMTP relay (free tier, 300/day) — the actual delivery mechanism for
  // OTP emails. No defaults on host/user/pass: unlike the other secrets in
  // this file, there is no dev value that would even connect anywhere, and a
  // committed placeholder here would invite the exact bug this migration
  // fixes (silently minting a code and delivering it to nobody). Development
  // and test never call the mailer at all — see apps/api/src/routes/auth.ts.
  BREVO_SMTP_HOST: z.string().default(""),
  BREVO_SMTP_PORT: z.coerce.number().int().positive().default(587),
  BREVO_SMTP_USER: z.string().default(""),
  BREVO_SMTP_PASS: z.string().default(""),
  // hetja.in has SPF/DKIM/DMARC configured; sending from a domain without
  // that (a personal Gmail address, for instance) gets silently dropped by
  // receiving providers rather than bouncing.
  MAIL_FROM: z.string().default("no-reply@hetja.in"),
});

export type AppConfig = z.infer<typeof EnvSchema>;

/**
 * A handful of these zod fields carry `.default(...)` fallbacks so local dev
 * boots with zero setup. Every one of those defaults is a known, committed
 * placeholder (PGPASSWORD's literal alone appears in five files in this
 * repo), so in production a missing env var must throw here instead of
 * silently booting against it — see packages/db/src/pool.ts's
 * `requiredInProd` (same idiom, applied to the DB pool) and
 * packages/db/src/seed.ts's `requireQrSecret` (same idiom, for the one
 * secret whose failure mode is physical rather than a security bug).
 *
 * This checks the *raw* env, not the parsed config, because by the time
 * EnvSchema.parse() has run, an absent var has already been replaced by its
 * default — there is no way to tell "explicitly set to the dev value" apart
 * from "unset" after the fact.
 */
function requireInProd(env: NodeJS.ProcessEnv, name: string, explanation: string): void {
  const value = env[name];
  if (value !== undefined && value !== "") return;
  throw new Error(
    `${name} is not set. Refusing to start in production with the development ` +
      `default for ${name} -- ${explanation} Set ${name} in the environment ` +
      `(see apps/api/.env.example and AGENTS.md section (c)).`,
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);

  if (parsed.NODE_ENV === "production") {
    requireInProd(
      env,
      "PGPASSWORD",
      "that literal is committed in five files in this repo, so a box that boots " +
        "with it is running with a publicly known database password.",
    );
    requireInProd(
      env,
      "HETJA_HMAC_PEPPER",
      "INVARIANT 3 requires this pepper to come from KMS/secret manager in " +
        "production; the dev value is committed and public, which defeats the " +
        "one-way identity_hmac guarantee it is supposed to provide.",
    );
    requireInProd(
      env,
      "HETJA_QR_SECRET",
      "this HMAC key must match the exact value already burned into printed " +
        "collar QR codes. A mismatched value makes every printed collar QR " +
        "fail signature verification -- a physical, silent failure discovered " +
        "only when a stranger scans a real tag, not at boot time and not in " +
        "any dashboard.",
    );
    requireInProd(
      env,
      "HETJA_DEVICE_SECRET",
      "this HMAC key attests anonymous device tokens that gate the INVARIANT 6/7 " +
        "rate limits; the dev value is committed and public, so anyone can forge " +
        "an attested device token and bypass those caps.",
    );
    requireInProd(
      env,
      "JWT_SECRET",
      "the dev value is committed and public, so anyone who has read this repo " +
        "can mint a valid feeder/admin access token against a production server " +
        "still using it.",
    );
    // The exact bug this whole migration exists to fix: phone OTP minted a
    // code and returned it to nobody in production because there was no SMS
    // plumbing at all. Refuse to boot without real SMTP config rather than
    // repeat that mistake with email -- a silently-undelivered OTP is a
    // production incident nobody would notice until a feeder complained.
    requireInProd(
      env,
      "BREVO_SMTP_HOST",
      "email OTP delivery has no working default -- without a real SMTP host " +
        "the server would boot successfully and mint codes it can never " +
        "deliver, exactly like the undelivered phone OTP this replaces.",
    );
    requireInProd(
      env,
      "BREVO_SMTP_USER",
      "the SMTP host is set but authentication would fail without this, " +
        "which surfaces only when the first OTP email silently fails to send.",
    );
    requireInProd(
      env,
      "BREVO_SMTP_PASS",
      "the SMTP host is set but authentication would fail without this, " +
        "which surfaces only when the first OTP email silently fails to send.",
    );
  }

  return parsed;
}
