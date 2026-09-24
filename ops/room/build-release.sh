#!/usr/bin/env bash
# Assemble a Hetja release tarball from an already-built workspace.
# Runs on a Linux build machine (GitHub runner, or WSL), NEVER on the shared box.
#   usage: ops/room/build-release.sh <out.tar.gz>
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="$(realpath -m "${1:?usage: build-release.sh <out.tar.gz>}")"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# web: Next standalone + its static assets and public/ (not copied by Next).
mkdir -p "$STAGE/web"
cp -a apps/web/.next/standalone/. "$STAGE/web/"
cp -a apps/web/.next/static "$STAGE/web/apps/web/.next/static"
cp -a apps/web/public "$STAGE/web/apps/web/public"

# api + worker: self-contained prod installs (workspace deps copied in, no
# symlinks back into the monorepo).
pnpm --filter @hetja/api deploy --prod "$STAGE/api" >/dev/null
pnpm --filter @hetja/worker deploy --prod "$STAGE/worker" >/dev/null
cp -a apps/api/dist "$STAGE/api/dist"
cp -a apps/worker/dist "$STAGE/worker/dist"

# scan: static bundle + its tiny server (serve.mjs resolves ../dist).
mkdir -p "$STAGE/scan/scripts"
cp -a apps/scan/dist "$STAGE/scan/dist"
cp apps/scan/scripts/serve.mjs "$STAGE/scan/scripts/serve.mjs"
cp apps/scan/package.json "$STAGE/scan/package.json"

# Caddyfile: room global block + the site blocks from ops/caddy/Caddyfile
# (everything after its first top-level global options block).
{
  cat ops/room/Caddyfile.global
  awk 'BEGIN{d=0;done=0} !done{ if($0 ~ /^\{/){d=1} if(d){ if($0 ~ /^\}/){done=1} next } } done||!d{print}' ops/caddy/Caddyfile
} > "$STAGE/Caddyfile"

git rev-parse HEAD > "$STAGE/REVISION" 2>/dev/null || echo unknown > "$STAGE/REVISION"
tar -C "$STAGE" -czf "$OUT" .
echo "release: $OUT ($(du -h "$OUT" | cut -f1))"
