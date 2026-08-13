/**
 * Hetja ledger trust endpoints (INVARIANT 10).
 *
 * GET /api/v1/ledger/anchor        — latest published anchor (head hash + count)
 * GET /api/v1/ledger/verify?n=…    — recompute the head from the last n
 *   medical_records and compare against the latest published anchor.
 *   Tamper-evidence anyone can run.
 */
import type { FastifyInstance } from "fastify";
import { recomputeHead, type LedgerRecord } from "@hetja/ledger";
import { query } from "@hetja/db";

export default async function ledgerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/ledger/anchor", async () => {
    const res = await query(
      `SELECT head_hash, record_count, published_at, published_url
         FROM ledger_anchors ORDER BY published_at DESC LIMIT 1`,
    );
    if (res.rowCount === 0) {
      return { ok: true, data: { anchor: null, note: "no anchor published yet (daily job pending)" } };
    }
    return { ok: true, data: { anchor: res.rows[0] } };
  });

  app.get<{ Querystring: { n?: string } }>("/api/v1/ledger/verify", async (req) => {
    const n = Math.min(Math.max(Number(req.query.n ?? 1000) || 1000, 1), 50_000);
    const rows = await query<LedgerRecord>(
      `SELECT hash_prev AS prev, payload, hash_vet_id AS "vetId",
              hash_ts AS ts, hash_curr AS hash
         FROM medical_records
        ORDER BY created_at ASC, id ASC
        LIMIT $1`,
      [n],
    );
    const anchor = await query<{ head_hash: string }>(
      `SELECT head_hash FROM ledger_anchors ORDER BY published_at DESC LIMIT 1`,
    );
    if (rows.rowCount === 0 || anchor.rowCount === 0) {
      return { ok: true, data: { records: rows.rowCount, verdict: "insufficient_data" } };
    }
    const head = recomputeHead(rows.rows);
    const valid = head === anchor.rows[0].head_hash;
    return {
      ok: true,
      data: {
        records: rows.rowCount,
        recomputedHead: head,
        publishedHead: anchor.rows[0].head_hash,
        verdict: valid ? "valid" : "TAMPERED",
      },
    };
  });
}
