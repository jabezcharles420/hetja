import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ScanInput } from "@straynet/contracts";
import { query } from "@straynet/db";
import { verifyDeviceToken } from "../lib/device.js";
import { newPhotoKey, storePhoto, type StorageConfig } from "../lib/storage.js";

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
  dogId: string,
  geoWktValue: string,
  capturedAt: Date,
  receivedAt: Date,
): Promise<void> {
  await query(
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
    if (typeof deviceToken !== "string" || !verifyDeviceToken(deviceToken, app.config.STRAYNET_DEVICE_SECRET)) {
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

    const insertRes = await query<ScanRow>(
      `INSERT INTO scans (dog_id, client_uuid, scan_type, geo, device_token, captured_at, received_at, review_status)
       VALUES ($1, $2, $3, $4::geography, $5, $6, $7, 'pending')
       ON CONFLICT (client_uuid) DO NOTHING
       RETURNING id`,
      [
        dog.id,
        clientUuid,
        type,
        geo ? geoWkt(geo.lat, geo.lng) : null,
        deviceToken,
        captured,
        receivedAt,
      ],
    );

    const created = (insertRes.rowCount ?? 0) === 1;
    if (created) {
      const scanId = insertRes.rows[0].id;
      if (geo) await applyLww(dog.id, geoWkt(geo.lat, geo.lng), captured, receivedAt);
      if (photoBase64) {
        const photoKey = newPhotoKey();
        void persistScanAssets(app, scanId, photoKey, photoBase64);
      }
    }

    return {
      ok: true,
      data: { created, scanId: created ? insertRes.rows[0].id : undefined },
    };
  });
}
