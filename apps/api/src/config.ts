/**
 * StrayNet API configuration — every secret/env is validated at boot via zod.
 * KMS-held pepper for phone HMAC lives OUTSIDE env files in production
 * (INVARIANT 3); dev fallbacks are clearly marked and never used in prod.
 */
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  PGHOST: z.string().default("127.0.0.1"),
  PGPORT: z.coerce.number().int().default(5432),
  PGDATABASE: z.string().default("straynet"),
  PGUSER: z.string().default("app_user"),
  PGPASSWORD: z.string().default("straynet_dev_2026"),
  // INVARIANT 3: phone_hmac pepper. Production MUST inject via KMS/secret
  // manager — never a committed env file.
  STRAYNET_HMAC_PEPPER: z.string().min(16).default("dev-pepper-not-for-prod-0001"),
  // HMAC key that signs QR slugs (matches the collar's laser-etched signature).
  STRAYNET_QR_SECRET: z.string().min(16).default("dev-qr-secret-change-me"),
  JWT_SECRET: z.string().min(16).default("dev-jwt-secret-change-me"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),
  // HMAC key that attests anonymous device tokens (INVARIANT 6 rate-limit subject).
  STRAYNET_DEVICE_SECRET: z.string().min(16).default("dev-device-secret-change-me"),
  // Anonymous device-token proof-of-work difficulty (desktop fallback).
  DEVICE_POW_DIFFICULTY: z.coerce.number().int().min(8).default(14),
  // Object storage (S3-compatible). Dev default: local disk backend.
  STORAGE_BACKEND: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("data/photos"),
  S3_ENDPOINT: z.string().default(""),
  S3_BUCKET: z.string().default("straynet"),
  S3_ACCESS_KEY: z.string().default(""),
  S3_SECRET_KEY: z.string().default(""),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return EnvSchema.parse(env);
}
