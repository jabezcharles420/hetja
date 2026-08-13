# Supabase — Hetja's database

Managed Postgres is the authoritative database. There is no local Postgres to
install; `AGENTS.md` covers the rest of the bootstrap.

## Region matters more than you'd expect

A project's region is **fixed at creation**. The pilot project was created in
`ap-southeast-1` (Singapore) while the app server sat in Europe and the users are
in Mumbai. Measured from the app server:

| | Warm query |
|---|---|
| Local Postgres, loopback | 0.12 ms |
| Supabase pooler, Singapore | **154 ms** |

The gateway SLO is p95 **< 150 ms** and the dog-profile path issues four queries,
so a single one already broke the budget. Hetja's database therefore lives in
**`ap-south-1` (Mumbai)**, and the app server should be in India too.

Because the region cannot be changed, moving means creating a new project and
migrating into it. That is what `cutover.sh` is for.

## Standing up a project

```sh
PROJECT_REF=<ref from the dashboard URL> \
DB_PASSWORD='<Settings → Database → password>' \
  ./ops/supabase/cutover.sh
```

It is idempotent, and it does not touch the running API until you pass
`--repoint`. Run it once, read the verification output, then re-run with
`--repoint` to switch the API over and restart it (it backs up
`.env.production` first, so rollback is restoring the `.bak` and restarting).

Steps, in order:

| File | What it does |
|---|---|
| `01_schema.sql` | 17 tables, 9 enums, 14 indexes. Generated from the migrated pilot database and requalified for Supabase. |
| `04_seed_real.sql` | The genuine Phase-0 data: 5 dogs, their 5 collars, the lead feeder, the migration ledger. |
| `03_hardening.sql` | RLS on every table, the append-only trigger, the signature-gated read RPCs. |
| *(inline)* | Seeds `private.app_secrets.qr_secret`, then `seed:care` for the provider directory. |

### Two things that will silently ruin the migration

**`HETJA_QR_SECRET` must be carried over, never regenerated.** It is the key
that signs collar QR signatures. A fresh value does not error — it just makes
every printed tag fail verification, discovered only when a stranger scans a real
collar. `cutover.sh` reads it from `apps/api/.env.production` and refuses to
proceed if it is missing.

**Do not run `pnpm db:seed` against a new project instead of `04_seed_real.sql`.**
`seed.ts` calls `generateSlug()`, which mints *new* random slugs. The five
existing slugs (`c3di5esh8`, `md5wicnma`, `jo23vpmg5`, `5hreaphdq`, `jtkkaece2`)
are laser-etched on physical objects and are carried across verbatim.

### What is deliberately left behind

The pilot database is roughly 85% test residue, because the API suite writes to
whatever `PGHOST` points at and its cleanup cannot succeed (`medical_records` is
append-only by design, so test medical rows are permanent). Of 88 dogs, 78 were
`GeoTest`/`SosTest`; all 18 vets were "Test Clinic"; all 79 medical records were
test-generated. None of that is migrated.

If you find an `02_data.sql` lying around, it is a snapshot of that residue from
the first Singapore migration. Do not apply it — it sorts between `01` and `03`
and will quietly reintroduce 78 test dogs. It is gitignored and should be deleted.

## Connecting

Use the **pooler**, not `db.<ref>.supabase.co`: the direct host is IPv6-only and
will fail on an IPv4-only machine. `cutover.sh` discovers the working pooler by
trying `aws-{0,1}-ap-south-1`; the wrong region answers
`ENOTFOUND tenant/user`, which is how the pilot project's true region was found.

```
PGHOST=aws-0-ap-south-1.pooler.supabase.com
PGPORT=6543                  # transaction mode suits a pg Pool
PGUSER=postgres.<PROJECT_REF>
PGDATABASE=postgres
PGSSLMODE=require            # honoured by packages/db/src/pool.ts
```

Port **5432** (session mode) is required for `DO $$ … $$` blocks and
`SET search_path`, so `cutover.sh` prefers whichever port answers.

## Schema differences from a raw `pg_dump`

Five things break a naive restore; `ops/supabase/*.sql` already accounts for all
of them. Re-check these if you regenerate `01_schema.sql`:

1. **Extension schema.** `postgis` and `vector` are in `public` on a
   self-hosted cluster, so `pg_dump` emits `public.geography(Point,4326)` and
   `public.vector(768)`. Supabase keeps extensions in `extensions`.
2. **Empty `search_path`.** `pg_dump` sets it to `''`, which stops
   `CREATE INDEX … USING gist (geo)` resolving the PostGIS operator class and
   breaks both spatial indexes.
3. **`CREATE SCHEMA public`** already exists.
4. **Encoding.** The pilot cluster is `SQL_ASCII`; Supabase is `UTF8`. The dump
   was verified pure ASCII — re-check after real Devanagari names are entered.
5. **Privileges.** `0001_init.sql` enforced INVARIANT 9 with
   `REVOKE UPDATE, DELETE ON medical_records FROM app_user`. `pg_dump
   --no-privileges` drops it and `app_user` does not exist on Supabase, so it is
   a `BEFORE UPDATE OR DELETE` trigger in `03_hardening.sql` instead — which
   binds every role, including `postgres`.

## The security model

The publishable key ships in the browser bundle, so it is public by definition.
Every table therefore has RLS with **no anon policy** (deny-all) plus an explicit
`REVOKE`, and reads happen through three `SECURITY DEFINER` RPCs that re-create
what the API enforced in code:

- verify the collar HMAC (the SQL twin of `verifySlugSig`), so random 9-character
  slugs cannot be enumerated — an invalid signature returns no rows rather than a
  404, so it does not even confirm a slug exists
- coarsen coordinates to 2 decimal places (~1.1 km), matching `coarsenToWard`
- return only verified medical records and moderated stories

`get_nearby_care` is the one RPC with no signature check: it returns published
clinic and NGO addresses, which are not subjects of the register.

Verify all of this holds:

```sh
ANON='<publishable key>'
# must be refused
curl -s "https://<ref>.supabase.co/rest/v1/feeders?select=phone_hmac" -H "apikey: $ANON"
# must return a profile
curl -s -X POST "https://<ref>.supabase.co/rest/v1/rpc/get_dog_profile" \
  -H "apikey: $ANON" -H 'content-type: application/json' \
  -d '{"p_slug":"c3di5esh8","p_sig":"<valid sig>"}'
```
