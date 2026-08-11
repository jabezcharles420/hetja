/**
 * StrayNet migration runner — applies packages/db/migrations/*.sql in filename
 * order, records each in schema_migrations, and stops on any error
 * (ON_ERROR_STOP semantics). Safe to re-run: applied migrations are skipped.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
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
