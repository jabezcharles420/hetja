/**
 * StrayNet DB pool — single pg Pool shared by the API and workers.
 * Connection settings come from the environment (see .env.example).
 */
import pg from "pg";

const { Pool } = pg;

/**
 * TLS. Supabase (and any managed Postgres) refuses unencrypted connections,
 * while the local VPS cluster has no server certificate at all. Honour the
 * standard PGSSLMODE so one build works against both: unset/`disable` keeps the
 * plaintext loopback connection, `require` verifies against the system CA store.
 */
const ssl =
  process.env.PGSSLMODE === "require" || process.env.PGSSLMODE === "verify-full"
    ? { rejectUnauthorized: true }
    : process.env.PGSSLMODE === "no-verify"
      ? { rejectUnauthorized: false }
      : undefined;

export const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  database: process.env.PGDATABASE ?? "straynet",
  user: process.env.PGUSER ?? "app_user",
  password: process.env.PGPASSWORD ?? "straynet_dev_2026",
  max: Number(process.env.PGPOOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ...(ssl ? { ssl } : {}),
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

/** Runs fn inside a transaction; rolls back on any error. */
export async function withTx<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
