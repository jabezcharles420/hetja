# AGENTS.md

Instructions for a coding agent (or a human) working on Hetja, or bringing the
stack up on a fresh box. Every step that can be verified has a command and an
expected result next to it — if a check fails, stop and fix it before moving on.

**Read [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md) first.** It explains what
the system does and why it is shaped this way. This file is the operational
half. [`docs/INVARIANTS.md`](docs/INVARIANTS.md) lists the fifteen rules the
code is not allowed to break, several of which CI enforces.

## a. If you are just developing, you do not need a server

Most work needs only a clone, `pnpm install`, and the gates. Deployment happens
by pushing to `main` — see §g. Skip to §f and §g unless you are provisioning a
new box.

```bash
pnpm install --frozen-lockfile
pnpm --filter @hetja/ledger build     # libraries first: consumers resolve them
pnpm --filter @hetja/contracts build  # through dist/, which is gitignored
pnpm --filter @hetja/db build
pnpm -r typecheck
./ops/security-gate.sh
./ops/check-queries.sh
pnpm --filter @hetja/scan size:gate
```

The test suite additionally needs a database — see §f.

## b. What this is

Four services, all bound to loopback:

| Service | App | Port | Notes |
|---|---|---|---|
| Web | `apps/web` (Next.js) | 3100 | Feeder PWA. Fronted by Caddy. |
| API | `apps/api` (Fastify) | 8080 | `/api/v1/*`. Fronted by Caddy. |
| Scan | `apps/scan` (static) | 8081 | QR-collar landing, served at `/d/*`. |
| Worker | `apps/worker` | — | Job queue (fan-out, escalation, retention). |

Caddy (`ops/caddy/Caddyfile`) is the only thing reachable from outside — see
`ops/caddy/HOSTING.md` for the Cloudflare Tunnel case, which is how production
runs (the box has no inbound ports open).

**The authoritative database is a LOCAL PostgreSQL on the box.** The live API
connects to `PGHOST=127.0.0.1`, `PGDATABASE=hetja`. There is also a hardened
Supabase project holding a mirror of the schema, but **it currently serves no
reads** — the plan is to repoint after the VPS itself moves to India. Migrations
are applied to both (§g).

> An earlier version of this file said the database was managed Supabase and
> that PostgreSQL "explicitly is not required — do not `apt install
> postgresql*`". That was wrong and is exactly the kind of confident-but-stale
> instruction that causes a "which database did that actually write to?" bug. If
> you are provisioning a box that runs the API, you need PostgreSQL locally.

## c. Prerequisites

- Ubuntu 24.04 (or close).
- **PostgreSQL 16 with PostGIS, pgvector and pgcrypto.** Required — the schema
  uses `GEOGRAPHY(Point,4326)`, `VECTOR(768)` and `gen_random_uuid()`.
- Node: CI runs **20**, `.nvmrc` says **22**, and 26 has been used locally
  without trouble. `engines` requires `>=20`. If you need one number, match CI.
- pnpm — `corepack enable`, or install the version in `packageManager`.
- Caddy, for reverse proxy in front of the four loopback services.

## d. Secrets

Copy `apps/api/.env.example` → `apps/api/.env.production` and the same for
`apps/web`, then fill every value. **These files are gitignored and are not in
the repo** — cloning gets you no secrets.

| Variable | File | Where it comes from |
|---|---|---|
| `NODE_ENV` / `PORT` / `HOST` | api | `production` / `8080` / `127.0.0.1`. |
| `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` | api | The **local** cluster: `127.0.0.1`, `5432`, `hetja`, `app_user`, and the password you set for it. |
| `PGSSLMODE` | api | Omit for a local socket/loopback cluster. Set `require` only when pointing at Supabase. |
| `JWT_SECRET` | api | **Generate**: `openssl rand -hex 32`. |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | api | e.g. `15m` / `30d`. |
| `HETJA_HMAC_PEPPER` | api | **Generate**: `openssl rand -hex 32`. Peppers `identity_hmac` (INVARIANT 3). |
| `HETJA_QR_SECRET` | api | **CARRY OVER — see the warning below.** |
| `HETJA_DEVICE_SECRET` | api | **Generate**: `openssl rand -hex 32`. |
| `DEVICE_POW_DIFFICULTY` | api | Default `16` (ALTCHA v2 PoW), max `20`. Lowered from 18 on 2026-08-14 — ALTCHA encodes difficulty as a hex prefix, so 18 rounded **up** to 20 effective bits, which the scan-app solver could not finish inside its own 20 s budget (measured 4/10 solves; 16 gives 25/25 at ~1 s). What actually bounds abuse is INVARIANT 7's 2/day + 5/week cap, not the PoW: a native solver does 2^20 in ~1.5 s. See `docs/HOW-IT-WORKS.md` §9. |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | api | **Generate once**: `npx web-push generate-vapid-keys`. Subject is a `mailto:`. Rotating these invalidates every existing push subscription. |
| `BREVO_SMTP_HOST` / `_PORT` / `_USER` / `_PASS` | api | Brevo → SMTP & API. **The API refuses to boot in production without these** — deliberately, because the original bug was generating login codes and silently sending them nowhere. |
| `MAIL_FROM` | api | `no-reply@hetja.in`. Must be on a domain with SPF/DKIM/DMARC or mail lands in spam. |
| `HETJA_LEDGER_SIGNING_JWK` / `_KID` / `HETJA_LEDGER_SIGNER_ID` | api file, read by **worker** | Optional. Signs the daily ledger anchor (INVARIANT 10). Private Ed25519 JWK as one-line JSON; generate with `generateLedgerKeyPair()` and **publish the public half at a JWKS path**, or a signature verifies against nothing. Unset ⇒ anchors publish unsigned, which is degraded but honest. They live in the api env file because `hetja-worker.service` loads it as its `EnvironmentFile`. Never put this in a restic repo a third party stores. |
| `TRUST_PROXY` | api | Hop count to the real client through Caddy, **usually `1`**. Defaults to `0`, and at `0` Fastify ignores `X-Forwarded-For` entirely — so `request.ip` stays loopback and the Caddy `CF-Connecting-IP` rewrite is inert. Unlike the five secrets above there is no `requireInProd` guard for it, so a missing value fails silently. |
| `CORS_ORIGINS` | api | Production origins, comma-separated. |
| `STORAGE_BACKEND` + `STORAGE_LOCAL_DIR` or `S3_*` | api | `local` or `s3`. |
| `NEXT_PUBLIC_API_URL` | web | Public API origin. |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web | Supabase → Project Settings → API. Safe in the browser; every table it can reach is behind RLS. |

**`HETJA_QR_SECRET` must be carried over from the previous deployment.** This is
not a normal rotation. It is the HMAC key baked into every QR code already
printed and glued to a physical collar. Generating a fresh value will not error,
will not fail loudly, and will not show up in any test — it will simply make
every collar printed before that moment fail signature verification the next
time a stranger scans one, standing over a dog. Copy the exact value from the
previous box's `.env.production`.

## e. Bootstrap a new box

Run `ops/bootstrap.sh` from a clean checkout. Safe to re-run. It installs
dependencies, builds in dependency order (`ledger → contracts → db → api →
worker → scan → web`), renders the four systemd units from `ops/systemd/*.service`
with the real repo path and node binary, enables them, and runs the verify
ladder in §f.

Two things bootstrap does **not** do, which a new box needs:

1. **Create the database and roles.** Tables must be owned by `postgres` and
   `app_user` granted access — never the reverse. See the ownership note in §h.
2. **The `rootasdba` ident map**, without which the deploy pipeline cannot apply
   production migrations. See `ops/RUNBOOK.md`; `ops/deploy-remote.sh` fails with
   the exact instructions if it is missing.

## f. Verify

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/                          # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/                          # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/healthz                   # 200
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8080/api/v1/heatmap?ward=A"   # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/d/<slug>                  # 200, text/html
systemctl is-active hetja-api hetja-web hetja-worker hetja-scan                          # active x4
```

`<slug>` is a real 9-character collar slug. `pnpm --filter @hetja/db seed` makes
five if you have none.

**Running the test suite** needs a disposable database whose name ends `_test` —
the suite refuses anything else: it inserts real rows, and `medical_records` is
append-only, so test rows can never be removed. Bootstrap it exactly like CI
(`.github/workflows/ci.yml`), with every command as the `postgres` superuser
(root on this box maps to it via the `rootasdba` ident map):

```bash
# one-time, per cluster: the application login role. Must exist before
# migrations — 0001_init.sql ends with `REVOKE ... FROM app_user`, which errors
# if the role does not.
psql -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN CREATE ROLE app_user LOGIN PASSWORD 'dev-pw'; END IF; END \$\$;"
psql -v ON_ERROR_STOP=1 -c "GRANT USAGE ON SCHEMA public TO app_user;"

# per fresh database
createdb hetja_test
psql -d hetja_test -c "CREATE EXTENSION postgis; CREATE EXTENSION vector; CREATE EXTENSION pgcrypto;"

# migrations MUST run as postgres, never as app_user — see the ownership note in §h
PGHOST=/var/run/postgresql PGUSER=postgres pnpm --filter @hetja/db migrate

# post-migration grants = production's privilege set, applied after the tables exist
psql -v ON_ERROR_STOP=1 -c "GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user;"
psql -v ON_ERROR_STOP=1 -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;"
# INVARIANT 9: re-applied after the blanket GRANT, which would hand DELETE back
psql -v ON_ERROR_STOP=1 -c "REVOKE UPDATE, DELETE ON medical_records FROM app_user;"
# ...and TRUNCATE too. `GRANT ALL` grants it and no REVOKE above takes it away:
# followed as originally written (without this line), the recipe leaves app_user
# holding INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE on medical_records — verified
# live. The statement-level BEFORE TRUNCATE trigger from 0012 still blocks an
# actual TRUNCATE by any role, so omitting this is weakened defence-in-depth
# rather than an open hole; but production revokes it (0012), and the point of
# this recipe is to reproduce production's privilege set exactly.
psql -v ON_ERROR_STOP=1 -c "REVOKE TRUNCATE ON medical_records FROM app_user;"
```

Then run the suite as `app_user` — always with `PGDATABASE` set; unset it
defaults to `hetja` (the live database) and the suite refuses to start:

```bash
PGHOST=127.0.0.1 PGDATABASE=hetja_test PGUSER=app_user PGPASSWORD=<pw> \
  pnpm --filter @hetja/api test
```

The ownership detail is load-bearing, not cosmetic: the referential-integrity
check behind `DELETE FROM dogs` runs as the *referencing* table's owner, so
`medical_records` must be owned by `postgres` with `app_user` holding grants.
If `app_user` owns it, `0001_init.sql`'s REVOKE strips the owner's own rights
and every dog-delete fails with `permission denied for table medical_records` —
the bug behind 48 CI failures, documented in migration 0012's header comment.
A stock Homebrew PostgreSQL has only pgcrypto; the Docker recipe matching CI is
in [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md) §8.

## g. How code reaches production

**Push to `main`.** Do not build or deploy by hand; do not `git pull` on the box.

```
push -> Gate (typecheck, tests, security-gate, check-queries, 40 KB size gate)
     -> Migrate (destructive-change gate, then apply to Supabase)
     -> Deploy  (build web+scan on the runner, rsync a release,
                 build api+worker ON THE BOX from this SHA,
                 apply migrations to the PRODUCTION database,
                 flip the `current` symlink, restart, health-check,
                 assert the checkout HEAD == deployed SHA)
```

Things worth knowing before you change any of it:

- **web and scan** are built on the runner and shipped as a release under
  `/srv/hetja/releases/<ts>-<sha>/`, with `current` symlinked. `next build`
  needs ~1 GB and previously OOM-killed the live services on this 2 GB box.
- **api and worker** run from the git checkout at `/root/hetja` and are built
  there. Both halves must ship, or a deploy goes green with a stale API.
- **Migrations reach two databases**: Supabase (from the runner) and the local
  production cluster (from `deploy-remote.sh`). Missing the second means the
  schema the app actually queries never changes.
- **Rollback covers code, not schema.** An applied migration stays applied even
  when a release is reverted. This is only safe because the destructive gate
  keeps unattended migrations additive.
- **The destructive-change gate** fails the build on `DROP TABLE`, `TRUNCATE`,
  `DELETE FROM` and similar unless the file carries
  `-- MIGRATION-APPROVED: <reason>`. Additive changes flow untouched. Do not add
  that marker to silence the gate — it exists for changes that need a human and
  a checked backup.

Secrets the pipeline needs live in GitHub Actions secrets: `DEPLOY_SSH_KEY`,
`DEPLOY_SSH_HOST`, `DEPLOY_SSH_PORT`, `DEPLOY_SSH_USER`, `SUPABASE_POOLER_HOST`,
`SUPABASE_POOLER_PORT`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`.

**Pushing from a new machine** needs its own credential — a deploy key with write
access on the repo, or an account SSH key. Do not copy the box's key to a laptop:
that key can deploy to production, and sharing it means revoking either revokes
both and you cannot tell which machine pushed.

## h. Gotchas

- **`NEXT_PUBLIC_*` is inlined at build time, not read at runtime.** Editing
  `apps/web/.env.production` and restarting `hetja-web` does nothing. Next.js
  baked the old values into the bundle. Rebuild, then restart.
- **Apply migrations as a superuser, so `postgres` owns the tables.** In
  PostgreSQL the creating role owns what it creates, and an owner holds full
  rights on its table regardless of GRANTs. If `app_user` owns
  `medical_records`, `0001_init.sql`'s `REVOKE UPDATE, DELETE` strips the
  owner's own rights, and the referential-integrity trigger behind
  `DELETE FROM dogs` then fails as that owner — because such a trigger runs as
  the *referencing* table's owner. That produced 48 test failures and cost a
  day. Migrations 0008–0011 drifted two real tables into `app_user` ownership
  before this was understood; `0012` reassigns them.
- **The API test suite refuses to run unless `PGDATABASE` ends in `_test`.** A
  deliberate guard. Do not work around it.
- **The scan bundle has a hard 40 KB gzipped budget** enforced in CI. It is the
  page a stranger loads on a street; every kilobyte is a second.
- **Do not reintroduce the old working title.** The project is Hetja. The name
  was removed from 967 files; only git history still carries it, pending a
  rewrite that will invalidate every SHA.
- **No public IP / behind NAT?** `ops/caddy/HOSTING.md` documents Caddy behind a
  Cloudflare Tunnel so the box needs no inbound 80/443. Caddy runs with
  `auto_https off` in that configuration — Cloudflare terminates TLS.
- **Some `ops/*.sh` were committed non-executable** and CI invoked them as
  `bash ops/…`, which hid it. If `./ops/foo.sh` gives "permission denied",
  `git update-index --chmod=+x` it rather than working around it.
