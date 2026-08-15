import { z } from "zod";

// 8 data chars + 1 check char. The alphabet is the generator's
// (packages/db/src/slugs.ts): "abcdefghijkmnopqrstuvwxyz23456789" — a-z without
// the confusable `l`, digits 2-9. This previously read /^[a-z2-7]{9}$/, which
// rejected every slug containing an 8 — including the real Phase-0 collar
// c3di5esh8, whose SOS reports were refused with a 400.
export const SLUG_REGEX = /^[a-km-z2-9]{9}$/;

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
  slug: z.string().regex(SLUG_REGEX, { message: "slug must match /^[a-km-z2-9]{9}$/" }),
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

/**
 * How far in the FUTURE a `capturedAt` may sit (INVARIANT 4 clock-skew clamp).
 *
 * This bound is asymmetric on purpose, and it used to be symmetric — a bug that
 * defeated the feature the invariant exists to serve.
 *
 * INVARIANT 4 resolves offline conflicts on `captured_at` precisely because "a
 * feeder's phone can be offline for hours". The clamp was
 * `Math.abs(Date.now() - captured) <= 15min`, which rejected anything captured
 * more than fifteen minutes ago — so every feed queued offline for longer than
 * a quarter of an hour became a permanent 400 the moment it finally synced.
 * That is the exact population the offline queue exists for: a feeder out of
 * signal for an afternoon. INVARIANT 5's idempotent replay then had nothing
 * left to be idempotent about, and the client, correctly treating a 400 as a
 * permanent verdict, discarded the feed and its photo.
 *
 * Only the future direction needs a tight bound, because only the future
 * direction is dangerous. `applyLww` keeps the observation with the greatest
 * `captured_at`, so a phone whose clock runs fast (or a client that lies) would
 * win last-writer-wins indefinitely and pin `last_seen_geo` — and that field is
 * load-bearing for the SOS geofence. A `capturedAt` in the past cannot do that:
 * it simply loses the comparison, which is the correct outcome for an old
 * observation.
 */
const FUTURE_SKEW_MS = 15 * 60 * 1000;

/**
 * How far in the PAST a `capturedAt` may sit. Generous, because a long offline
 * stretch is a legitimate and expected state, but not unbounded — a timestamp
 * from 1970 or 2099 is a broken client, not a patient feeder, and pinning some
 * ceiling keeps `applyLww` reasoning about a finite window.
 */
const PAST_SKEW_MS = 30 * 24 * 60 * 60 * 1000;

export const clockSkewClamped = () =>
  isoDateTime().refine(
    (value) => {
      const aheadMs = new Date(value).getTime() - Date.now();
      return aheadMs <= FUTURE_SKEW_MS && -aheadMs <= PAST_SKEW_MS;
    },
    {
      message:
        "capturedAt may be at most 15min in the future or 30d in the past",
    },
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

// Email OTP login (replaces phone OTP — see docs/INVARIANTS.md #3). zod v4
// (this package's version, distinct from apps/api's own zod@^3.23 — the two
// never share a runtime instance, so the version split is safe) moved email
// validation off `z.string().email()` (deprecated, still present for compat)
// onto the top-level `z.email()`, which is what this uses. 254 is RFC 5321's
// practical max length for a full email address; there is no generic
// fallback validator needed here the way INDIA_MOBILE_REGEX was the only
// phone shape this ever had to accept — `z.email()` already covers the
// general case.
export const EmailAddress = z.email({ message: "must be a valid email address" }).max(254);

export const AuthOtpRequest = z.object({
  email: EmailAddress,
});
export type AuthOtpRequest = z.infer<typeof AuthOtpRequest>;

export const AuthOtpVerify = z.object({
  email: EmailAddress,
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
