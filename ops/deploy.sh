#!/bin/bash
# deploy.sh — build + install + restart Hetja services on the VPS.
# Safe to re-run. Installs the four systemd units from ops/systemd/ (see
# AGENTS.md and ops/bootstrap.sh for a from-scratch setup on a new box).
#
# SCOPE: this script deploys the API and worker ONLY.
#
# PIPELINE OWNS WEB AND SCAN. .github/workflows/deploy.yml builds them on a
# GitHub runner and rsyncs a release into /srv/hetja/releases/, because
# `next build` on this 2GB box OOM-killed the running services. If this script
# also built and restarted them it would race the pipeline and could serve a
# half-written release. Use the pipeline for web/scan; use this for a quick
# API/worker turnaround.
#
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"
NODE_BIN="$(command -v node)"

echo "==> pnpm install"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

echo "==> build packages + apps"
pnpm --filter @hetja/ledger build
pnpm --filter @hetja/contracts build
pnpm --filter @hetja/db build
pnpm --filter @hetja/api build
pnpm --filter @hetja/worker build

# Migrations are NOT applied from here. Per AGENTS.md §g they reach two
# databases from the pipeline: Supabase (from the runner) and the local
# production cluster (from ops/deploy-remote.sh).
#
# An earlier version of this comment said "the database is managed Supabase" —
# the same stale claim AGENTS.md §b calls out by name. The authoritative
# database is the LOCAL PostgreSQL on the box; Supabase holds a mirror that
# currently serves no reads.

echo "==> install units"
for unit in hetja-api.service hetja-web.service hetja-worker.service hetja-scan.service; do
  sed -e "s#__REPO_ROOT__#${REPO_ROOT}#g" -e "s#__NODE_BIN__#${NODE_BIN}#g" \
    "ops/systemd/${unit}" > "/etc/systemd/system/${unit}"
done
systemctl daemon-reload
# `enable --now` on a unit that is ALREADY enabled and running succeeds and does
# nothing — it does not restart. So this used to be:
#
#   systemctl enable --now hetja-api hetja-worker 2>/dev/null || systemctl restart ...
#
# where the `||` branch fired only if `enable` itself errored, i.e. essentially
# never. Every re-deploy after the first built a new dist/, printed "deploy
# complete", and left both services executing the old code — the same
# green-deploy-with-a-stale-API failure that ops/deploy-remote.sh exists to
# prevent. Enable (idempotent) and restart (unconditional) are two steps.
systemctl enable hetja-api hetja-worker
systemctl restart hetja-api hetja-worker

echo "==> health"
sleep 2

# Every probe used to end in `|| true` and merely PRINT %{http_code}; nothing
# compared it to anything and the script had no non-zero exit path, so "deploy
# complete" was printed over a stack that was returning 500s. Compare, and fail.
health=0
check() {
  local label="$1" want="$2" url="$3"
  local got
  got="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo 000)"
  if [ "$got" = "$want" ]; then
    echo "  OK   $label -> $got"
  else
    echo "  FAIL $label -> $got (want $want)"
    health=1
  fi
}

check "api /healthz" 200 "http://127.0.0.1:8080/healthz"
# DB connectivity probe: /healthz does not touch the database, but the heatmap
# route does, so a 200 here means the API can actually reach PostgreSQL.
# (This comment used to say "reach Supabase". Per AGENTS.md §b the authoritative
# database is the LOCAL cluster; the stale claim is exactly the kind that causes
# a "which database did that actually write to?" bug.)
check "api heatmap (db probe)" 200 "http://127.0.0.1:8080/api/v1/heatmap?ward=A"
check "scan landing" 200 "http://127.0.0.1:8081/"
check "web" 200 "http://127.0.0.1:3100/"

# hetja-worker has no HTTP surface, so it is invisible to every probe above. It
# is also the process that delivers SOS escalation and push fan-out, which makes
# "we never checked whether it came back up" the worst omission in this ladder.
for unit in hetja-api hetja-worker; do
  if systemctl is-active --quiet "$unit"; then
    echo "  OK   $unit is active"
  else
    echo "  FAIL $unit is not active"
    health=1
  fi
done

if [ "$health" -ne 0 ]; then
  echo "deploy FAILED health checks" >&2
  exit 1
fi
echo "deploy complete"
