/**
 * Ledger trust-endpoint tests (INVARIANT 10 + enhancement stack §D.1 pick 15).
 *
 * The fixture appends real records through POST /api/v1/medical_records rather
 * than INSERTing rows directly, because the thing under test is that the append
 * path and the proof path agree: medical.ts computes and stores the Merkle root
 * for a dog, ledger.ts recomputes it to cut an audit path, and a divergence
 * between those two queries would look exactly like tampering. Hand-built rows
 * would test the proof code against itself.
 *
 * Records are appended for a DEDICATED dog so leaf indices and leaf counts are
 * deterministic no matter what else is in the table. Nothing is cleaned up:
 * medical_records is append-only (INVARIANT 8), which is why the suite refuses
 * to run outside a *_test database (vitest.setup.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { buildServer } from "../server.js";
import { loadConfig } from "../config.js";
import { signAccessToken } from "../lib/jwt.js";
import { generateSlug, query } from "@hetja/db";
import {
  merkleRoot,
  verifyInclusion,
  type LedgerRecord,
  type ProvenRecord,
} from "@hetja/ledger";
import type { FastifyInstance } from "fastify";

/**
 * `merkleRoot` is typed against the full `LedgerRecord` but reads only `hash`
 * (packages/ledger/src/merkle.ts), so a two-column projection is all a tree
 * needs. Same assertion, and same reason, as `asLeaves` in ledger.ts.
 */
const asLeaves = (rows: ProvenRecord[]): LedgerRecord[] => rows as LedgerRecord[];

const config = loadConfig();
let app: FastifyInstance;
let dogId: string;
let feederId: string;

interface Appended {
  id: string;
  hashCurr: string;
  merkleRoot: string;
}
const appended: Appended[] = [];

beforeAll(async () => {
  app = buildServer(config);
  await app.ready();

  const dog = await query<{ id: string }>(
    `INSERT INTO dogs (slug, name, ward_id) VALUES ($1, 'LedgerProofTest', 'A') RETURNING id`,
    [generateSlug()],
  );
  dogId = dog.rows[0].id;

  const feeder = await query<{ id: string }>(
    `INSERT INTO feeders (identity_hmac, display_name, role, consent_version)
     VALUES ($1, 'Proof Test Feeder', 'feeder', 'v1.0') RETURNING id`,
    [`hmac-test-proof-${randomUUID()}`],
  );
  feederId = feeder.rows[0].id;
  const token = signAccessToken(feederId, config.JWT_SECRET, config.JWT_ACCESS_TTL);

  // Three records: enough that the RFC 6962 tree has an unbalanced right
  // subtree (k = 2, so leaf 2 sits one level shallower than leaves 0 and 1).
  // That is the shape a duplicate-the-odd-node tree gets wrong, so a proof for
  // leaf 2 is the one worth having in a fixture.
  for (const treatment of ["proof fixture one", "proof fixture two", "proof fixture three"]) {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/medical_records",
      headers: { authorization: `Bearer ${token}` },
      payload: { dogId, recordType: "feeding_observation", treatment },
    });
    if (res.statusCode !== 200) throw new Error(`fixture append failed: ${res.body}`);
    const d = res.json().data as Appended;
    appended.push({ id: d.id, hashCurr: d.hashCurr, merkleRoot: d.merkleRoot });
  }
});

afterAll(async () => {
  await query("DELETE FROM ledger_anchors WHERE published_url = 'test-anchor'");
  // The dog and feeder cannot be removed: medical_records references the dog
  // and cannot be deleted. Left in place deliberately — see the header.
  await app.close();
});

describe("GET /api/v1/ledger/anchor", () => {
  it("returns the latest published anchor or a clear empty state", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/ledger/anchor" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.anchor === null || typeof data.anchor.head_hash === "string").toBe(true);
  });

  it("says whether an anchor is signed rather than leaving the caller to infer it", async () => {
    await query(
      `INSERT INTO ledger_anchors (head_hash, record_count, published_url)
       VALUES ($1, 1, 'test-anchor')`,
      ["a".repeat(64)],
    );
    const res = await app.inject({ method: "GET", url: "/api/v1/ledger/anchor" });
    const anchor = res.json().data.anchor;
    // An anchor published without a configured signing key is unattributed, and
    // must report that as a fact instead of as a missing field.
    expect(anchor.signed).toBe(false);
    expect(anchor.head_signature).toBeNull();
  });
});

describe("GET /api/v1/ledger/verify", () => {
  it("detects a tampered published anchor (INVARIANT 10)", async () => {
    // Publish a WRONG anchor: 64 'f's cannot match any real recomputed head.
    await query(
      `INSERT INTO ledger_anchors (head_hash, record_count, published_url)
       VALUES ($1, 0, 'test-anchor')`,
      ["f".repeat(64)],
    );
    const res = await app.inject({ method: "GET", url: "/api/v1/ledger/verify" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    if (data.verdict !== "insufficient_data") {
      expect(data.verdict).toBe("TAMPERED");
    }
  });
});

describe("GET /api/v1/ledger/proof", () => {
  it("rejects anything that is not a 64-char hex record hash", async () => {
    for (const q of ["", "?hash=", "?hash=nope", `?hash=${"f".repeat(63)}`, "?hash=../../etc"]) {
      const res = await app.inject({ method: "GET", url: `/api/v1/ledger/proof${q}` });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("INVALID_RECORD_HASH");
    }
  });

  it("404s on a well-formed hash that is not in the ledger", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/ledger/proof?hash=${"e".repeat(64)}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("RECORD_NOT_FOUND");
  });

  it("needs no authentication — an auditor must not depend on our credentials", async () => {
    // INVARIANT 10: tamper-evidence that only works with a token we issue is
    // tamper-evidence we can revoke at the moment it matters.
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/ledger/proof?hash=${appended[0].hashCurr}`,
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns a proof that verifies for every leaf, at the right index", async () => {
    for (const [index, rec] of appended.entries()) {
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/ledger/proof?hash=${rec.hashCurr}`,
      });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;

      expect(data.record).toEqual({ id: rec.id, hash: rec.hashCurr });
      expect(data.dog.proof.index).toBe(index);
      expect(data.dog.proof.leafCount).toBe(appended.length);
      expect(data.dog.proof.leafHash).toBe(rec.hashCurr);
      // The whole point: checkable without the table.
      expect(verifyInclusion(data.record, data.dog.proof, data.dog.proof.root)).toBe(true);
    }
  });

  it("agrees with the root the append path persisted (nothing was rewritten)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/ledger/proof?hash=${appended[0].hashCurr}`,
    });
    const dog = res.json().data.dog;
    // attestedRoot comes from medical_records.merkle_root, written by the third
    // append; proof.root is recomputed now from the same three rows.
    expect(dog.attestedRoot).toBe(appended[appended.length - 1].merkleRoot);
    expect(dog.proof.root).toBe(dog.attestedRoot);
    expect(dog.rootMatchesAttested).toBe(true);
  });

  it("computes the same root an independent RFC 6962 implementation would", async () => {
    const rows = await query<ProvenRecord>(
      `SELECT id, hash_curr AS hash FROM medical_records
        WHERE dog_id = $1 ORDER BY chain_seq ASC NULLS FIRST, created_at ASC, id ASC`,
      [dogId],
    );
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/ledger/proof?hash=${appended[1].hashCurr}`,
    });
    expect(res.json().data.dog.proof.root).toBe(merkleRoot(asLeaves(rows.rows)));
  });

  it("rejects a proof re-pointed at a different root", async () => {
    // Guards the response contract, not the library: whatever we hand back must
    // be a proof that FAILS against a root it was not cut from, or the endpoint
    // is decoration.
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/ledger/proof?hash=${appended[2].hashCurr}`,
    });
    const { record, dog } = res.json().data;
    expect(verifyInclusion(record, dog.proof, "f".repeat(64))).toBe(false);
  });

  it("proves a record against the root published in the daily anchor", async () => {
    // The global tree is shared with every other suite in this database, so the
    // anchor is built from a snapshot taken here. medical_records is
    // append-only and ordered by created_at, so the first N leaves are stable
    // once observed — the re-read below confirms that rather than assuming it,
    // because a suite running in parallel can still append.
    const before = await query<ProvenRecord>(
      `SELECT id, hash_curr AS hash FROM medical_records ORDER BY chain_seq ASC NULLS FIRST, created_at ASC, id ASC`,
    );
    const snapshot = before.rows;
    const root = merkleRoot(asLeaves(snapshot));
    await query(
      `INSERT INTO ledger_anchors (head_hash, merkle_root, record_count, ledger_id, published_url)
       VALUES ($1, $2, $3, 'hetja:medical:global', 'test-anchor')`,
      [snapshot[snapshot.length - 1].hash, root, snapshot.length],
    );

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/ledger/proof?hash=${appended[0].hashCurr}`,
    });
    expect(res.statusCode).toBe(200);
    const global = res.json().data.global;
    expect(global).not.toBeNull();
    expect(global.publishedRoot).toBe(root);
    expect(global.ledgerId).toBe("hetja:medical:global");

    const after = await query<ProvenRecord>(
      `SELECT id FROM medical_records ORDER BY chain_seq ASC NULLS FIRST, created_at ASC, id ASC LIMIT $1`,
      [snapshot.length],
    );
    const prefixStable =
      after.rows.length === snapshot.length &&
      after.rows.every((r, i) => r.id === snapshot[i].id);
    if (!prefixStable) return; // a parallel suite appended into the prefix

    expect(global.anchored).toBe(true);
    expect(global.rootMatchesPublished).toBe(true);
    expect(verifyInclusion(res.json().data.record, global.proof, global.publishedRoot)).toBe(true);
  });

  it("says a record is not yet anchored instead of reporting a mismatch", async () => {
    // A record appended after the last anchor genuinely is not in that tree.
    // Reporting "root does not match" there would be a false tamper alarm on
    // completely healthy data, which is the failure mode that makes people stop
    // reading alerts.
    await query("DELETE FROM ledger_anchors WHERE published_url = 'test-anchor'");
    const first = await query<ProvenRecord>(
      `SELECT id, hash_curr AS hash FROM medical_records ORDER BY chain_seq ASC NULLS FIRST, created_at ASC, id ASC LIMIT 1`,
    );
    await query(
      `INSERT INTO ledger_anchors (head_hash, merkle_root, record_count, ledger_id, published_url)
       VALUES ($1, $2, 1, 'hetja:medical:global', 'test-anchor')`,
      [first.rows[0].hash, merkleRoot(asLeaves(first.rows))],
    );

    const res = await app.inject({
      method: "GET",
      url: `/api/v1/ledger/proof?hash=${appended[2].hashCurr}`,
    });
    const global = res.json().data.global;
    if (first.rows[0].id === appended[2].id) return; // impossible here, but explicit
    expect(global.anchored).toBe(false);
    expect(global.proof).toBeNull();
    expect(global.rootMatchesPublished).toBeNull();
    expect(global.note).toMatch(/appended afterwards/);
  });

  it("ignores anchors that predate the Merkle root column", async () => {
    // Anchors written before 0014 have merkle_root NULL, and their record_count
    // came from a query that could not run at all (see the anchor_ledger
    // handler in apps/worker/src/index.ts) — building a global proof around one
    // would be building it around a number nobody computed.
    await query("DELETE FROM ledger_anchors WHERE published_url = 'test-anchor'");
    await query(
      `INSERT INTO ledger_anchors (head_hash, record_count, published_url)
       VALUES ($1, 99999, 'test-anchor')`,
      ["b".repeat(64)],
    );
    const res = await app.inject({
      method: "GET",
      url: `/api/v1/ledger/proof?hash=${appended[0].hashCurr}`,
    });
    expect(res.statusCode).toBe(200);
    // Either null (no anchor anywhere in this database carries a merkle_root)
    // or an anchor that does — never the NULL-rooted one just inserted.
    const global = res.json().data.global;
    expect(global === null || global.publishedRoot !== null).toBe(true);
  });
});
