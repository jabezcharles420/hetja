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

## DPDP erasure (INVARIANT 11)

Erasure = DELETE the PII row (e.g. feeders.phone_hmac) while the ledger chain
stays valid. The chain hashes pseudonymous actor IDs only — no personal data
inside hashed payloads.

## Incident notes

- **Offline replay duplicates**: check `scans_client_uuid_uix` violations
  (should never happen — idempotency is by design).
- **SOS silence**: an unacked case fires the 8-min escalation job; if the
  escalation job itself is missing, check the `jobs` table for
  `escalate_sos` kind rows.
- **CGNAT lockouts**: rate limits are per account/device token, never per IP
  (INVARIANT 6) — if a whole carrier pool is blocked, that's a bug.
