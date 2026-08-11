import { z } from "zod";

export const SLUG_REGEX = /^[a-z2-7]{9}$/; // 8 data chars + 1 check char (blueprint v1.1)

export const DogStatus = z.enum(["active", "lost", "deceased", "adopted", "relocated"]);
export type DogStatus = z.infer<typeof DogStatus>;

export const ScanType = z.enum(["view", "feed", "sos", "retag", "identify"]);
export type ScanType = z.infer<typeof ScanType>;

export const ReviewStatus = z.enum(["pending", "auto_passed", "flagged", "human_passed", "rejected"]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

export const FeederRole = z.enum(["feeder", "vet", "bmc_officer", "admin"]);
export type FeederRole = z.infer<typeof FeederRole>;

export const SosSeverity = z.enum(["minor", "serious", "critical"]);
export type SosSeverity = z.infer<typeof SosSeverity>;

const isoDateTime = () => z.iso.datetime();

export const GeoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type GeoPoint = z.infer<typeof GeoPoint>;

export const Dog = z.object({
  slug: z.string().regex(SLUG_REGEX, { message: "slug must match /^[a-z2-7]{9}$/" }),
  name: z.string().min(1).max(80).optional(),
  sex: z.enum(["male", "female", "unknown"]).optional(),
  approxAge: z.number().int().min(0).optional(),
  coatPattern: z.string().min(1).max(80).optional(),
  temperament: z.string().min(1).max(200).optional(),
  vibe: z.string().min(1).max(200).optional(),
  status: DogStatus,
  wardId: z.string().min(1).max(16),
  abcStatus: z.string().min(1).max(80).optional(),
  lastSeenAt: isoDateTime().optional(),
});
export type Dog = z.infer<typeof Dog>;

export const Collar = z.object({
  qrCode: z.string().min(1).max(64),
  hmacSig: z.string().min(1).max(128),
  batchNo: z.string().min(1).max(32),
  material: z.string().min(1).max(64),
  boundOnce: z.boolean(),
});
export type Collar = z.infer<typeof Collar>;

export const FeederPublic = z.object({
  displayName: z.string().min(1).max(80),
  trustScore: z.number().min(0).max(100),
  role: FeederRole,
  homeWard: z.string().min(1).max(16).optional(),
});
export type FeederPublic = z.infer<typeof FeederPublic>;

export const Scan = z.object({
  id: z.string().min(1).max(64),
  clientUuid: z.string().uuid(),
  dogSlug: z.string().regex(SLUG_REGEX),
  scanType: ScanType,
  geo: GeoPoint.optional(),
  photoKey: z.string().min(1).max(256).optional(),
  reviewStatus: ReviewStatus,
  capturedAt: isoDateTime(),
  receivedAt: isoDateTime(),
});
export type Scan = z.infer<typeof Scan>;

const SKEW_MS = 15 * 60 * 1000; // ±15 minutes (INVARIANT 4 — clock-skew clamp)

export const clockSkewClamped = () =>
  isoDateTime().refine(
    (value) => {
      const skewMs = Math.abs(Date.now() - new Date(value).getTime());
      return skewMs <= SKEW_MS;
    },
    { message: "capturedAt is outside the allowed ±15min skew window" },
  );

export const MAX_PHOTO_BASE64_CHARS = Math.ceil((2 * 1024 * 1024) / 3) * 4;

export const ScanInput = z.object({
  clientUuid: z.string().uuid(),
  dogSlug: z.string().regex(SLUG_REGEX),
  type: ScanType,
  geo: GeoPoint.optional(),
  photoBase64: z.string().max(MAX_PHOTO_BASE64_CHARS).optional(),
  capturedAt: clockSkewClamped(),
});
export type ScanInput = z.infer<typeof ScanInput>;

export const SosReport = z.object({
  severity: SosSeverity,
  note: z.string().max(500),
  deviceToken: z.string().min(1).max(256),
});
export type SosReport = z.infer<typeof SosReport>;

export const MedicalRecordInput = z.object({
  dogId: z.string().uuid(),
  correctsRecordId: z.string().uuid().optional(), // corrections APPEND, never UPDATE
  recordType: z.string().min(1).max(64),
  vaccineName: z.string().min(1).max(64).optional(),
  vaccineDate: z.iso.date().optional(),
  abcDate: z.iso.date().optional(),
  diagnosis: z.string().min(1).max(500).optional(),
  treatment: z.string().min(1).max(1000).optional(),
  severity: z.string().min(1).max(32).optional(),
});
export type MedicalRecordInput = z.infer<typeof MedicalRecordInput>;

export const StoryInput = z.object({
  paragraph: z.string().min(1).max(2000),
});
export type StoryInput = z.infer<typeof StoryInput>;

export const TrustDelta = z.object({
  amount: z.number().int().min(-100).max(100),
  reason: z.string().min(1).max(200),
  createdAt: isoDateTime(),
});
export type TrustDelta = z.infer<typeof TrustDelta>;

export const HeatmapCell = z.object({
  lat: z.number(),
  lng: z.number(),
  fedRatio: z.number().min(0).max(1),
  wardId: z.string().min(1).max(16),
});
export type HeatmapCell = z.infer<typeof HeatmapCell>;

export const INDIA_MOBILE_REGEX = /^\+91[6-9]\d{9}$/;

export const AuthOtpRequest = z.object({
  phone: z.string().regex(INDIA_MOBILE_REGEX, { message: "phone must be a +91 e164 mobile number" }),
});
export type AuthOtpRequest = z.infer<typeof AuthOtpRequest>;

export const AuthOtpVerify = z.object({
  phone: z.string().regex(INDIA_MOBILE_REGEX),
  code: z.string().regex(/^\d{6}$/),
  deviceToken: z.string().min(1).max(256),
  consentVersion: z.number().int().min(1),
  isMinor: z.boolean(),
});
export type AuthOtpVerify = z.infer<typeof AuthOtpVerify>;

export function apiEnvelope<T extends z.ZodType>(dataSchema: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data: dataSchema }),
    z.object({
      ok: z.literal(false),
      error: z.object({ message: z.string(), code: z.string().optional() }),
    }),
  ]);
}

export type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; code?: string } };
