# Hetja Ops Runbook

Phase-0 operating procedures for the Hetja stack on the VPS (and the
blueprint's production targets). Update as the platform moves to managed
infra (Cloudflare R2, KMS, HA Postgres).

**Authoritative database: managed Supabase.** `ops/supabase/*` is the source
of truth for schema and hardening; there is no competing local-systemd
Postgres backend to reconcile with it. See `AGENTS.md` section (b) — a fresh
box needs no Postgres, PostGIS, or pgvector install at all.

## Services (local dev / pilot)

| Service | How it runs | Port |
|---|---|---|
| PostgreSQL 16.14 + PostGIS + pgvector | managed Supabase (see `ops/supabase/`) | 5432 (pooler) |
| Hetja API (Fastify) | `pnpm --filter @hetja/api dev` (dev) / systemd unit (prod) | 8080 |
| Worker (fanout/escalation/retention) | `pnpm --filter @hetja/worker` | — |
| Scan landing (static) | static server / CDN | 80/443 |

## SLOs (from the blueprint)

- Hot path (scan → profile) p95 < 800 ms on 4G
- API gateway p95 < 150 ms; DB write p95 < 120 ms
- SOS ack p50 < 5 min / p90 < 8 min; escalation at opened_at + 8 min
- Vet ack-within-30-min >= 60 %; availability >= 99.5 %

Alert on: queue depth (jobs table), oldest unacked SOS case, moderation
backlog age, push delivery-receipt rate.

## Daily ledger anchor

The ledger head must be published daily (INVARIANT 10). Add a cron:
`pnpm --filter @hetja/ledger anchor` → writes `ledger_anchors` row +
publishes the head hash to the public endpoint `GET /api/v1/ledger/anchor`.

## PITR restore drill (monthly)

1. `pg_dump -Fc` nightly + WAL archiving to off-box storage.
2. Monthly: restore into a scratch database; verify `SELECT count(*)` on
   `scans`, `medical_records`; run `ledger:verify` against the restored chain.
3. Record RTO (target < 4 h).

### Honest status of backups (read before trusting any of the above)

`ops/backup/restic-backup.sh` exists and works: it takes a `pg_dump -Fc` of the
production database plus `.env.production` and the Caddy/PostgreSQL/systemd
configs, and stores encrypted restic snapshots. It is scheduled daily at 02:15
IST by `ops/systemd/hetja-restic.timer`.

Two things are **not** true yet, and were previously documented as though they
were:

1. **The repository is still local — `/srv/hetja-backups/restic`, on the same
   disk it is backing up.** Until `/root/.backup-env` carries R2 credentials
   this protects against a bad migration or an `rm`, and against nothing that
   takes the box or its disk with it. It is not an off-box backup and should not
   be counted as one in any RTO estimate.
2. **WAL archiving with wal-g is staged but dormant**, so there is no
   point-in-time recovery — only the nightly dump, i.e. up to 24 h of loss.
   Activation steps are in `ops/backup/wal-g.md`, and they need the same R2
   credentials.

Until 2026-08-14 this section, and `docs/CREDITS.md`, described a
`hetja-restic.timer` running daily at 02:15 IST. The timer was real, but it
existed only on the live box: it was in no committed file, and neither
`ops/bootstrap.sh` nor `ops/deploy-remote.sh` installed it. A box provisioned
from this repository therefore had **no backups at all** while two documents
said it had daily ones. Both units are now committed under `ops/systemd/`,
installed by `bootstrap.sh`, and `ops/check-systemd.sh` fails CI if a committed
unit is ever again left un-installed.

**To finish this, the operator needs to do one thing:** create
`/root/.backup-env` with a Cloudflare R2 bucket (the free tier is 10 GB, which
is ample for a dump plus configs), then re-run the timer once by hand and
confirm `restic snapshots` lists it. That single step turns both items above
from false into true. Do not include the pepper or any KMS-held secret in a
restic repository that a third party stores.

## Web Push (SOS responder notifications)

Feeders subscribe via `POST /api/v1/push/subscribe` after their first logged
feed -- never on page load. An unprompted permission dialog on first visit is
the thing users reflexively deny, and once denied it is hard to recover; see
`apps/web/lib/pwa.ts`'s `maybeSubscribeAfterFeed`. The worker
(`apps/worker`) sends VAPID-signed pushes via `web-push` on the
`send_sos_push` job and writes `sos_notifications.delivered_at` on success;
on a 404/410 from the push service (the endpoint is dead) it deletes the
stale `push_subscriptions` row instead of retrying it forever. On any other
failure `delivered_at` stays null -- an honest "not delivered", not an error.

**The gap, stated plainly: a responder who has not granted Web Push
permission is not reached. There is no SMS fallback in Phase 0.** iOS
requires Add-to-Home-Screen before Web Push works at all on that platform --
Apple only fires push events for an installed home-screen web app, never for
a Safari tab left open. This is the build guide's stated reason the native
shell (`apps/shell/`, currently an empty `.gitkeep`) is a non-deferrable
Phase-1 item, not optional polish. Until it ships: an iOS responder who has
not installed the PWA to their home screen, or an Android/desktop responder
who denied or never saw the permission prompt, receives nothing when fanned
out to for a case. `sos_notifications.channel` still correctly says
`'push'` for that row and `delivered_at` correctly stays null -- the data is
not lying, but no one is being paged either.

The 8-minute escalation job (unacked case → tier 2, notify BMC officers +
nearest vets) is the only other safety net today, and even that tier's
`sms`/`bmc` notification rows are logged, not sent -- no SMS provider is
wired up in Phase 0 (see the plan's email-OTP section for why phone/SMS
integration was dropped in favor of email rather than built out). **Do not
tell responders or pilot staff "you'll be paged" without qualifying it with
"if you've enabled notifications, and, on iPhone, installed the app to your
home screen first."** This is a life-safety limitation; it is documented
here on purpose, not smoothed over.

## Audit logging (pgaudit)

See [`docs/ops/AUDIT-LOGGING.md`](../docs/ops/AUDIT-LOGGING.md) for the install,
the two non-obvious configuration decisions (`log_parameter = off`, bounded log
rotation) and how it relates to the `medical_records` hash chain.

**Status: documented, not applied to the box.** It needs
`shared_preload_libraries` and therefore a full PostgreSQL restart, which drops
every connection including any in-flight SOS write — a maintenance-window
operation, not a deploy step. Nothing in this repository applies it, and that is
deliberate: it is not a migration (see the doc for why a
`CREATE EXTENSION pgaudit` migration would fail CI or silently no-op).

## DPDP erasure (INVARIANT 11)

Erasure = DELETE the PII row (e.g. feeders.identity_hmac) while the ledger chain
stays valid. The chain hashes pseudonymous actor IDs only — no personal data
inside hashed payloads.

What INVARIANT 11 does **not** yet have, and why it is still marked `🔶 design`
in `docs/INVARIANTS.md`: there is no `audit_log` table and no redaction job. The
designed shape (enhancement stack §G.9, §T.11) is an append-but-redactable table
— a `redacted_fields` JSONB column, a `redact_at` timestamp, and a scheduled job
that nulls fields past retention. It is deliberately **not** hash-chained,
because satisfying an erasure request means altering an old row, which a chain
would forbid. Also note `feeders.phone_hmac` was renamed `identity_hmac` in
migration `0010_identity_email.sql`; this section said the old name until
2026-08-14.

## Incident notes

- **Offline replay duplicates**: check `scans_client_uuid_uix` violations
  (should never happen — idempotency is by design).
- **SOS silence**: an unacked case fires the 8-min escalation job; if the
  escalation job itself is missing, check the `jobs` table for
  `escalate_sos` kind rows.
- **CGNAT lockouts**: rate limits are per account/device token, never per IP
  (INVARIANT 6) — if a whole carrier pool is blocked, that's a bug.

## Production migrations (applied automatically by the pipeline)

`ops/deploy-remote.sh` applies pending migrations to the **live** database on the
box before restarting the services. This closes a gap where the pipeline's
`migrate` job targeted Supabase only, while the API reads the local PostgreSQL
(`PGHOST=127.0.0.1` in `apps/api/.env.production`) — so a new migration reached
Supabase, which currently serves nothing, and never reached the database the
application actually queries.

**Migrations run as the `postgres` role, never as `app_user`.** In PostgreSQL the
creating role owns what it creates, and an owner holds full rights on its table
regardless of GRANTs. When `app_user` owns a table it can `DROP` it, and
`0001_init.sql`'s `REVOKE UPDATE, DELETE ON medical_records` strips the owner's
own rights — which breaks the referential-integrity trigger behind
`DELETE FROM dogs`, because such a trigger runs as the *referencing* table's
owner. That is the bug behind 48 CI failures, and migrations 0008–0011 had
already drifted `care_providers` and `schema_migrations` into `app_user`
ownership before this step existed. Migration 0012 reassigns them.

The connection goes over the **unix socket as root**, mapped to the `postgres`
role. Peer auth as the `postgres` OS user cannot work — `/root` is mode `700`, so
that user cannot read the migration files. A password on the `postgres` role
would be a new superuser credential in a file, and root can already
`su - postgres`, so the map grants nothing that did not already exist.

Required once per box (`/etc/postgresql/16/main/`):

```
# pg_ident.conf
rootasdba  root  postgres

# pg_hba.conf — change the existing rule
local   all   postgres   peer map=rootasdba
```

Then `SELECT pg_reload_conf();` — a reload, not a restart: an invalid file leaves
the previous rules active. Verify with
`PGHOST=/var/run/postgresql PGUSER=postgres psql -tAc 'select current_user'`
as root. `deploy-remote.sh` fails with these instructions if it cannot connect.

**Rollback: code rolls back, schema does not.** A migration stays applied even
when the health ladder fails and the release reverts. That is survivable only
because the destructive-change gate blocks `DROP`/`TRUNCATE`/`DELETE` without an
explicit `-- MIGRATION-APPROVED:` marker, so what flows through unattended is
additive — and additive changes are backward compatible with the code being
rolled back to. Anything destructive needs its own plan and a backup checked
first.
