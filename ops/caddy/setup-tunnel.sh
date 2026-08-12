#!/bin/bash
# setup-tunnel.sh — attach this VPS to a Cloudflare Tunnel for hetja.in.
#
# Why a tunnel: this container has no public IP. It sits on 10.10.10.101 behind
# NAT, and the only forwarded port is SSH. External 80/443/8080 on
# 152.228.227.51 are answered by a different Caddy on the Proxmox host, so DNS
# pointing at that IP would reach someone else's server. cloudflared dials OUT
# to Cloudflare, so no inbound port or port-forward is needed.
#
# Prerequisites (done in the Cloudflare dashboard, see ops/caddy/HOSTING.md):
#   1. hetja.in added to Cloudflare and its nameservers set at Dynadot
#   2. A tunnel created under Zero Trust -> Networks -> Tunnels
#   3. Public hostnames pointing at http://localhost:80 (Caddy routes from there)
#
# Usage:
#   sudo ./setup-tunnel.sh <TUNNEL_TOKEN>
set -euo pipefail

TOKEN="${1:-}"
if [ -z "$TOKEN" ]; then
  echo "usage: $0 <TUNNEL_TOKEN>" >&2
  echo "Get the token from Zero Trust -> Networks -> Tunnels -> your tunnel -> Install." >&2
  exit 64
fi

command -v cloudflared >/dev/null || { echo "cloudflared is not installed" >&2; exit 1; }

echo "==> ensuring Caddy is up (cloudflared forwards to it on :80)"
systemctl enable --now caddy
for i in $(seq 1 10); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -H 'Host: hetja.in' http://127.0.0.1/ || true)
  [ "$code" = "200" ] && break
  [ "$i" = "10" ] && { echo "Caddy is not answering on :80 (last code: $code)" >&2; exit 1; }
  sleep 2
done
echo "    Caddy answering on :80"

echo "==> installing cloudflared as a system service"
# Replace any previous installation so this is safe to re-run.
cloudflared service uninstall >/dev/null 2>&1 || true
cloudflared service install "$TOKEN"

systemctl enable --now cloudflared
sleep 5

echo
echo "==> status"
systemctl is-active cloudflared && echo "    cloudflared: active"
journalctl -u cloudflared -n 12 --no-pager | tail -12

cat <<'NOTE'

Next, verify from outside this machine:

  curl -sI https://hetja.in/                       # 200, served by Next.js
  curl -s  https://hetja.in/api/v1/heatmap?ward=A  # JSON from Fastify
  curl -sI https://hetja.in/d/c3di5esh8            # 200 text/html (collar page)

Then confirm the proxy hop count. Fastify's trustProxy is currently 1, but with
cloudflared AND Caddy in front there are two hops, so the client IP may be read
one position off:

  journalctl -u straynet-api -n 20 | grep remoteAddress

If remoteAddress shows 127.0.0.1 rather than a real client IP, set TRUST_PROXY=2
in apps/api/.env.production and restart straynet-api. This only affects log
accuracy and IP-derived heuristics -- rate limits are keyed on account/device
token, never IP (INVARIANT 6).
NOTE
