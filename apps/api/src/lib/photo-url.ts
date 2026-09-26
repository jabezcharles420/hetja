import type { FastifyRequest } from "fastify";

/**
 * Absolute photo URL, built exactly as apps/web's dogPhotoUrl does
 * (`${origin}/${photoKey}`): photos are served from the API origin. The
 * origin is PUBLIC_API_ORIGIN when configured, else the origin this request
 * arrived on. Computed per response, never cached, because the second form
 * depends on the request. (Moved here from routes/dogs.ts when the v5 routes
 * needed the same rule.)
 */
export function photoUrlFor(req: FastifyRequest, photoKey: string | null | undefined): string | null {
  if (!photoKey) return null;
  const configured = req.server.config.PUBLIC_API_ORIGIN.replace(/\/+$/, "");
  const origin = configured || `${req.protocol}://${req.host}`;
  return `${origin}/${photoKey.replace(/^\/+/, "")}`;
}

/**
 * A dog's portrait, as a correlated subquery on `d.id`: the newest photo on any
 * non-SOS, non-rejected scan. The same rule GET /api/v1/dogs/:slug has used
 * since hardening batch 1 (an SOS photo is evidence, not a portrait; a photo a
 * moderator rejected is off the dog's page). A registration photo (v5 R2) is
 * stored on an 'identify' scan precisely so it falls under this rule.
 */
export const PORTRAIT_SQL = `(SELECT p.photo_s3_key FROM scans p
    WHERE p.dog_id = d.id AND p.photo_s3_key IS NOT NULL AND p.scan_type <> 'sos'
      AND p.review_status <> 'rejected' AND p.photo_hidden_at IS NULL
    ORDER BY p.received_at DESC LIMIT 1)`;

/**
 * Design v7 (A3, A4): the dog's PUBLISHED avatar, as a correlated subquery on
 * `d.id`. For map pins, lists and share cards; the real photo (PORTRAIT_SQL)
 * stays the dog page's record of truth. A moderator hiding a photo (D13,
 * scans.photo_hidden_at) takes it off every surface PORTRAIT_SQL feeds.
 */
export const AVATAR_SQL = `(SELECT a.image_key FROM dog_avatars a
    WHERE a.dog_id = d.id AND a.status = 'published' LIMIT 1)`;
