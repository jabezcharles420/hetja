#!/bin/bash
# deploy.sh — build + install + restart Hetja services on the VPS.
# Safe to re-run. Installs the four systemd units from ops/systemd/ (see
# AGENTS.md and ops/bootstrap.sh for a from-scratch setup on a new box).
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
pnpm --filter @hetja/scan build
pnpm --filter @hetja/web build

# Migrations are no longer applied from here: the database is managed
# Supabase, and schema changes live in ops/supabase/ (applied by hand or by a
# separate Supabase migration step against the project, not by this script).

echo "==> install units"
for unit in straynet-api.service straynet-web.service straynet-worker.service straynet-scan.service; do
  sed -e "s#__REPO_ROOT__#${REPO_ROOT}#g" -e "s#__NODE_BIN__#${NODE_BIN}#g" \
    "ops/systemd/${unit}" > "/etc/systemd/system/${unit}"
done
systemctl daemon-reload
systemctl enable --now straynet-api straynet-web straynet-worker straynet-scan 2>/dev/null || \
  systemctl restart straynet-api straynet-web straynet-worker straynet-scan

echo "==> health"
sleep 2
curl -s -o /dev/null -w "api /healthz -> %{http_code}\n" http://127.0.0.1:8080/healthz || true
# DB connectivity probe: /healthz doesn't touch the database, but the heatmap
# route does, so a 200 here means the API can actually reach Supabase.
curl -s -o /dev/null -w "api /api/v1/heatmap (db probe) -> %{http_code}\n" \
  "http://127.0.0.1:8080/api/v1/heatmap?ward=A" || true
curl -s -o /dev/null -w "scan landing -> %{http_code}\n" http://127.0.0.1:8081/ || true
curl -s -o /dev/null -w "web -> %{http_code}\n" http://127.0.0.1:3100/ || true
echo "deploy complete"
