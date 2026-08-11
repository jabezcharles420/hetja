#!/bin/bash
# deploy.sh — build + install + restart StrayNet services on the VPS.
# Safe to re-run. Uses system-level units (straynet-api, straynet-worker,
# straynet-scan) copied from ops/systemd/.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> pnpm install"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

echo "==> build packages + apps"
pnpm --filter @straynet/ledger build
pnpm --filter @straynet/contracts build
pnpm --filter @straynet/db build
pnpm --filter @straynet/api build
pnpm --filter @straynet/worker build
pnpm --filter @straynet/scan build

echo "==> migrate (no-op if current)"
pnpm --filter @straynet/db migrate

echo "==> install units"
cp ops/systemd/straynet-api.service ops/systemd/straynet-worker.service \
   ops/systemd/straynet-scan.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now straynet-api straynet-worker straynet-scan 2>/dev/null || \
  systemctl restart straynet-api straynet-worker straynet-scan

echo "==> health"
sleep 2
curl -s -o /dev/null -w "api /healthz -> %{http_code}\n" http://127.0.0.1:8080/healthz || true
curl -s -o /dev/null -w "scan landing -> %{http_code}\n" http://127.0.0.1:8081/ || true
echo "deploy complete"
