# AGENTS.md

Instructions for a coding agent (or a human) working on Hetja. Every step that
can be verified has a command and an expected result next to it. If a check
fails, stop and fix it before moving on.

**Read [`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md) first.** It explains what
the system does and why it is shaped this way. This file is the operational
half. [`docs/INVARIANTS.md`](docs/INVARIANTS.md) lists the fifteen rules the
code is not allowed to break, several of which CI enforces. Hosting lives in
[`ops/room/README.md`](ops/room/README.md).

## a. If you are just developing, you do not need a server

Most work needs only a clone, `pnpm install`, and the gates. Deployment happens
by pushing to `main` (§g).

```bash
pnpm install --frozen-lockfile
pnpm --filter @hetja/ledger build     # libraries first: consumers resolve them
pnpm --filter @hetja/contracts build  # through dist/, which is gitignored
pnpm --filter @hetja/db build
pnpm -r typecheck
bash ops/security-gate.sh
bash ops/contrast-gate.sh
pnpm --filter @hetja/scan build && pnpm --filter @hetja/scan size:gate
pnpm --filter @hetja/web test         # web and scan unit tests need no database
```

`ops/check-queries.sh` and the api, worker and db suites need a database (§f).

## b. What this is

Four services, all bound to loopback, plus Caddy and the tunnel:

| Service | App | Port | Notes |
|---|---|---|---|
| Web | `apps/web` (Next.js 14) | 3100 | Everything except the collar page. |
| API | `apps/api` (Fastify 5) | 8080 | `/api/v1/*`, also served at `api.hetja.in`. |
| Scan | `apps/scan` (static, no framework) | 8081 | The collar page and SOS, at `/d/*`. |
| Worker | `apps/worker` | none | Job queue: fan-out, escalation, retention, registration expiry. |
| Caddy | stock Caddy | 127.0.0.1:80 | Path routing; the tunnel's only origin. |
| cloudflared | Cloudflare Tunnel | none | Dials out. The box has no inbound web port. |

**The tab and route model (design v6).** The app has four tabs, **Home, Map,
Scan, Me** (`components/ds/TabBar.tsx`). Alerts is not a tab: it is a row on
Me with an unread count, and push notifications open it. Only the tab roots
carry the tab bar (`/`, `/scan`, `/me`; `/map` draws its own inside its
sheet). Every other app screen is a focused screen with a 52 px `AppHeader`
(back or Cancel), no tab bar and no footer; the footer is for the reading
pages (About, How it works, FAQ, Privacy, Contact). One file decides all of
it, per route: `apps/web/components/ChromeShell.tsx`. **Desktop wider than
744 px is an invitation, not an app:** every app route shows "Hetja lives on
your phone" (D1, `components/DesktopInvite.tsx`, with a QR of the page), the
collar page shows its own QR plus a working SOS button (D2, in `apps/scan`),
the reading pages, `/hetja` and 404s open in a 480 px phone column, `/sos/**`
is framed at 480 px so a responder at a desk can still act, and the print
sheets (`/register/<slug>/print`, `/register/batch`) and `/design` are left
as they are. There are no languages yet: English only, until human
translations exist.

**The production database is Supabase** (PostgreSQL with PostGIS, pgvector and
pgcrypto, in Mumbai, reached through its session pooler with `PGSSLMODE=require`).
There is no PostgreSQL on the production box. This reverses what an earlier
version of this file said (a local PostgreSQL on the box was authoritative and
Supabase a mirror that served no reads); that was true of the old single-tenant
box, which was reset on 2026-09-24. If you find a document that still says the
local database is authoritative, it predates the room: fix it or mark it
historical.

## c. Rules for working in this repo

- **No em dashes.** Not in code comments, copy, docs or commit messages. They
  were removed from the whole repository. Use a colon, a comma, parentheses or
  a new sentence. Check with `grep -rn "$(printf '\342\200\224')" <files>`
  (the UTF-8 bytes of U+2014, the em dash); it should print nothing.
- **UI work is verified against the handoff mocks, side by side.** Open the
  mock or its rendered board from `docs/design/v4-handoff/`, `v5-handoff/` or
  `v6-handoff/` next to the running screen at 390 x 844 (and 1440 where there
  is a desktop mock), and compare sizes, spacing, colours and button position.
  Ship **all** of the mock's copy verbatim. Where v6 and v5 overlap, v6 wins;
  the `CONTRACT.md` in each folder lists the owner's decisions and every
  deliberate departure from a mock, and a departure not listed there is a bug.
  The workflow is in
  [`docs/design/HETJA-DESIGN.md`](docs/design/HETJA-DESIGN.md) under
  "Verifying a screen".
- **Never kill processes by image name** (`taskkill /IM node.exe`,
  `pkill node`, `killall node`). Several agents and dev servers share one
  workstation; killing by name takes down everyone's. Kill the PID you started.
- **One shared Next dev server.** If a `next dev` for `apps/web` is already
  running, use it. Do not start a second one on another port, and do not stop
  one you did not start.

## d. The production box is shared, and the other tenant comes first

Since 2026-09-24 the box (LXC, 2 vCPU, 3 GB RAM, behind NAT) also runs an
autonomous agent that **has priority**. Hetja lives in a capped room
(`hetja.slice`: `CPUWeight=20`, `CPUQuota=60%`, `MemoryHigh=300M`,
`MemoryMax=360M`, `OOMScoreAdjust=1000` on every unit). The full contract is in
[`ops/room/README.md`](ops/room/README.md).

- **Never build, compile, `apt install` or do other heavy work on the box.**
  Everything is built on the GitHub runner. No system Node, no system Caddy;
  Hetja's pinned binaries live under `/srv/hetja/bin`.
- **Touch only `/srv/hetja`, `/etc/hetja` and `hetja*` units.** Nothing else on
  the box is ours.
- **Check the agent's health before and after anything you do there:**
  `free -m` (MemAvailable), `uptime` (load), `systemctl --failed`, and
  `systemd-cgtop -1` to see who is using what. The agent's watchdog
  (`/usr/local/bin/jobagent-watchdog`) restarts its browser when MemAvailable
  drops below **250 MB**; anything you do that pushes the box toward that line
  hurts the tenant that matters more.
- **The memory guard** (`hetja-guard.timer`, every 60 s) stops the whole of
  `hetja.target` when MemAvailable falls below 400 MB and starts it again
  above 900 MB. If the site is down and nothing is broken, check
  `/var/log/hetja-guard.log` first: the guard doing its job looks exactly like
  an outage.

## e. Secrets

**All production secrets are GitHub Actions secrets.** The deploy workflow
writes them into `/srv/hetja/shared/api.env` and `/srv/hetja/shared/web.env`
(mode 0600, owned by `hetja`) on every deploy. Nothing on the box is edited by
hand, and cloning the repo gets you no secrets. Never paste a secret's value
into a file, a commit, an issue, a log or a chat.

| Secret | Used for |
|---|---|
| `DEPLOY_SSH_KEY`, `DEPLOY_SSH_KNOWN_HOSTS` | The deploy key for the unprivileged `hetja` user (authorised with `restrict`), and the pinned host key (`StrictHostKeyChecking=yes`). |
| `DEPLOY_SSH_HOST`, `DEPLOY_SSH_PORT`, `DEPLOY_SSH_USER` | Where the deploy logs in. The box is behind NAT on a non-standard SSH port. |
| `SUPABASE_POOLER_HOST`, `SUPABASE_POOLER_PORT`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` | The production database, for migrations and the API. Use the **session** pooler port (5432), not the transaction pooler: migrations run multi-statement transactions. |
| `HETJA_JWT_SECRET` | Written as `JWT_SECRET`. Signs access tokens. |
| `HETJA_HMAC_PEPPER` | Peppers `identity_hmac` (INVARIANT 3). |
| `HETJA_QR_SECRET` | **Carry over, never regenerate.** See below. |
| `HETJA_DEVICE_SECRET` | Signs anonymous device tokens. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web Push. Rotating them invalidates every existing push subscription. |
| `BREVO_SMTP_HOST`, `BREVO_SMTP_PORT`, `BREVO_SMTP_USER`, `BREVO_SMTP_PASSWORD` | Sign-in email. The API refuses to boot in production without SMTP, deliberately: the original bug was generating login codes and sending them nowhere. |
| `ESRI_API_KEY` | The map's basemap tiles. Inlined into the web bundle at build time as `NEXT_PUBLIC_ESRI_API_KEY`, so it is public by design: it is an ArcGIS Location Platform key restricted to Hetja's referrers and to basemap privileges only. It also draws the street map on the responder's SOS page (`components/care/SpotMap.tsx`). Without it there are no street tiles at all (the ward pills and pins sit on a plain background and the map says so): there is no keyless fallback, because CARTO's keyless tiles now answer with an "API key required" image. |

The workflow also writes fixed values that are not secrets: `JWT_ACCESS_TTL=15m`,
`JWT_REFRESH_TTL=30d`, `TRUST_PROXY=1` (one hop: cloudflared to Caddy to the
API), `CORS_ORIGINS`, `STORAGE_BACKEND=local` with photos in
`/srv/hetja/photos`, `PUBLIC_API_ORIGIN=https://api.hetja.in`, `PGPOOL_MAX=4`,
`MAIL_FROM` and `VAPID_SUBJECT`. `web.env` carries only `NEXT_PUBLIC_API_URL`.
`DEVICE_POW_DIFFICULTY` is not set, so the default of 16 applies (see
`docs/HOW-IT-WORKS.md` §9 for why not 18). The ledger signing key
(`HETJA_LEDGER_SIGNING_JWK`) is not wired into the room yet, so daily anchors
are unsigned.

Design v5 and v6 added **no secret and no environment variable**: every new
limit, window and cap (wards, quiet hours, the 30-day alerts pause, the
dogless SOS limits) is a constant in the code, not configuration.

For local development, copy `apps/api/.env.example` to a `.env` of your own
and fill it with throwaway values.

**`HETJA_QR_SECRET` must be carried over from the previous deployment.** It is
the HMAC key baked into every QR code already printed and glued to a physical
collar. Generating a fresh value will not error, will not fail loudly, and will
not show up in any test. It will simply make every collar printed before that
moment fail signature verification the next time a stranger scans one,
standing over a dog. Keep it in a password manager as well as in GitHub.

## f. Tests

The web and scan suites need nothing. The api, worker and db suites insert real
rows into PostgreSQL with **PostGIS, pgvector and pgcrypto**, and refuse to run
unless `PGDATABASE` ends in `_test`: `medical_records` is append-only, so test
rows can never be removed. Run suites one package at a time
(`pnpm -r --workspace-concurrency=1 test`, which is what `pnpm test` does);
they share one database and race each other otherwise.

**On Windows, use WSL (Ubuntu 24.04).** Copy the repo into the WSL filesystem
rather than running from `/mnt/c` (native modules and file watching are slow
and sometimes wrong across that boundary), install there, and point the suite
at the WSL PostgreSQL:

```bash
# once, inside WSL
sudo apt-get install -y postgresql-16 postgresql-16-postgis-3 postgresql-16-pgvector
sudo service postgresql start
sudo -u postgres psql -c "CREATE ROLE app_user LOGIN PASSWORD 'dev-pw';"
sudo -u postgres psql -c "ALTER ROLE postgres PASSWORD 'pg-pw';"   # dev box only

# each run
rsync -a --delete --exclude node_modules --exclude .git --exclude dist --exclude .next \
  /mnt/c/Users/<you>/Documents/Hetja/ ~/hetja-test/
cd ~/hetja-test && pnpm install --frozen-lockfile
pnpm --filter @hetja/ledger build && pnpm --filter @hetja/contracts build && pnpm --filter @hetja/db build

sudo -u postgres createdb hetja_test
sudo -u postgres psql -d hetja_test -c "CREATE EXTENSION postgis; CREATE EXTENSION vector; CREATE EXTENSION pgcrypto;"
# migrations as postgres, never as app_user (ownership note in §h)
PGHOST=127.0.0.1 PGDATABASE=hetja_test PGUSER=postgres PGPASSWORD=pg-pw pnpm --filter @hetja/db migrate
sudo -u postgres psql -d hetja_test -v ON_ERROR_STOP=1 -c "
  GRANT USAGE ON SCHEMA public TO app_user;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
  REVOKE UPDATE, DELETE ON medical_records FROM app_user;
  REVOKE TRUNCATE ON medical_records FROM app_user;"

PGHOST=127.0.0.1 PGDATABASE=hetja_test PGUSER=app_user PGPASSWORD=dev-pw \
  pnpm --filter @hetja/api test
```

The grants reproduce production's privilege set. The two REVOKEs are
INVARIANT 8 (numbered 9 in older comments): `GRANT ALL` would hand `app_user`
UPDATE, DELETE and TRUNCATE on the append-only table. The statement-level
`BEFORE TRUNCATE` trigger from `0012` still blocks a real TRUNCATE, but the
point of the recipe is to match production exactly.

CI does the same against a `postgis/postgis:16-3.4` container with pgvector
installed into it (`.github/workflows/ci.yml` and the Gate job in
`deploy.yml`). The Docker equivalent for macOS or Linux is in
[`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md) §8.

**The ownership detail is load-bearing.** The referential-integrity check behind
`DELETE FROM dogs` runs as the *referencing* table's owner, so
`medical_records` must be owned by `postgres` with `app_user` holding grants.
If `app_user` owns it, `0001_init.sql`'s REVOKE strips the owner's own rights
and every dog-delete fails with `permission denied for table medical_records`,
the bug behind 48 CI failures, documented in migration 0012's header comment.

The browser tests are Playwright (`pnpm --filter @hetja/web test:e2e`, after
`test:e2e:install`), including axe accessibility checks and the 390px layout
gate.

## g. How code reaches production

**Push to `main`.** Do not build or deploy by hand, and never on the box.

```
push -> Gate    typecheck, all tests (ephemeral PostGIS + pgvector), security gate,
                EXPLAIN gate, 40 KB size gate, contrast gate, Caddy cache gate,
                systemd wiring gate
     -> Migrate destructive-change gate, a read-only Supabase state report,
                then apply new migrations to Supabase (the production DB)
     -> Deploy  build every package ON THE RUNNER (Node 22), assemble one tarball
                (ops/room/build-release.sh), write api.env and web.env from secrets,
                scp to /srv/hetja/incoming/ as `hetja`, run hetja-deploy <id>,
                then check https://hetja.in through Cloudflare
```

`hetja-deploy` (`ops/room/hetja-deploy.sh`, installed as
`/srv/hetja/bin/hetja-deploy`) unpacks the release into
`/srv/hetja/releases/<id>/`, checks the expected entry points exist, validates
the Caddyfile, atomically points `/srv/hetja/releases/current` at the new
release, and writes `/srv/hetja/shared/deploy-stamp`. A root-owned path unit
(`hetja-restart.path`) sees the stamp and restarts the `hetja-*` services, so
the deploy user needs no sudo. It then health-checks the API, web, scan and
Caddy for up to 180 s; if they do not come up it points `current` back at the
previous release and stamps again. It keeps the three newest releases.

Things worth knowing before you change any of it:

- **Manual runs** (`gh workflow run deploy.yml --ref <branch>`) deploy any
  ref, and migrate Supabase only with `-f supabase_migrate=true`. Pushes to
  `main` always migrate.
- **Documentation-only pushes do not deploy** (`paths-ignore` on `**/*.md`,
  `docs/**`, `LICENSE`). Anything under `ops/**` or `.github/**` does.
- **First deploy to a fresh room:** after the first release exists, run
  `systemctl start hetja.target` once, as root. From then on the target starts
  at boot and deploys restart it through the stamp file.
- **Rollback covers code, not schema.** An applied migration stays applied when
  a release is reverted. This is only safe because the destructive gate keeps
  unattended migrations additive.
- **The destructive-change gate** (`ops/check-destructive-migrations.sh`) fails
  the build on `DROP TABLE`, `TRUNCATE`, `DELETE FROM` and similar unless the
  file carries `-- MIGRATION-APPROVED: <reason>`. Additive changes flow
  untouched. Do not add that marker to silence the gate. It exists for changes
  that need a human and a checked backup.
- **`ops-maintenance.yml` predates the room.** Its tasks assume the old
  `/root/hetja` checkout and system Caddy, which no longer exist on the box.
  Do not run it against the room.

**Pushing from a new machine** needs its own credential: a deploy key with write
access on the repo, or an account SSH key. The production deploy key is a
GitHub secret only; never copy it to a laptop.

## h. Gotchas

- **`NEXT_PUBLIC_*` is inlined at build time, not read at runtime.** That
  includes `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_ESRI_API_KEY`. Changing one
  means a new build, which means a push; editing `web.env` on the box and
  restarting does nothing.
- **Apply migrations as a superuser, so `postgres` owns the tables.** In
  PostgreSQL the creating role owns what it creates, and an owner holds full
  rights on its table regardless of GRANTs. Migrations 0008 to 0011 drifted two
  real tables into `app_user` ownership before this was understood; `0012`
  reassigns them. On Supabase the migrate job connects as the project's
  `postgres` user through the pooler.
- **The API test suite refuses to run unless `PGDATABASE` ends in `_test`.** A
  deliberate guard. Do not work around it.
- **The scan bundle has a hard 40 KB gzipped budget** enforced in CI, and it
  is nearly full: 39,101 B of 40,960 B on 2026-09-25 (about 1.9 KB left), of
  which 11,267 B is the Inter subset. It was 33,260 B before the v6 screens;
  three cuts made room for them (build-time HTML minification in
  `apps/scan/scripts/build.mjs`, 20 rarely used ASCII symbols dropped from the
  subset, and the `web-vitals` package replaced by native `PerformanceObserver`
  measurement in a separate idle-loaded `telemetry.js`). It is the page a
  stranger loads on a street; every kilobyte is a second. Anything added there
  has to earn its bytes, and there is no fourth easy cut.
- **`/d/*` is `no-store` at Caddy**, because a dog's status is life-safety state
  that must never be served stale. The one exception is `/d/inter-scan.woff2`
  (30 days). `ops/check-caddy-cache.sh` guards both.
- **The room runs stock Caddy**, without the `caddy-cloudflare-ip` module the
  old box had, and trusts private ranges instead: behind the tunnel every
  request arrives from loopback anyway. Routes and cache policy still come
  from `ops/caddy/Caddyfile`, spliced under `ops/room/Caddyfile.global` at
  build time.
- **Do not reintroduce the old working title.** The project is Hetja. The name
  was removed from 967 files; only git history still carries it, pending a
  rewrite that will invalidate every SHA.
- **Run the `ops/*.sh` gates on an LF copy on Windows.** This checkout uses
  `core.autocrlf=true`, so the scripts on disk have CRLF line endings, and bash
  reads each carriage return as part of the command: `bash ops/security-gate.sh`
  and friends fail with `$'\r': command not found` errors that look like a
  broken gate. The repository itself stores LF. Run them from an LF copy, such
  as the WSL copy of §f with its line endings converted (`dos2unix`, or a
  checkout made inside WSL); an rsync from `/mnt/c` copies the CRLF as it is.
  For a single script, `tr -d '\r' < ops/x.sh > ops/.x-lf.sh` inside the repo
  (the scripts find files relative to themselves), run it, and delete it.
- **Playwright on this workstation uses Edge.** Playwright's bundled Chromium
  is not installed on the maintainer's Windows machine, so ad hoc checks and
  the screen export launch with `channel: "msedge"` (the export hard-codes it).
  `playwright.config.ts` itself asks for plain Chromium, which CI installs
  with `test:e2e:install`.
- **Screen export for design review.** `pnpm --filter @hetja/web
  screens:export` (`apps/web/scripts/export-screens.mjs`) shoots the screens
  and states in its 47 flows at 390 x 844 (and 1440 where there is a desktop
  design) for Claude Design, which cannot visit the site, and writes an
  `INDEX.md` the v6 boards refer to by capture number. It does not yet visit
  `/settings`, `/alerts`, `/welcome`, `/scan/code`, `/scan/find`,
  `/me/dogs/**`, `/vet` or `/register/batch`; add a flow before asking for a
  design pass on those. Every `/api/v1/*` call is answered from
  fixtures in the script and every non-GET request is blocked, so it cannot
  page a responder or send an email. It shoots `https://hetja.in` unless
  `HETJA_SCREENS_BASE_URL` says otherwise, writes to `Hetja-screens/` (and a
  zip) next to the repo checkout (`HETJA_SCREENS_OUT`), and
  `HETJA_SCREENS_ONLY` picks flows. It is not a test and CI never runs it; the
  screenshots are never committed.
- **Some `ops/*.sh` were committed non-executable** and CI invoked them as
  `bash ops/...`, which hid it. If `./ops/foo.sh` gives "permission denied",
  `git update-index --chmod=+x` it rather than working around it.
- **Historical files.** `ops/bootstrap.sh`, `ops/deploy.sh`,
  `ops/deploy-remote.sh`, `ops/systemd/*` and `ops/caddy/setup-tunnel.sh`
  describe the single-tenant box (a git checkout at `/root/hetja`, a local
  PostgreSQL, system Caddy). They are kept for reference and are not how
  production runs now; `ops/room/` is.
