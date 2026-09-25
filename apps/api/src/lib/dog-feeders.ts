/**
 * "Feeder of a dog" (design v5 contract): the dog's registrator, or a
 * signed-in feeder with a feed scan of that dog in the last 60 days.
 *
 * ONE definition, used by every v5 route that gates on it (tags, collar,
 * prints, status reports, confirm) and by the push fan-outs, so "who may see
 * this dog's tag history" and "who gets told the tag came off" cannot drift.
 *
 * Membership is measured on `received_at` (server time), not `captured_at`: a
 * backdated or clock-skewed phone cannot buy membership, and a feed a
 * moderator REJECTED (photo was not this dog) buys none either. An anonymised
 * account (feeders.deleted_at) is never a feeder of anything.
 */
import { query } from "@hetja/db";

export const FEEDER_WINDOW_DAYS = 60;

/**
 * dogs.sex normalised for copy pronouns (design v5): "male" | "female", or
 * null for "unknown", empty, or anything written before the registration form
 * constrained it. Never guessed.
 */
export function dogSex(value: string | null | undefined): "male" | "female" | null {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "male" || v === "m") return "male";
  if (v === "female" || v === "f") return "female";
  return null;
}

/** Minimal structural view of the pg client so helpers avoid a `pg` import. */
export interface TxClient {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

async function poolQuery<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> {
  const res = await query(text, params);
  return res as unknown as { rows: T[]; rowCount: number | null };
}

const db: TxClient = { query: poolQuery };

export interface DogRef {
  id: string;
  slug: string;
  name: string | null;
  status: string;
  ward_id: string;
  registered_by: string | null;
  registered_device_id: string | null;
  tag_review_since: Date | null;
}

export async function loadDogBySlug(slug: string, client: TxClient = db): Promise<DogRef | null> {
  const res = await client.query<DogRef>(
    `SELECT id, slug, name, status::text AS status, ward_id, registered_by, registered_device_id, tag_review_since
       FROM dogs WHERE slug = $1`,
    [slug],
  );
  return res.rows[0] ?? null;
}

/** The caller has a non-rejected feed scan of this dog inside the window. */
export async function hasRecentFeed(feederId: string, dogId: string, client: TxClient = db): Promise<boolean> {
  const res = await client.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM scans s
        WHERE s.dog_id = $1 AND s.feeder_id = $2 AND s.scan_type = 'feed'
          AND s.review_status <> 'rejected'
          AND s.received_at >= now() - make_interval(days => $3)) AS ok`,
    [dogId, feederId, FEEDER_WINDOW_DAYS],
  );
  return res.rows[0]?.ok === true;
}

export async function isFeederOfDog(feederId: string, dog: Pick<DogRef, "id" | "registered_by">, client: TxClient = db): Promise<boolean> {
  if (dog.registered_by && dog.registered_by === feederId) return true;
  return hasRecentFeed(feederId, dog.id, client);
}

/** Every live account that is a feeder of the dog, optionally minus one (the actor). */
export async function feederIdsOfDog(dogId: string, exclude: string | null, client: TxClient = db): Promise<string[]> {
  const res = await client.query<{ id: string }>(
    `SELECT f.id FROM feeders f
      WHERE f.deleted_at IS NULL
        AND ($2::uuid IS NULL OR f.id <> $2::uuid)
        AND (f.id = (SELECT registered_by FROM dogs WHERE id = $1)
             OR EXISTS (SELECT 1 FROM scans s
                         WHERE s.dog_id = $1 AND s.feeder_id = f.id AND s.scan_type = 'feed'
                           AND s.review_status <> 'rejected'
                           AND s.received_at >= now() - make_interval(days => $3)))`,
    [dogId, exclude, FEEDER_WINDOW_DAYS],
  );
  return res.rows.map((r) => r.id);
}

export interface FeederPush {
  /** Alert kind, for the log and the service worker's tag. */
  kind: "tag" | "not_seen" | "status";
  title: string;
  body: string;
  /** Web route the notification opens. */
  url: string;
  tag: string;
}

/**
 * Hand a non-SOS push to the worker (`send_feeder_push`), the same hand-off
 * shape routes/sos.ts uses for `send_sos_push`. The worker, not this request,
 * applies each recipient's alerts mode and quiet hours at SEND time, so a push
 * queued at 22:59 still respects a quiet window that starts at 23:00. Nothing
 * is enqueued for an empty recipient list.
 */
export async function enqueueFeederPush(client: TxClient, feederIds: string[], push: FeederPush): Promise<void> {
  if (feederIds.length === 0) return;
  await client.query(`INSERT INTO jobs (kind, payload, run_after) VALUES ('send_feeder_push', $1::jsonb, now())`, [
    JSON.stringify({ feederIds, ...push }),
  ]);
}
