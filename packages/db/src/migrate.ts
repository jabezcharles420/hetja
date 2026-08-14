/**
 * Hetja migration runner — applies packages/db/migrations/*.sql in filename
 * order, records each in schema_migrations, and stops on any error
 * (ON_ERROR_STOP semantics). Safe to re-run: applied migrations are skipped.
 *
 * Note on ordering: files are sorted and tracked by FULL FILENAME, not by the
 * numeric prefix. `0013_phone_e164.sql` and `0013_web_vitals.sql` both exist and
 * both apply, in that (alphabetical) order. Do not rely on this — pick the next
 * free number instead of a third 0013.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { pool, withTx } from "./pool.js";

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

/**
 * Forwards PostgreSQL server messages (RAISE NOTICE / WARNING / INFO) from one
 * migration's connection to stdout, and returns the detach function.
 *
 * This is not a nicety. node-postgres emits server notices as a `notice` event
 * on the client and drops them on the floor when nothing is listening, so
 * before this every `RAISE` inside a migration was invisible: the migration
 * printed "applied: 0013_phone_e164.sql" and said nothing about the branch it
 * actually took. `0013_phone_e164.sql` added its CHECK constraint only when no
 * row violated it and skipped it silently otherwise — which is precisely what
 * happened on the production cluster, where a landline was unparseable. Nothing
 * in the deploy log distinguished "constraint applied" from "constraint
 * skipped", so a permanently-missing invariant looked like a clean deploy for
 * as long as nobody thought to query pg_constraint by hand. See
 * 0015_care_phone_e164_retry.sql, which reports its outcome through exactly
 * this channel.
 *
 * Detaching matters: these are POOLED connections, so a listener left attached
 * would keep firing (and leak) on every later borrower of the same socket.
 */
function forwardServerMessages(client: PoolClient, file: string): () => void {
  const onNotice = (notice: { severity?: string; message?: string }): void => {
    console.log(`  [${file}] ${notice.severity ?? "NOTICE"}: ${notice.message ?? ""}`);
  };
  client.on("notice", onNotice);
  return () => {
    client.removeListener("notice", onNotice);
  };
}

export async function migrate(): Promise<string[]> {
  await ensureTable();
  const applied = new Set(
    (await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations"))
      .rows.map((r) => r.filename),
  );
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    await withTx(async (client) => {
      const detach = forwardServerMessages(client, file);
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      } finally {
        detach();
      }
    });
    ran.push(file);
  }
  return ran;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  migrate()
    .then((ran) => {
      console.log(
        ran.length ? `applied: ${ran.join(", ")}` : "nothing to apply (schema current)",
      );
      return pool.end();
    })
    .catch((err) => {
      console.error("migration failed:", err);
      process.exit(1);
    });
}
