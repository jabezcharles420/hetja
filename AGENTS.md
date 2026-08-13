# AGENTS.md

Instructions for a coding agent (or a human) bringing the Hetja
stack up on a fresh box. Follow the sections in order. Every step that can be
verified has a command and an expected result next to it — if a check fails,
stop and fix it before moving on.

## a. What this is

Four services, one Postgres-compatible database (managed, not local):

| Service | App | Port | Bind | Notes |
|---|---|---|---|---|
| Web | `apps/web` (Next.js) | 3100 | 127.0.0.1 | Feeder PWA. Fronted by Caddy. |
| API | `apps/api` (Fastify) | 8080 | 127.0.0.1 | `/api/v1/*`. Fronted by Caddy. |
| Scan | `apps/scan` (static) | 8081 | 127.0.0.1 | QR-collar landing, served at `/d/*`. Fronted by Caddy. |
| Worker | `apps/worker` | — | n/a | Job queue (fan-out, escalation, retention). No listening port. |

All four bind to loopback only. Caddy (`ops/caddy/Caddyfile`) is the only
thing that should ever be reachable from outside the box — see
`ops/caddy/HOSTING.md` if the box has no public IP (Cloudflare Tunnel case).

## b. Prerequisites

- Ubuntu 24.04 (or close to it).
- Node **20+** (repo pins the exact version in `.nvmrc`).
- pnpm (`corepack enable` or install matching `packageManager` in
  `package.json`).
- Caddy (for TLS + reverse proxy in front of the four loopback services).

**Explicitly not required: PostgreSQL, PostGIS, or pgvector.** The database
is managed Supabase (Postgres + PostGIS + pgvector already enabled on the
project). Do not `apt install postgresql*` on this box — there is nothing
for it to do, and a local install that happens to be reachable on 5432 is a
guaranteed source of "which database did that actually write to" bugs later.
`packages/db/src/pool.ts` connects to whatever `PGHOST`/`PGPORT`/etc. say, so
in practice that's the Supabase pooler host over `PGSSLMODE=require`.

## c. Secrets

Copy `apps/api/.env.example` → `apps/api/.env.production` and
`apps/web/.env.example` → `apps/web/.env.production`, then fill every value.

| Variable | File | Where it comes from |
|---|---|---|
| `NODE_ENV` | api | Literal `production`. |
| `PORT` | api | `8080` (matches the systemd unit and Caddyfile). |
| `HOST` | api | `127.0.0.1`. |
| `PGHOST` | api | Supabase dashboard → Project Settings → Database → Connection pooling host. |
| `PGPORT` | api | Supabase dashboard (pooler port, usually `5432` or `6543`). |
| `PGDATABASE` | api | Supabase dashboard, normally `postgres`. |
| `PGUSER` | api | Supabase dashboard (pooler user, e.g. `postgres.<project-ref>`). |
| `PGPASSWORD` | api | Supabase dashboard → Database password. |
| `PGSSLMODE` | api | Set to `require` for Supabase (see `packages/db/src/pool.ts`). |
| `JWT_SECRET` | api | **Generate**: `openssl rand -hex 32`. |
| `JWT_ACCESS_TTL` | api | Literal, e.g. `15m`. |
| `JWT_REFRESH_TTL` | api | Literal, e.g. `30d`. |
| `HETJA_HMAC_PEPPER` | api | **Generate**: `openssl rand -hex 32`. |
| `HETJA_QR_SECRET` | api | **CARRY OVER — see warning below.** |
| `HETJA_DEVICE_SECRET` | api | **Generate**: `openssl rand -hex 32`. |
| `DEVICE_POW_DIFFICULTY` | api | Literal, e.g. `14`. |
| `TRUST_PROXY` | api | Literal — hop count to the real client through Caddy, usually `1`. |
| `CORS_ORIGINS` | api | Literal — the production origins, comma-separated. |
| `STORAGE_BACKEND` | api | Literal — `local` or `s3`. |
| `STORAGE_LOCAL_DIR` | api | Literal, only used when `STORAGE_BACKEND=local`. |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | api | Object storage provider dashboard (e.g. Cloudflare R2), only when `STORAGE_BACKEND=s3`. |
| `NEXT_PUBLIC_API_URL` | web | Literal — the public API origin. |
| `NEXT_PUBLIC_SUPABASE_URL` | web | Supabase dashboard → Project Settings → API → Project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web | Supabase dashboard → Project Settings → API → `anon`/publishable key. Safe to ship to the browser; every table it can reach must be behind RLS. |

**HETJA_QR_SECRET must be carried over from the previous deployment.**
This is not a normal secret rotation. It is the HMAC key baked into every
QR code already printed and glued to a physical collar
(`packages/db/src/seed.ts` signs each collar's slug with it, and the API
verifies scans against it). Generating a fresh value the way you would for
`JWT_SECRET` or `HETJA_HMAC_PEPPER` will not error, will not fail loudly,
and will not show up in any test — it will simply make every collar printed
before that moment fail signature verification the next time someone scans
one. Copy the exact value from the previous box's `.env.production` (or from
wherever it was backed up) before doing anything else with this variable.

## d. Bootstrap

Run `ops/bootstrap.sh` from a clean checkout. It performs the following, in
order, and is safe to re-run:

1. `git clone <repo>` (not part of the script — do this first).
2. Fill in `apps/api/.env.production` and `apps/web/.env.production` per the
   table above (not part of the script — bootstrap will refuse to continue
   without them).
3. `pnpm install --frozen-lockfile`.
4. Build in dependency order: `@hetja/ledger` → `@hetja/contracts` →
   `@hetja/db` → `@hetja/api` → `@hetja/worker` → `@hetja/scan`
   → `@hetja/web`.
5. Render the four systemd units from `ops/systemd/*.service`, substituting
   the real repo path and `node` binary, install them to
   `/etc/systemd/system/`, `systemctl daemon-reload`, and
   `systemctl enable --now` all four.
6. Confirm/enable Caddy (`systemctl enable --now caddy`) once
   `ops/caddy/Caddyfile` (or `ops/caddy/setup-tunnel.sh`, see gotchas) is in
   place.
7. Run the verification curl ladder below and exit non-zero on any failure.

## e. Verify

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3100/                          # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/                          # 200 (scan landing)
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/healthz                   # 200
curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:8080/api/v1/heatmap?ward=A"   # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/d/<slug>                  # 200, text/html
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/d/main.js                 # 200, text/javascript
systemctl is-active hetja-api hetja-web hetja-worker hetja-scan              # active x4
```

Replace `<slug>` with a real 9-character collar slug from the database. If
you need one and don't have a printed collar handy, `pnpm --filter
@hetja/db seed` creates five.

## f. Gotchas

- **`NEXT_PUBLIC_*` is inlined at build time, not read at runtime.** Editing
  `apps/web/.env.production` and running `systemctl restart hetja-web`
  does nothing — Next.js already baked the old values into the JS bundle at
  `pnpm --filter @hetja/web build` time. You must rebuild
  (`pnpm --filter @hetja/web build`) and then restart.
- **The API test suite refuses to run unless `PGDATABASE` ends in `_test`.**
  This is a deliberate guard against a stray `pnpm -r test` truncating a real
  database. Point `PGDATABASE` at something like `hetja_test` before
  running tests; the suite will refuse to start otherwise.
- **No public IP / behind NAT?** See `ops/caddy/HOSTING.md` — it documents
  running Caddy behind a Cloudflare Tunnel (`ops/caddy/setup-tunnel.sh`) so
  the box never needs inbound 80/443. If the box does have a public IP with
  80/443 forwarded, skip the tunnel and let Caddy's normal `auto_https`
  handle TLS.
