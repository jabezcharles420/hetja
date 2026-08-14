#!/bin/bash
# Hetja restic backup — encrypted snapshots of configs, secrets (env files)
# and a daily Postgres dump, to R2 when /root/.backup-env has R2 creds,
# otherwise to the local interim repo. Silent on success; non-zero exit
# alerts via the cron watchdog. Enhancement stack §L.2 (Phase 1 #7).
set -u
ENV=/root/.backup-env
[ -r "$ENV" ] || { echo "restic: $ENV missing" >&2; exit 1; }
# shellcheck disable=SC1090
. "$ENV"

PW=${RESTIC_PASSWORD_FILE:-/root/.backup-env.restic-pw}
[ -s "$PW" ] || { echo "restic: password file $PW missing" >&2; exit 1; }

# Interim: daily logical dump of the production DB (as superuser via the
# rootasdba ident map) so we have DB protection even without wal-g PITR.
# Force the local socket — never inherit a TCP PGHOST from the caller.
DUMP_DIR=$(mktemp -d /tmp/hetja-pgdump.XXXXXX)
trap 'rm -rf "$DUMP_DIR"' EXIT
PGHOST=/var/run/postgresql PGUSER=postgres \
  pg_dump -d ${PGDUMP_DATABASE:-hetja} -Fc -f "$DUMP_DIR/hetja.dump" || {
  echo "restic: pg_dump failed" >&2; exit 1;
}

export RESTIC_PASSWORD_FILE="$PW"
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_DEFAULT_REGION

if ! restic snapshots --repo "$RESTIC_REPOSITORY" >/dev/null 2>&1; then
  restic init --repo "$RESTIC_REPOSITORY" >/dev/null 2>&1 || {
    echo "restic: repo init failed" >&2; exit 1;
  }
fi

restic backup --repo "$RESTIC_REPOSITORY" \
  "$DUMP_DIR" \
  /root/hetja/apps/api/.env.production \
  /root/hetja/apps/web/.env.production \
  /etc/caddy /etc/postgresql/16/main \
  /root/.config/systemd/user \
  --exclude '*.log' --exclude 'node_modules' --exclude 'dist' --exclude '.next' \
  >/dev/null 2>&1 || { echo "restic: backup failed" >&2; exit 1; }

restic forget --repo "$RESTIC_REPOSITORY" \
  --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune >/dev/null 2>&1

exit 0
