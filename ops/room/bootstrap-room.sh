#!/usr/bin/env bash
# One-time setup of Hetja's "room" on a SHARED box. Run as root, once.
# Idempotent: safe to re-run (it converges, it never deletes releases or data).
#
#   ssh aic 'bash -s' < ops/room/bootstrap-room.sh            # dry-run (prints plan)
#   printf 'TUNNEL_TOKEN=%s\n' "$TOKEN" | ssh aic 'APPLY=1 DEPLOY_PUBKEY="..." bash -c "$(cat)"' ...
#   (see ops/room/README.md for the exact invocation)
#
# What it touches, and nothing else:
#   - creates system user `hetja` (home /srv/hetja, no password, no sudo)
#   - /srv/hetja/**           (the room: bin/, opt/, releases/, shared/, photos/)
#   - /etc/hetja/tunnel.env   (root 0600; Cloudflare tunnel token, read from stdin)
#   - /etc/systemd/system/hetja*.{slice,target,service,path,timer}
#   - /var/log/hetja-guard.log
# What it never touches: apt/dpkg, the system node, other users' files, other
# systemd units, the firewall, sysctl, cron. Every download is pinned and
# SHA-256 verified. Every step runs at nice 19 / idle IO so the co-tenant agent
# is not slowed down.
set -euo pipefail
renice -n 19 $$ >/dev/null 2>&1 || true
ionice -c3 -p $$ >/dev/null 2>&1 || true

APPLY="${APPLY:-0}"
SRC="${SRC:-/tmp/hetja-room}"           # where the room files were uploaded
NODE_V=v22.23.3
NODE_SHA=df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de
CADDY_V=2.11.4
CADDY_SHA=527fbf917c39189a1e3b31d34fa955601680b2d5c8055d2a87b8b9588dec7bb9
CFD_V=2026.9.1
CFD_SHA=03f1f25d1cc93b9ad6c60569d44060bc4f17ed97075760ed8cfca4b12dcd68cc
R=/srv/hetja

say() { printf '[room] %s\n' "$*"; }
run() { if [ "$APPLY" = 1 ]; then "$@"; else say "would: $*"; fi; }

[ "$(id -u)" = 0 ] || { echo "must run as root"; exit 1; }
[ -d "$SRC/units" ] || { echo "room files not found at $SRC"; exit 1; }

# Ports the room binds on loopback must be free (never steal a port).
for p in 80 3100 8080 8081; do
  if ss -Htln "sport = :$p" | grep -q . && ! ss -Htlnp "sport = :$p" | grep -q -E 'caddy|node'; then
    echo "port $p is in use by something that is not Hetja; refusing"; ss -Htlnp "sport = :$p"; exit 1
  fi
done

# 1. user + directories
if ! id hetja >/dev/null 2>&1; then
  run useradd --system --home-dir "$R" --no-create-home --shell /bin/bash --user-group hetja
fi
run install -d -o root -g root -m 0755 "$R" "$R/bin" "$R/opt"
run install -d -o hetja -g hetja -m 0750 "$R/releases" "$R/shared" "$R/incoming" "$R/photos" "$R/shared/caddy"
run install -d -o hetja -g hetja -m 0700 "$R/.ssh"
run install -d -o root -g root -m 0700 /etc/hetja

# 2. pinned, verified runtimes (never the system node; never apt)
fetch() { # url sha dest
  local tmp; tmp="$(mktemp)"
  curl -fsSL --retry 3 -o "$tmp" "$1"
  echo "$2  $tmp" | sha256sum -c --quiet - || { echo "CHECKSUM MISMATCH for $1"; rm -f "$tmp"; exit 1; }
  mv "$tmp" "$3"
}
if [ "$APPLY" = 1 ]; then
  if [ ! -x "$R/opt/node-$NODE_V-linux-x64/bin/node" ]; then
    say "installing node $NODE_V"
    fetch "https://nodejs.org/dist/$NODE_V/node-$NODE_V-linux-x64.tar.xz" "$NODE_SHA" /tmp/node.tar.xz
    tar -xJf /tmp/node.tar.xz -C "$R/opt" && rm -f /tmp/node.tar.xz
  fi
  ln -sfn "$R/opt/node-$NODE_V-linux-x64/bin/node" "$R/bin/node"
  if ! "$R/bin/caddy" version 2>/dev/null | grep -q "v$CADDY_V"; then
    say "installing caddy $CADDY_V"
    fetch "https://github.com/caddyserver/caddy/releases/download/v$CADDY_V/caddy_${CADDY_V}_linux_amd64.tar.gz" "$CADDY_SHA" /tmp/caddy.tgz
    tar -xzf /tmp/caddy.tgz -C "$R/bin" caddy && rm -f /tmp/caddy.tgz
  fi
  if ! "$R/bin/cloudflared" --version 2>/dev/null | grep -q "$CFD_V"; then
    say "installing cloudflared $CFD_V"
    fetch "https://github.com/cloudflare/cloudflared/releases/download/$CFD_V/cloudflared-linux-amd64" "$CFD_SHA" "$R/bin/cloudflared"
  fi
  chown root:root "$R/bin/"* && chmod 0755 "$R/bin/"*
else
  say "would install node $NODE_V, caddy $CADDY_V, cloudflared $CFD_V into $R/bin (sha256-verified)"
fi

# 3. room scripts (root-owned so the deploy user cannot modify them)
run install -o root -g root -m 0755 "$SRC/hetja-deploy.sh" "$R/bin/hetja-deploy"
run install -o root -g root -m 0755 "$SRC/hetja-guard.sh" "$R/bin/hetja-guard"

# 4. tunnel token: stdin only, never argv, never the repo
if [ "$APPLY" = 1 ] && [ ! -t 0 ]; then
  umask 077
  tok="$(grep -m1 '^TUNNEL_TOKEN=' || true)"
  if [ -n "$tok" ]; then printf '%s\n' "$tok" > /etc/hetja/tunnel.env; say "tunnel token written (/etc/hetja/tunnel.env, 0600 root)"; fi
fi
[ "$APPLY" = 1 ] && [ ! -s /etc/hetja/tunnel.env ] && say "WARNING: no tunnel token yet"

# 5. deploy key: restricted (no pty, no forwarding), hetja user only
if [ -n "${DEPLOY_PUBKEY:-}" ]; then
  case "$DEPLOY_PUBKEY" in ssh-ed25519\ *) ;; *) echo "DEPLOY_PUBKEY must be ssh-ed25519"; exit 1;; esac
  line="restrict $DEPLOY_PUBKEY"
  if [ "$APPLY" = 1 ]; then
    touch "$R/.ssh/authorized_keys"
    grep -qxF "$line" "$R/.ssh/authorized_keys" || printf '%s\n' "$line" >> "$R/.ssh/authorized_keys"
    chown hetja:hetja "$R/.ssh/authorized_keys"; chmod 0600 "$R/.ssh/authorized_keys"
  else say "would authorize deploy key for hetja (restrict)"; fi
fi

# 6. systemd units (hetja* only). daemon-reload restarts nothing.
for u in "$SRC"/units/*; do run install -o root -g root -m 0644 "$u" "/etc/systemd/system/$(basename "$u")"; done
run systemctl daemon-reload
run systemctl enable hetja.target hetja-guard.timer
run systemctl start hetja-guard.timer
say "done (APPLY=$APPLY). Services start with the first release: hetja-deploy <id>, then systemctl start hetja.target"
