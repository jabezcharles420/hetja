#!/bin/bash
# Hetja restic backup — encrypted snapshots of configs, secrets (env files)
# and a daily Postgres dump. Silent on success; a non-zero exit marks the
# systemd unit failed, which is what a heartbeat check should watch for.
# Enhancement stack §L.2 (Phase 1 #7).
#
# The destination is whatever RESTIC_REPOSITORY in /root/.backup-env names.
# restic speaks several backends and this script does not care which, with one
# exception it DOES care about: each backend needs different things present, and
# a missing helper otherwise surfaces as an opaque restic error at 02:15 in a
# log nobody is reading. So the backend is identified and its prerequisite
# checked up front, loudly. See ops/backup/BACKUPS.md for setup.
#
#   rclone:<remote>:<path>   Google Drive, OneDrive, Dropbox, ~70 others.
#                            Needs the `rclone` binary and a configured remote.
#                            This is the no-payment-card path.
#   s3:https://…             Cloudflare R2, Backblaze B2, MinIO, AWS.
#                            Needs AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY,
#                            and AWS_DEFAULT_REGION=auto for R2.
#   /srv/…  or  local:…      A directory. Fine for testing, NOT a backup if it
#                            is on the same disk as the thing being backed up.
set -u
ENV=/root/.backup-env
[ -r "$ENV" ] || { echo "restic: $ENV missing" >&2; exit 1; }
# shellcheck disable=SC1090
. "$ENV"

[ -n "${RESTIC_REPOSITORY:-}" ] || {
  echo "restic: RESTIC_REPOSITORY is not set in $ENV" >&2; exit 1; }

case "$RESTIC_REPOSITORY" in
  rclone:*)
    command -v rclone >/dev/null 2>&1 || {
      echo "restic: RESTIC_REPOSITORY is an rclone remote but the rclone binary is missing." >&2
      echo "restic: install it (curl https://rclone.org/install.sh | sudo bash) and configure the remote — see ops/backup/BACKUPS.md." >&2
      exit 1; }
    # `rclone about` is the cheapest call that proves the remote is not just
    # named but actually authorised — an expired OAuth token fails here rather
    # than halfway through uploading a dump.
    remote=${RESTIC_REPOSITORY#rclone:}; remote=${remote%%:*}
    rclone about "${remote}:" >/dev/null 2>&1 || {
      echo "restic: rclone remote '${remote}:' is not reachable (unconfigured, or the OAuth token has expired)." >&2
      echo "restic: check with 'rclone about ${remote}:' and re-authorise with 'rclone config reconnect ${remote}:'." >&2
      exit 1; }
    ;;
  s3:*)
    [ -n "${AWS_ACCESS_KEY_ID:-}" ] && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ] || {
      echo "restic: RESTIC_REPOSITORY is an S3 endpoint but AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY are unset in $ENV." >&2
      exit 1; }
    ;;
  *)
    # A local path. Warn rather than fail: it is a legitimate staging setup, but
    # it is not off-box, and the docs should not be the only place that says so.
    echo "restic: WARNING — repository '$RESTIC_REPOSITORY' looks local. If it is on this box's disk it does not survive losing this box." >&2
    ;;
esac

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
