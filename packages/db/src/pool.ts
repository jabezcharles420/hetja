/**
 * StrayNet DB pool — single pg Pool shared by the API and workers.
 * Connection settings come from the environment (see .env.example).
 */
import pg from "pg";

const { Pool } = pg;

const isProduction = process.env.NODE_ENV === "production";

/**
 * Returns the env var if it is set. In production, a missing value throws
 * instead of silently falling back to the development default: once the
 * database is a remote, credentialed Supabase project, booting against a
 * guessable placeholder credential (the same one committed in several files
 * in this repo for local dev) is a security bug, not a convenience.
 */
function requiredInProd(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== "") return value;
  if (isProduction) {
    throw new Error(
      `${name} is not set. Refusing to start in production with the ` +
        `development default for ${name} -- set it in the environment ` +
        `(see apps/api/.env.example and AGENTS.md section (c)).`,
    );
  }
  return devDefault;
}

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
  database: requiredInProd("PGDATABASE", "straynet"),
  user: requiredInProd("PGUSER", "app_user"),
  password: requiredInProd("PGPASSWORD", "straynet_dev_2026"),
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
