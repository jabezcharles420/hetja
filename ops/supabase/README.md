# Supabase migration — Hetja / StrayNet

Moves the VPS Postgres 16 database (PostGIS + pgvector) into the Supabase
project `klltnoufsfyyjvsuqkoi` and opens a signature-gated read path for the
Next.js app.

## Files

| File | What it does |
|---|---|
| `01_schema.sql` | Types, 16 tables, indexes, FKs. Generated from `pg_dump`, requalified for Supabase. |
| `02_data.sql` | `COPY` blocks for all 16 tables (`spatial_ref_sys` excluded — PostGIS owns it). |
| `03_hardening.sql` | RLS on every table, append-only trigger, HMAC verification, the three public RPCs. |

## What had to change from the raw dump

The VPS cluster and Supabase differ in five ways that all break a naive restore:

1. **Extension schema.** `postgis`, `vector` and `pgcrypto` are installed in
   `public` on the VPS, so `pg_dump` emitted `public.geography(Point,4326)` and
   `public.vector(768)`. Supabase keeps extensions in `extensions`. Both were
   requalified.
2. **Empty search_path.** `pg_dump` emits
   `set_config('search_path', '', false)`. With it empty, `CREATE INDEX ... USING
   gist (last_seen_geo)` cannot resolve the PostGIS operator class and the two
   spatial indexes fail. Set to `public, extensions`.
3. **`CREATE SCHEMA public`.** Already exists on Supabase; removed.
4. **Encoding.** The VPS cluster is `SQL_ASCII`, Supabase is `UTF8`. The dump was
   verified to be pure ASCII, so no transcoding was needed — but re-check this
   if you re-dump after real Marathi/Devanagari names are entered.
5. **Privileges.** `0001_init.sql` enforced INVARIANT 9 with
   `REVOKE UPDATE, DELETE ON medical_records FROM app_user`. `pg_dump
   --no-privileges` drops that, and `app_user` does not exist on Supabase. It is
   now a `BEFORE UPDATE OR DELETE` trigger, which binds every role.

## Applying it

Needs the database password (Supabase dashboard → Settings → Database), not the
publishable key — the anon key cannot run DDL.

```sh
export PGPASSWORD='<db password>'
PSQL="psql -h aws-1-ap-south-1.pooler.supabase.com -p 5432 \
  -U postgres.klltnoufsfyyjvsuqkoi -d postgres -v ON_ERROR_STOP=1"

$PSQL -f 01_schema.sql
$PSQL -f 02_data.sql
$PSQL -f 03_hardening.sql
```

Use port **5432** (session mode) for this, not 6543 — the transaction-mode
pooler does not keep the session state that `DO $$ ... $$` blocks and
`SET search_path` rely on.

Then seed the QR signing secret. It must match the API's `STRAYNET_QR_SECRET`
byte for byte or every signature check fails:

```sh
$PSQL -c "INSERT INTO private.app_secrets (name, value) VALUES ('qr_secret', '<STRAYNET_QR_SECRET>') \
          ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;"
```

## Verifying

```sh
# Row counts should match the VPS: dogs 63, feeders 30, medical_records 55,
# vets 13, collars 5, scans 2.
$PSQL -c "SELECT 'dogs' t, count(*) FROM dogs UNION ALL
          SELECT 'feeders', count(*) FROM feeders UNION ALL
          SELECT 'medical_records', count(*) FROM medical_records UNION ALL
          SELECT 'vets', count(*) FROM vets UNION ALL
          SELECT 'collars', count(*) FROM collars UNION ALL
          SELECT 'scans', count(*) FROM scans;"

# No public table may be left without RLS.
$PSQL -c "SELECT tablename FROM pg_tables t WHERE schemaname='public'
            AND tablename<>'spatial_ref_sys'
            AND NOT EXISTS (SELECT 1 FROM pg_class c
                            JOIN pg_namespace n ON n.oid=c.relnamespace
                            WHERE n.nspname='public' AND c.relname=t.tablename
                              AND c.relrowsecurity);"

# No anon privilege may remain on any table.
$PSQL -c "SELECT table_name, privilege_type FROM information_schema.role_table_grants
           WHERE grantee='anon' AND table_schema='public';"

# INVARIANT 9 — must raise an exception.
$PSQL -c "UPDATE medical_records SET diagnosis='x' WHERE true;"
```

Then confirm the anon key really is walled off. The first must return `[]`, the
second a profile:

```sh
ANON='<publishable key>'
curl -s "https://klltnoufsfyyjvsuqkoi.supabase.co/rest/v1/feeders?select=phone_hmac" \
  -H "apikey: $ANON"

curl -s -X POST "https://klltnoufsfyyjvsuqkoi.supabase.co/rest/v1/rpc/get_dog_profile" \
  -H "apikey: $ANON" -H "content-type: application/json" \
  -d '{"p_slug":"<slug>","p_sig":"<valid sig>"}'
```

## Pointing the API at Supabase

The Fastify API keeps working against Supabase — it is plain Postgres. Two
changes are needed:

1. `packages/db/src/pool.ts` needs TLS; Supabase rejects unencrypted
   connections. Add `ssl: { rejectUnauthorized: true }`.
2. `apps/api/.env.production`:

```
PGHOST=aws-1-ap-south-1.pooler.supabase.com
PGPORT=6543          # transaction mode is right for a pg Pool
PGDATABASE=postgres
PGUSER=postgres.klltnoufsfyyjvsuqkoi
PGPASSWORD=<db password>
```

Note the API's `pool.ts` still defaults `PGPASSWORD` to the committed dev
string `straynet_dev_2026`; that default is also the VPS production password
today. Rotate it as part of this cutover rather than carrying it across.

Also confirm the region: the direct host `db.klltnoufsfyyjvsuqkoi.supabase.co`
resolves **IPv6-only**, so use the pooler hostname above. The `ap-south-1`
pooler is assumed — verify the exact host in the dashboard before cutting over.
