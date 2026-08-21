/**
 * withTx error-path contract.
 *
 * Two defects this pins down, both in the catch block:
 *
 *   1. An UNGUARDED rollback. When the connection dies mid-transaction
 *      (reset by a deploy restart, terminated by an admin), ROLLBACK itself
 *      throws, and letting that error replace the one fn threw erased the
 *      actual diagnosis — every downstream caller saw "Connection terminated"
 *      no matter what originally went wrong.
 *
 *   2. A poisoned pool. `client.release()` with no argument hands the
 *      connection back as if healthy; if the ROLLBACK never landed, the next
 *      borrower inherits an open aborted transaction and sees "current
 *      transaction is aborted" on their first query. Passing the rollback
 *      failure to release() makes node-postgres destroy the connection
 *      instead of reusing it.
 *
 * Guard at the top mirrors apps/api/vitest.setup.ts: these probes INSERT real
 * rows, so they must never point at a live database.
 */
const db = process.env.PGDATABASE ?? "hetja";
const allowed = /(^|_)test$|^test_/.test(db);
if (!allowed && process.env.ALLOW_TESTS_ON_REAL_DB !== "1") {
  throw new Error(
    `Refusing to run tests against PGDATABASE="${db}". This suite writes rows; use a disposable database whose name ends in "_test".`,
  );
}

import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool, query, withTx } from "./pool.js";

/** Loose structural view of the client so the sabotage below can rewire two methods. */
interface LooseClient {
  query: (text: string, ...rest: unknown[]) => Promise<unknown>;
  release: (err?: Error) => void;
}

describe("withTx", () => {
  it("commits when fn succeeds and rolls back when fn throws", async () => {
    const committed = JSON.stringify({ probe: `withtx-commit-${randomUUID()}` });
    await withTx(async (client) => {
      await client.query(`INSERT INTO jobs (kind, payload) VALUES ('test_probe', $1)`, [committed]);
    });
    const rows = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM jobs WHERE payload = $1`,
      [committed],
    );
    expect(rows.rows[0].n).toBe(1);

    const rolledBack = JSON.stringify({ probe: `withtx-rollback-${randomUUID()}` });
    await expect(
      withTx(async (client) => {
        await client.query(`INSERT INTO jobs (kind, payload) VALUES ('test_probe', $1)`, [rolledBack]);
        throw new Error("fn failed after the insert");
      }),
    ).rejects.toThrow("fn failed after the insert");
    const gone = await query<{ n: number }>(
      `SELECT count(*)::int AS n FROM jobs WHERE payload = $1`,
      [rolledBack],
    );
    expect(gone.rows[0].n).toBe(0);

    await query(`DELETE FROM jobs WHERE payload = ANY($1)`, [[committed, rolledBack]]);
  });

  it("keeps the original error when ROLLBACK itself fails, and discards the connection", async () => {
    let releasedWith: Error | undefined;

    const caught: Error | null = await withTx(async (client) => {
      const loose = client as unknown as LooseClient;
      const realQuery = loose.query.bind(client);
      const realRelease = loose.release.bind(client);
      // Sabotage ONLY the ROLLBACK: fn is about to throw its own error, and
      // the cleanup must not bury it. This is exactly what a dead connection
      // produces, minus the dead connection.
      loose.query = (text, ...rest) =>
        text === "ROLLBACK"
          ? Promise.reject(new Error("server closed the connection unexpectedly"))
          : realQuery(text, ...rest);
      loose.release = (err?: Error) => {
        releasedWith = err;
        realRelease(err);
      };

      throw new Error("ORIGINAL-DEFECT");
    }).then(
      () => null,
      (e: Error) => e,
    );

    // Point 1: the original diagnosis wins, not the rollback's error.
    expect(caught).not.toBeNull();
    expect(caught!.message).toBe("ORIGINAL-DEFECT");

    // Point 2: the rollback failure reached release(err), so node-postgres
    // destroys this connection instead of lending it out with an open,
    // aborted transaction attached.
    expect(releasedWith).toBeInstanceOf(Error);
    expect(releasedWith!.message).toMatch(/closed the connection/);

    // And the pool itself still serves fresh, healthy connections.
    const ok = await query<{ n: number }>(`SELECT 1 AS n`);
    expect(ok.rows[0].n).toBe(1);
  });

  it("releases the connection cleanly on the success path", async () => {
    // Nothing to assert beyond "this resolves": a double-release or a leaked
    // client would hang the pool under load, and the suite above/below would
    // starve visibly rather than pass quietly.
    const result = await withTx(async (client) => {
      const res = await client.query<{ n: number }>(`SELECT 41 + 1 AS n`);
      return res.rows[0].n;
    });
    expect(result).toBe(42);
  });

  it("leaves the pool exhausted-free after repeated failures", async () => {
    for (let i = 0; i < Number(process.env.PGPOOL_MAX ?? 10) + 3; i++) {
      await withTx(async () => {
        throw new Error(`iteration ${i}`);
      }).catch(() => undefined);
    }
    const res = await query<{ n: number }>(`SELECT 1 AS n`);
    expect(res.rows[0].n).toBe(1);
  });
});
