/**
 * Hetja DB pool — single pg Pool shared by the API and workers.
 * Connection settings come from the environment (see .env.example).
 */
import { readFileSync } from "node:fs";
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
 * TLS, with libpq's PGSSLMODE semantics rather than an approximation of them.
 *
 * The previous mapping sent `require` to `rejectUnauthorized: true`, which is
 * wrong in a way that only shows up against a managed provider: in libpq,
 * `require` means "encrypt, do not verify the certificate", and `verify-ca` /
 * `verify-full` are the modes that verify. Conflating them made Node stricter
 * than psql, so `psql "...sslmode=require"` connected to Supabase happily while
 * the app failed with SELF_SIGNED_CERT_IN_CHAIN.
 *
 * That error is not a misconfiguration. Supabase's pooler presents a
 * certificate issued by "Supabase Intermediate 2021 CA" -- their own private CA,
 * which is deliberately absent from Node's bundled trust store. Verifying it
 * requires their CA certificate, downloadable from the dashboard under
 * Settings -> Database -> SSL configuration.
 *
 *   disable / unset  no TLS. The local cluster has no server certificate.
 *   require          encrypt, do not verify (libpq's meaning). Stops passive
 *                    eavesdropping; does NOT stop an active MITM.
 *   no-verify        alias of require.
 *   verify-ca        encrypt and verify the chain against PGSSLROOTCERT.
 *   verify-full      as verify-ca, and check the hostname too. Use this in
 *                    production, with PGSSLROOTCERT pointing at Supabase's CA.
 */
function readRootCert(): string | undefined {
  const path = process.env.PGSSLROOTCERT;
  if (!path) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(
      `PGSSLROOTCERT is set to ${path} but could not be read: ${(err as Error).message}. ` +
        "Download the CA from the Supabase dashboard (Settings -> Database -> SSL " +
        "configuration), or drop to PGSSLMODE=require to encrypt without verifying.",
    );
  }
}

function buildSsl(): pg.PoolConfig["ssl"] {
  const mode = process.env.PGSSLMODE;
  if (!mode || mode === "disable") return undefined;

  if (mode === "verify-ca" || mode === "verify-full") {
    const ca = readRootCert();
    if (!ca) {
      throw new Error(
        `PGSSLMODE=${mode} requires PGSSLROOTCERT to point at a CA certificate. ` +
          "Supabase's pooler is signed by their private CA, so the system trust " +
          "store cannot validate it and verification would always fail.",
      );
    }
    // checkServerIdentity is left at the default for verify-full (hostname is
    // checked); verify-ca skips the hostname check but still validates the chain.
    return mode === "verify-full"
      ? { rejectUnauthorized: true, ca }
      : { rejectUnauthorized: true, ca, checkServerIdentity: () => undefined };
  }

  // require / no-verify: encrypted, unverified. Matches libpq.
  return { rejectUnauthorized: false };
}

const ssl = buildSsl();

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
