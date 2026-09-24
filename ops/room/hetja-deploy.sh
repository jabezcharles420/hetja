#!/usr/bin/env bash
# Runs ON the shared box as the unprivileged `hetja` user (installed to
# /srv/hetja/bin/hetja-deploy by bootstrap-room.sh). Never needs root:
# restarts happen by writing /srv/hetja/shared/deploy-stamp, which a root-owned
# systemd path unit (hetja-restart.path) watches.
#   usage: hetja-deploy <release-id>
# expects: /srv/hetja/incoming/<release-id>.tar.gz
#          /srv/hetja/incoming/api.env, /srv/hetja/incoming/web.env (optional)
set -euo pipefail
ID="${1:?usage: hetja-deploy <release-id>}"
[[ "$ID" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "bad release id"; exit 2; }
ROOT="${HETJA_ROOT:-/srv/hetja}"   # overridable for tests only
TAR="$ROOT/incoming/$ID.tar.gz"
DEST="$ROOT/releases/$ID"
[ -f "$TAR" ] || { echo "missing $TAR"; exit 2; }

# Everything here is low priority: the co-tenant agent always comes first.
renice -n 19 $$ >/dev/null 2>&1 || true
ionice -c3 -p $$ >/dev/null 2>&1 || true

rm -rf "$DEST.tmp"; mkdir -p "$DEST.tmp"
tar -xzf "$TAR" -C "$DEST.tmp"
for f in web/apps/web/server.js api/dist/server.js worker/dist/index.js scan/scripts/serve.mjs Caddyfile; do
  [ -e "$DEST.tmp/$f" ] || { echo "release is missing $f"; rm -rf "$DEST.tmp"; exit 3; }
done
"$ROOT/bin/caddy" validate --config "$DEST.tmp/Caddyfile" --adapter caddyfile >/dev/null 2>&1 \
  || { echo "Caddyfile does not validate"; rm -rf "$DEST.tmp"; exit 3; }
rm -rf "$DEST"; mv "$DEST.tmp" "$DEST"

umask 077
for e in api web; do
  if [ -f "$ROOT/incoming/$e.env" ]; then mv -f "$ROOT/incoming/$e.env" "$ROOT/shared/$e.env"; fi
done
[ -f "$ROOT/shared/api.env" ] || { echo "no api.env ever delivered"; exit 3; }

# `current` lives in releases/ (hetja-owned) because /srv/hetja itself is
# root-owned on purpose: if hetja could write there it could swap bin/, which
# holds scripts root runs. Each step is its own statement: inside an `a && b`
# list `set -e` does not abort on `a` failing, which once hid exactly this.
CUR="$ROOT/releases/current"
PREV="$(readlink "$CUR" 2>/dev/null || true)"
ln -sfn "$DEST" "$ROOT/releases/.current.new"
mv -T "$ROOT/releases/.current.new" "$CUR"
[ "$(readlink "$CUR")" = "$DEST" ] || { echo "failed to point current at $DEST"; exit 3; }
echo "$ID $(date -u +%FT%TZ)" > "$ROOT/shared/deploy-stamp"

check() { # name url [host]
  local h=(); [ -n "${3:-}" ] && h=(-H "Host: $3")
  curl -fsS -o /dev/null --max-time 5 "${h[@]}" "$2"
}
healthy() {
  check api   http://127.0.0.1:8080/healthz &&
  check web   http://127.0.0.1:3100/ &&
  check scan  http://127.0.0.1:8081/ &&
  check caddy http://127.0.0.1:80/api/v1/heatmap?ward=A hetja.in
}
# Services start slowly under the co-tenant's load: allow up to 3 minutes.
for i in $(seq 1 "${HETJA_HEALTH_TRIES:-36}"); do
  sleep "${HETJA_HEALTH_SLEEP:-5}"
  if healthy; then
    echo "healthy after $(( i * ${HETJA_HEALTH_SLEEP:-5} ))s: $ID"
    rm -f "$TAR"
    # Keep the 3 newest. Match release IDs only (YYYYmmddHHMMSS-sha), never
    # the `current` symlink: `rm -rf current/` would delete the LIVE release.
    # (|| true: under pipefail a loop ending on the protected skip returns 1.)
    find "$ROOT/releases" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended \
      -regex '.*/[0-9]{14}-[0-9a-f]{7}' -printf '%f\n' | sort -r | tail -n +4 \
      | while read -r old; do
          [ "$ROOT/releases/$old" != "$(readlink "$CUR")" ] && rm -rf "${ROOT:?}/releases/$old"
        done || true
    exit 0
  fi
done

echo "UNHEALTHY after $(( ${HETJA_HEALTH_TRIES:-36} * ${HETJA_HEALTH_SLEEP:-5} ))s: rolling back to ${PREV:-<none>}"
if [ -n "$PREV" ] && [ -d "$PREV" ]; then
  ln -sfn "$PREV" "$ROOT/releases/.current.new"
  mv -T "$ROOT/releases/.current.new" "$CUR"
  echo "rollback $(basename "$PREV") $(date -u +%FT%TZ)" > "$ROOT/shared/deploy-stamp"
fi
exit 1
