# StrayNet Ops Runbook

Phase-0 operating procedures for the StrayNet stack on the VPS (and the
blueprint's production targets). Update as the platform moves to managed
infra (Cloudflare R2, KMS, HA Postgres).

## Services (local dev / pilot)

| Service | How it runs | Port |
|---|---|---|
| PostgreSQL 15 + PostGIS + pgvector | systemd `postgresql` | 5432 |
| StrayNet API (Fastify) | `pnpm --filter @straynet/api dev` (dev) / systemd unit (prod) | 8080 |
| Worker (fanout/escalation/retention) | `pnpm --filter @straynet/worker` | — |
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
`pnpm --filter @straynet/ledger anchor` → writes `ledger_anchors` row +
publishes the head hash to the public endpoint `GET /api/v1/ledger/anchor`.

## PITR restore drill (monthly)

1. `pg_dump -Fc` nightly + WAL archiving to off-box storage.
2. Monthly: restore into a scratch database; verify `SELECT count(*)` on
   `scans`, `medical_records`; run `ledger:verify` against the restored chain.
3. Record RTO (target < 4 h).

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
