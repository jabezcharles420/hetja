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

# Migrations are no longer applied from here: the database is managed
# Supabase, and schema changes live in ops/supabase/ (applied by hand or by a
# separate Supabase migration step against the project, not by this script).

echo "==> install units"
for unit in hetja-api.service hetja-web.service hetja-worker.service hetja-scan.service; do
  sed -e "s#__REPO_ROOT__#${REPO_ROOT}#g" -e "s#__NODE_BIN__#${NODE_BIN}#g" \
    "ops/systemd/${unit}" > "/etc/systemd/system/${unit}"
done
systemctl daemon-reload
systemctl enable --now hetja-api hetja-worker 2>/dev/null || \
  systemctl restart hetja-api hetja-worker

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
