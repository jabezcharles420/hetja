import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ScanInput } from "@straynet/contracts";
import { query, withTx } from "@straynet/db";
import { verifyAccessToken } from "../lib/jwt.js";
import { verifyDeviceToken } from "../lib/device.js";
import { logTrustEvent, recomputeScore, type TxClient } from "../lib/trust.js";
import { newPhotoKey, storePhoto, type StorageConfig } from "../lib/storage.js";
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

async function persistScanAssets(
  app: FastifyInstance,
  scanId: string,
  photoKey: string,
  photoBase64: string,
): Promise<void> {
  try {
    await storePhoto(photoBase64, photoKey, app.config as unknown as StorageConfig);
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
    let feederId: string | null = null;
    const rawAuth = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
    if (rawAuth.startsWith("Bearer ")) {
      try {
        feederId = verifyAccessToken(rawAuth.slice(7), app.config.JWT_SECRET).sub;
      } catch {
        return reply
          .status(401)
          .send({ ok: false, error: { message: "invalid access token", code: "BAD_ACCESS_TOKEN" } });
      }
    } else if (typeof deviceToken !== "string" || !verifyDeviceToken(deviceToken, app.config.STRAYNET_DEVICE_SECRET)) {
      return reply
        .status(401)
        .send({ ok: false, error: { message: "attested device token required", code: "UNAUTHENTICATED_DEVICE" } });
    }

    const parsed = ScanInput.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ ok: false, error: { message: "invalid scan payload", code: "INVALID_SCAN" } });
    }
    const { clientUuid, dogSlug, type, geo, photoBase64, capturedAt } = parsed.data;

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
          deviceToken,
          captured,
          receivedAt,
        ],
      );

      const created = (insertRes.rowCount ?? 0) === 1;
      if (!created) return { created: false as const, scanId: undefined, photoBase64 };

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
      return { created: true as const, scanId, photoBase64 };
    });

    if (result.created && result.scanId && result.photoBase64) {
      const photoKey = newPhotoKey();
      void persistScanAssets(app, result.scanId, photoKey, result.photoBase64);
    }

    return {
      ok: true,
      data: { created: result.created, scanId: result.created ? result.scanId : undefined },
    };
  });
}
