/**
 * Design v7 worker jobs: the vets' turn on an SOS (sos_open_to_vets), the
 * daily sweep (documents 30 days after a decision, retired avatars, passkey
 * challenges, the vaccine-due reminder) and the drive heads-up.
 *
 * DOCS_LOCAL_DIR is read when the module loads, so it is set first and the
 * module imported after.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pool, query } from "@hetja/db";

let dir: string;
let mod: typeof import("./index.js");
const feeders: string[] = [];
const dogs: string[] = [];

async function feeder(name = "Test Vet"): Promise<string> {
  const r = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, consent_version) VALUES ($1, $2, 'v1') RETURNING id`,
    [`v7w-${randomUUID()}`, name],
  );
  feeders.push(r.rows[0].id);
  return r.rows[0].id;
}

async function dog(ward = "K-West", registeredBy: string | null = null): Promise<string> {
  const r = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id, registered_by, last_seen_geo)
     VALUES ($1, 'Moti', $2, $3, ST_SetSRID(ST_MakePoint(72.83, 19.12), 4326)::geography) RETURNING id`,
    [`w7${randomUUID().replace(/-/g, "").slice(0, 7)}`, ward, registeredBy],
  );
  dogs.push(r.rows[0].id);
  return r.rows[0].id;
}

async function sosCase(dogId: string): Promise<string> {
  const s = await query<{ id: string }>(
    `INSERT INTO scans (dog_id, client_uuid, scan_type, captured_at) VALUES ($1, $2, 'sos', now()) RETURNING id`,
    [dogId, randomUUID()],
  );
  const c = await query<{ id: string }>(
    `INSERT INTO sos_cases (scan_id, dog_id, severity, ward_id) VALUES ($1, $2, 'serious', 'K-West') RETURNING id`,
    [s.rows[0].id, dogId],
  );
  return c.rows[0].id;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "hetja-v7-worker-"));
  process.env.DOCS_LOCAL_DIR = dir;
  mod = await import("./index.js");
});

afterAll(async () => {
  await query(`DELETE FROM jobs WHERE kind IN ('send_sos_push', 'send_feeder_push', 'sos_open_to_vets') AND payload::text LIKE ANY($1::text[])`, [
    [...feeders, ...dogs].map((x) => `%${x}%`),
  ]);
  const cases = (await query<{ id: string; scan_id: string }>(`SELECT id, scan_id FROM sos_cases WHERE dog_id = ANY($1::uuid[])`, [dogs])).rows;
  await query(`DELETE FROM jobs WHERE payload->>'caseId' = ANY($1::text[])`, [cases.map((c) => c.id)]);
  await query(`DELETE FROM sos_notifications WHERE case_id = ANY($1::uuid[])`, [cases.map((c) => c.id)]);
  await query(`DELETE FROM sos_cases WHERE id = ANY($1::uuid[])`, [cases.map((c) => c.id)]);
  await query(`DELETE FROM drive_dogs WHERE dog_id = ANY($1::uuid[])`, [dogs]);
  await query(`DELETE FROM drives WHERE created_by = ANY($1::uuid[])`, [feeders]);
  await query(`DELETE FROM ngo_members WHERE feeder_id = ANY($1::uuid[])`, [feeders]);
  await query(`DELETE FROM ngos WHERE applied_by = ANY($1::uuid[])`, [feeders]);
  await query(`DELETE FROM documents WHERE uploaded_by = ANY($1::uuid[])`, [feeders]);
  await query(`DELETE FROM webauthn_challenges WHERE feeder_id = ANY($1::uuid[])`, [feeders]);
  await query(`DELETE FROM vet_profiles WHERE feeder_id = ANY($1::uuid[])`, [feeders]);
  await query(`DELETE FROM scans WHERE dog_id = ANY($1::uuid[])`, [dogs]);
  await query(`DELETE FROM dogs WHERE id = ANY($1::uuid[])`, [dogs]);
  await query(`DELETE FROM feeders WHERE id = ANY($1::uuid[])`, [feeders]);
  await rm(dir, { recursive: true, force: true });
  await pool.end();
});

describe("sos_open_to_vets", () => {
  it("pages verified vets covering the ward who take SOS, never a suspended one, once, and queues the push", async () => {
    const good = await feeder("Dr Good");
    const suspended = await feeder("Dr Suspended");
    const elsewhere = await feeder("Dr Elsewhere");
    await query(
      `INSERT INTO vet_profiles (feeder_id, reg_no, wards, sos_available, status) VALUES
         ($1, '1', '{K-West}', TRUE, 'verified'), ($2, '2', '{K-West}', TRUE, 'suspended'), ($3, '3', '{A}', TRUE, 'verified')`,
      [good, suspended, elsewhere],
    );
    const c = await sosCase(await dog());
    await mod.HANDLERS.sos_open_to_vets({ caseId: c });
    const n = await query<{ feeder_id: string; route: string }>(`SELECT feeder_id, route FROM sos_notifications WHERE case_id = $1`, [c]);
    expect(n.rows).toEqual([{ feeder_id: good, route: "vet_escalation" }]);
    const push = await query(`SELECT 1 FROM jobs WHERE kind = 'send_sos_push' AND payload->>'caseId' = $1`, [c]);
    expect(push.rowCount).toBe(1);
    // Once per case.
    await mod.HANDLERS.sos_open_to_vets({ caseId: c });
    expect((await query(`SELECT 1 FROM jobs WHERE kind = 'send_sos_push' AND payload->>'caseId' = $1`, [c])).rowCount).toBe(1);
  });

  it("does nothing for a case someone already took", async () => {
    const vet = await feeder();
    await query(`INSERT INTO vet_profiles (feeder_id, reg_no, wards, sos_available, status) VALUES ($1, '9', '{K-West}', TRUE, 'verified')`, [vet]);
    const c = await sosCase(await dog());
    await query(`UPDATE sos_cases SET acked_by = $2, acked_at = now(), state = 'acked' WHERE id = $1`, [c, vet]);
    await mod.HANDLERS.sos_open_to_vets({ caseId: c });
    expect((await query(`SELECT 1 FROM sos_notifications WHERE case_id = $1`, [c])).rowCount).toBe(0);
  });
});

describe("sweep_v7", () => {
  it("deletes a document's blob after its date and keeps the row; keeps a document not yet due", async () => {
    const who = await feeder();
    const due = randomUUID();
    const later = randomUUID();
    await mkdir(join(dir, "documents"), { recursive: true });
    for (const id of [due, later]) await writeFile(join(dir, "documents", `${id}.bin`), "ciphertext");
    await query(
      `INSERT INTO documents (id, owner_kind, uploaded_by, kind, mime, size_bytes, sha256, blob_key, delete_after) VALUES
         ($1, 'pending', $3, 'certificate', 'application/pdf', 10, 'x', $4, now() - interval '1 minute'),
         ($2, 'pending', $3, 'certificate', 'application/pdf', 10, 'x', $5, now() + interval '1 day')`,
      [due, later, who, `documents/${due}.bin`, `documents/${later}.bin`],
    );
    const out = await mod.sweepV7();
    expect(out.documents).toBeGreaterThanOrEqual(1);
    await expect(stat(join(dir, "documents", `${due}.bin`))).rejects.toThrow();
    await expect(stat(join(dir, "documents", `${later}.bin`))).resolves.toBeTruthy();
    const rows = await query<{ id: string; deleted_at: Date | null; blob_key: string | null }>(
      `SELECT id, deleted_at, blob_key FROM documents WHERE id = ANY($1::uuid[]) ORDER BY id = $2 DESC`,
      [[due, later], due],
    );
    expect(rows.rows[0].deleted_at).not.toBeNull();
    expect(rows.rows[0].blob_key).toBeNull();
    expect(rows.rows[1].deleted_at).toBeNull();
  });

  it("expires old passkey challenges", async () => {
    const who = await feeder();
    await query(
      `INSERT INTO webauthn_challenges (feeder_id, purpose, challenge, expires_at) VALUES ($1, 'sign', 'old', now() - interval '2 days'), ($1, 'sign', 'new', now() + interval '1 minute')`,
      [who],
    );
    await mod.sweepV7();
    const left = await query<{ challenge: string }>(`SELECT challenge FROM webauthn_challenges WHERE feeder_id = $1`, [who]);
    expect(left.rows.map((r) => r.challenge)).toEqual(["new"]);
  });
});

describe("drive_headsup", () => {
  it("tells the feeders of tomorrow's drive dogs, once", async () => {
    const coord = await feeder("Kavita");
    const priya = await feeder("Priya");
    const d = await dog("K-West", priya);
    const ngo = await query<{ id: string }>(
      `INSERT INTO ngos (name, reg_type, reg_no, wards, status, applied_by) VALUES ('Test NGO', 'trust', 'T', '{K-West}', 'active', $1) RETURNING id`,
      [coord],
    );
    const drive = await query<{ id: string }>(
      `INSERT INTO drives (ngo_id, title, ward_id, starts_at, created_by)
       VALUES ($1, 'Aram Nagar drive', 'K-West', ((now() AT TIME ZONE 'Asia/Kolkata')::date + 1 + time '07:00') AT TIME ZONE 'Asia/Kolkata', $2)
       RETURNING id`,
      [ngo.rows[0].id, coord],
    );
    await query(`INSERT INTO drive_dogs (drive_id, dog_id, task_collar) VALUES ($1, $2, TRUE)`, [drive.rows[0].id, d]);
    expect(await mod.driveHeadsUp()).toBeGreaterThanOrEqual(1);
    const jobs = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM jobs WHERE kind = 'send_feeder_push' AND payload->>'tag' = $1 AND payload::text LIKE $2`,
      [`drive-${drive.rows[0].id}`, `%${priya}%`],
    );
    expect(jobs.rows[0].n).toBe(1);
    await mod.driveHeadsUp();
    const again = await query<{ n: number }>(`SELECT count(*)::int AS n FROM jobs WHERE kind = 'send_feeder_push' AND payload->>'tag' = $1`, [
      `drive-${drive.rows[0].id}`,
    ]);
    expect(again.rows[0].n).toBe(1);
    await query(`DELETE FROM jobs WHERE payload->>'tag' = $1`, [`drive-${drive.rows[0].id}`]);
  });
});

describe("producers", () => {
  it("every v7 handler has a producer", () => {
    for (const k of ["sos_open_to_vets", "sweep_v7", "drive_headsup"]) {
      expect(mod.HANDLERS[k]).toBeTypeOf("function");
      expect(mod.JOB_PRODUCERS[k]).toBeTruthy();
    }
  });
});
