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
ROOT=/srv/hetja
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

PREV="$(readlink "$ROOT/current" 2>/dev/null || true)"
ln -sfn "$DEST" "$ROOT/current.new" && mv -T "$ROOT/current.new" "$ROOT/current"
date +%s > /dev/null; echo "$ID $(date -u +%FT%TZ)" > "$ROOT/shared/deploy-stamp"

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
for i in $(seq 1 36); do
  sleep 5
  if healthy; then
    echo "healthy after $((i*5))s: $ID"
    rm -f "$TAR"
    ls -1dt "$ROOT"/releases/*/ | tail -n +4 | xargs -r rm -rf   # keep 3
    exit 0
  fi
done

echo "UNHEALTHY after 180s: rolling back to ${PREV:-<none>}"
if [ -n "$PREV" ] && [ -d "$PREV" ]; then
  ln -sfn "$PREV" "$ROOT/current.new" && mv -T "$ROOT/current.new" "$ROOT/current"
  echo "rollback $(basename "$PREV") $(date -u +%FT%TZ)" > "$ROOT/shared/deploy-stamp"
fi
exit 1
