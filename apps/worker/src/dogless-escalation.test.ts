/**
 * Design v6: a dogless SOS case (migration 0027: no dog, a ward and a point)
 * escalates to the vets nearest the case's own point.
 */
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool, query } from "@hetja/db";
import { HANDLERS } from "./index.js";

afterAll(async () => {
  await pool.end();
});

describe("escalate_sos on a dogless case", () => {
  it("pages the vet nearest the case's point", async () => {
    const near = await query<{ id: string }>(
      `INSERT INTO vets (clinic_name, geo, signing_key_pub)
       VALUES ('Dogless Near', ST_SetSRID(ST_MakePoint(72.8281, 19.1321), 4326)::geography, 'none') RETURNING id`,
    );
    const scan = await query<{ id: string }>(
      `INSERT INTO scans (dog_id, client_uuid, scan_type, captured_at) VALUES (NULL, $1, 'sos', now()) RETURNING id`,
      [randomUUID()],
    );
    const c = await query<{ id: string }>(
      `INSERT INTO sos_cases (scan_id, dog_id, severity, ward_id, geo)
       VALUES ($1, NULL, 'serious', 'K-West', ST_SetSRID(ST_MakePoint(72.828, 19.132), 4326)::geography)
       RETURNING id`,
      [scan.rows[0].id],
    );
    try {
      await HANDLERS.escalate_sos({ caseId: c.rows[0].id, dogId: null });
      const state = await query(`SELECT tier, escalated_at FROM sos_cases WHERE id = $1`, [c.rows[0].id]);
      expect(state.rows[0].tier).toBe(2);
      const vets = await query<{ vet_id: string }>(
        `SELECT vet_id FROM sos_notifications WHERE case_id = $1 AND vet_id IS NOT NULL`,
        [c.rows[0].id],
      );
      expect(vets.rows.map((r) => r.vet_id)).toContain(near.rows[0].id);
    } finally {
      await query(`DELETE FROM sos_notifications WHERE case_id = $1`, [c.rows[0].id]);
      await query(`DELETE FROM sos_cases WHERE id = $1`, [c.rows[0].id]);
      await query(`DELETE FROM scans WHERE id = $1`, [scan.rows[0].id]);
      await query(`DELETE FROM vets WHERE id = $1`, [near.rows[0].id]);
    }
  });
});
