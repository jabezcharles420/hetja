import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ScanInput } from "@hetja/contracts";
import { query, withTx } from "@hetja/db";
import { verifyAccessToken } from "../lib/jwt.js";
import { deviceTokenSubject } from "../lib/device.js";
import { logTrustEvent, recomputeScore, type TxClient } from "../lib/trust.js";
import { decodePhotoUpload, storePhoto, type StorageConfig } from "../lib/storage.js";
import { UnsupportedImageError, type StrippedImage } from "../lib/exif-strip.js";
import { dateInKolkata, updateFeedStreak } from "../lib/gamification.js";

interface DogIdRow {
  id: string;
}

interface ScanRow {
  id: string;
}

function geoWkt(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

async function applyLww(
  client: TxClient,
  dogId: string,
  geoWktValue: string,
  capturedAt: Date,
  receivedAt: Date,
): Promise<void> {
  await client.query(
    `UPDATE dogs
     SET last_seen_geo = $2::geography, last_seen_at = $3, last_seen_received_at = $4
     WHERE id = $1
       AND (last_seen_at IS NULL
            OR $3 > last_seen_at
            OR ($3 = last_seen_at AND $4 >= COALESCE(last_seen_received_at, last_seen_at)))`,
    [dogId, geoWktValue, capturedAt, receivedAt],
  );
}

/**
 * Background write of an already-decoded, already-metadata-stripped image.
 * The decode/strip/validate step deliberately does NOT live here — see the
 * comment at the call site in the handler.
 */
async function persistScanAssets(
  app: FastifyInstance,
  scanId: string,
  photo: StrippedImage,
): Promise<void> {
  try {
    const photoKey = await storePhoto(photo, app.config as unknown as StorageConfig);
    await query(`UPDATE scans SET photo_s3_key = $1 WHERE id = $2`, [photoKey, scanId]);
  } catch (err) {
    app.log.warn({ err, scanId }, "photo persist failed");
  }
}

export default async function scanRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/v1/scans", async (req: FastifyRequest, reply: FastifyReply) => {
    const deviceToken = req.headers["x-device-token"];

    // Dual auth: a feeder may sign scans with a Bearer access token (that
    // attributes the scan for trust), otherwise the attested device token.
    //
    // `deviceSubject` is the CANONICAL device id derived from the token, not the
    // token itself. Two reasons, both learned from the INVARIANT 7 bypass fixed
    // in lib/device.ts on 2026-08-14:
    //
    //   1. Node's base64 decoder ignores non-alphabet characters and padding, so
    //      `tok`, `tok=`, `tok==` and `tok!` all decode to the same device — but
    //      as raw strings they are four distinct values. Any rate limit or
    //      uniqueness constraint keyed on the string is trivially reset by
    //      appending a character. sos.ts was keying its 2/day + 5/week cap on the
    //      raw string, which is what made the cap bypassable.
    //   2. The token is a bearer credential. Storing it in `scans.device_token`
    //      means a leak of that column hands over replayable attestations,
    //      whereas the derived id is not a credential.
    //
    // This route has no rate-limit query keyed on the column today, so the value
    // stored here was not exploitable — but it left the column holding two
    // different kinds of thing depending on which route wrote the row, and the
    // less useful of the two.
    let feederId: string | null = null;
    let deviceSubject: string | null = null;
    const rawAuth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
    if (rawAuth.startsWith("Bearer ")) {
      try {
        feederId = verifyAccessToken(rawAuth.slice(7), app.config.JWT_SECRET).sub;
      } catch {
        return reply
          .status(401)
          .send({ ok: false, error: { message: "invalid access token", code: "BAD_ACCESS_TOKEN" } });
      }
    } else {
      deviceSubject =
        typeof deviceToken === "string"
          ? deviceTokenSubject(deviceToken, app.config.HETJA_DEVICE_SECRET)
          : null;
      if (deviceSubject === null) {
        return reply
          .status(401)
          .send({ ok: false, error: { message: "attested device token required", code: "UNAUTHENTICATED_DEVICE" } });
      }
    }

    const parsed = ScanInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid scan payload", code: "INVALID_SCAN" } });
    }
    const { clientUuid, dogSlug, type, geo, photoBase64, capturedAt } = parsed.data;

    // Container validation + metadata strip happens HERE, synchronously, before
    // the scan row exists — not in the background writer below.
    //
    // Two reasons, both about honesty. First, the browser pipeline
    // (apps/web/lib/photo.ts) is a client-side guard, and a client-side guard is
    // not a control an attacker is subject to: this endpoint accepts
    // `photoBase64` from anyone holding a device token, and unstripped bytes
    // written here end up in `scans.photo_s3_key` and then in a public
    // `GET /api/v1/dogs/:slug` response, publishing whatever GPS the original
    // camera embedded (INVARIANT 2). Second, "reject" has to mean reject: doing
    // this in the background writer could only log a warning, which the feeder
    // experiences as "Feed logged ♥" followed by a photo that silently never
    // existed — the same silent-rejection failure INVARIANT 14 rules out for AI
    // validation.
    //
    // This 400 reaches the offline queue, which used to re-queue on *any* thrown
    // ApiError and so would have retried an undecodable photo forever. That was a
    // pre-existing poison-pill bug — INVARIANT 4's ±15min `capturedAt` skew clamp
    // already turned every feed queued offline for longer than fifteen minutes
    // into the same permanent 400 — and it is fixed: `flush()` in
    // apps/web/lib/offline-queue.ts now drops on a permanent 4xx and reports it
    // through `onDrop`, while still retrying transport failures, 5xx, 429 and 401.
    let photo: StrippedImage | null = null;
    if (photoBase64) {
      try {
        photo = decodePhotoUpload(photoBase64);
      } catch (err) {
        if (!(err instanceof UnsupportedImageError)) throw err;
        return reply.status(400).send({
          ok: false,
          error: { message: `photo rejected: ${err.message}`, code: "INVALID_PHOTO" },
        });
      }
    }

    const dogRes = await query<DogIdRow>(`SELECT id FROM dogs WHERE slug = $1`, [dogSlug]);
    const dog = dogRes.rows[0];
    if (!dog) {
      return reply
        .status(404)
        .send({ ok: false, error: { message: "dog not found", code: "DOG_NOT_FOUND" } });
    }

    const receivedAt = new Date();
    const captured = new Date(capturedAt);

    // INVARIANT 5 + trust callback in ONE transaction: the feed +60 trust
    // event is only logged when the scan was actually created (ON CONFLICT
    // client_uuid DO NOTHING), so a replay can never double-count.
    const result = await withTx(async (client) => {
      const insertRes = await client.query<ScanRow>(
        `INSERT INTO scans (dog_id, client_uuid, scan_type, geo, feeder_id, device_token, captured_at, received_at, review_status)
         VALUES ($1, $2, $3, $4::geography, $5, $6, $7, $8, 'pending')
         ON CONFLICT (client_uuid) DO NOTHING
         RETURNING id`,
        [
          dog.id,
          clientUuid,
          type,
          geo ? geoWkt(geo.lat, geo.lng) : null,
          feederId,
          deviceSubject,
          captured,
          receivedAt,
        ],
      );

      const created = (insertRes.rowCount ?? 0) === 1;
      if (!created) return { created: false as const, scanId: undefined };

      const scanId = insertRes.rows[0].id;
      if (geo) await applyLww(client, dog.id, geoWkt(geo.lat, geo.lng), captured, receivedAt);
      if (type === "feed" && feederId) {
        await updateFeedStreak(feederId, dateInKolkata(captured), client);
        await logTrustEvent(
          { feederId, eventType: "feed", reason: "feed scan logged", refScanId: scanId },
          client,
        );
        await recomputeScore(feederId, client);
      }
      return { created: true as const, scanId };
    });

    if (result.created && result.scanId && photo) {
      void persistScanAssets(app, result.scanId, photo);
    }

    return {
      ok: true,
      data: { created: result.created, scanId: result.created ? result.scanId : undefined },
    };
  });
}
