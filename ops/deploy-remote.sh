#!/usr/bin/env bash
# ops/deploy-remote.sh — server-side half of the Hetja deploy pipeline.
#
# Invoked over SSH by .github/workflows/deploy.yml AFTER it has already
# rsynced a prebuilt release (apps/web's standalone bundle + apps/scan's
# static bundle) into $RELEASES_DIR/<release-name>/.
#
# Builds are split by cost, not by preference. `next build` needs ~1 GB, and
# running it on this 2 GB box alongside the live services is what OOM-killed
# the web app before (see apps/web/next.config.mjs), so web and scan are always
# built on the GitHub runner and arrive here as finished bundles. @hetja/api and
# @hetja/worker are plain `tsc` — seconds, negligible memory — and they run from
# the git checkout rather than from a release directory, so they are built HERE
# from the exact SHA being deployed.
#
# That second half used to be missing entirely: the pipeline shipped web and
# scan, restarted all four units, and reported success, while hetja-api and
# hetja-worker kept executing whatever stale dist/ happened to be sitting in
# the checkout. An API-only commit could go green and never reach production.
#
#   1. sync $CHECKOUT_DIR to $HETJA_APP_SHA and rebuild api + worker
#   2. flip the `current` symlink at $CURRENT_LINK to the new release
#   3. restart the four units
#   4. run the health-check ladder
#   5. on any failure, repoint `current` back at the previous release AND reset
#      the checkout to the previous SHA, rebuild, restart, and re-check — both
#      halves roll back or neither does
#   6. prune old release directories, keeping the last $KEEP
#
# Idempotent: safe to re-run for the same release name (flips the symlink
# to the same target, restarts, re-checks) or a different one.
#
# Usage:
#   ops/deploy-remote.sh <release-name>
#
# <release-name> must already exist as a directory under $RELEASES_DIR —
# the workflow creates and populates it via rsync before calling this
# script.
#
# Optional env (all have sane defaults for this box):
#   HETJA_RELEASES_DIR   base directory holding release directories
#                         (default: /srv/hetja/releases)
#   HETJA_CURRENT_LINK   the `current` symlink path
#                         (default: /srv/hetja/current)
#   HETJA_KEEP_RELEASES  how many releases to retain (default: 3)
#   HETJA_CHECKOUT_DIR   git checkout that hetja-api/hetja-worker run from
#                         (default: /root/hetja)
#   HETJA_APP_SHA        commit to build api + worker from. The workflow passes
#                         $GITHUB_SHA. If UNSET, the checkout is left entirely
#                         alone and api/worker are only restarted — the old,
#                         silently-stale behaviour, so it logs loudly.
#
# Optional Postgres env (PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD/
# PGSSLMODE) — used only to look up a real collar slug for the `/d/<slug>`
# health check. If unset, or no dog row is found, that one check is
# skipped with a warning rather than failing the whole deploy (the same
# "skip, don't fail, on an empty seed" precedent ops/bootstrap.sh already
# uses for this exact check).
set -euo pipefail

RELEASES_DIR="${HETJA_RELEASES_DIR:-/srv/hetja/releases}"
CURRENT_LINK="${HETJA_CURRENT_LINK:-/srv/hetja/current}"
KEEP="${HETJA_KEEP_RELEASES:-3}"
CHECKOUT_DIR="${HETJA_CHECKOUT_DIR:-/root/hetja}"
APP_SHA="${HETJA_APP_SHA:-}"
UNITS=(hetja-api hetja-worker hetja-scan hetja-web)

# Build order matters: api and worker both import the workspace libraries, and
# tsc resolves those through their built dist/, not their sources.
SERVICE_BUILD_ORDER=(ledger contracts db api worker)

# A non-login SSH command inherits almost no PATH, so node/pnpm/git installed
# outside /usr/bin are invisible unless named here. Getting this wrong fails the
# build rather than corrupting anything, but it fails on every single deploy.
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${HOME:-/root}/.local/share/pnpm:${PATH:-}"

log()  { printf -- '==> %s\n' "$*"; }
fail() { printf 'FATAL: %s\n' "$*" >&2; exit 1; }

[ "$#" -eq 1 ] || fail "usage: $0 <release-name>"
RELEASE_NAME="$1"
NEW_RELEASE="${RELEASES_DIR}/${RELEASE_NAME}"

[ -d "$RELEASES_DIR" ] || fail "releases dir does not exist: $RELEASES_DIR (expected the workflow to have created it via rsync)"
[ -d "$NEW_RELEASE" ]  || fail "release directory does not exist: $NEW_RELEASE (the workflow should rsync into it before calling this script)"
[ -f "$NEW_RELEASE/web/apps/web/server.js" ] || \
  fail "release $RELEASE_NAME has no web/apps/web/server.js -- looks incomplete, refusing to deploy it"
[ -f "$NEW_RELEASE/scan/dist/index.html" ] || \
  fail "release $RELEASE_NAME has no scan/dist/index.html -- looks incomplete, refusing to deploy it"

# Capture whatever `current` points at right now, before we touch it, so we
# can roll back to exactly that release if the new one fails its checks.
PREVIOUS_RELEASE=""
if [ -L "$CURRENT_LINK" ]; then
  PREVIOUS_RELEASE="$(readlink -f "$CURRENT_LINK" || true)"
fi

# Whatever the checkout is on right now, so a failed deploy can put api and
# worker back exactly where they were — the checkout's counterpart to
# $PREVIOUS_RELEASE above.
PREVIOUS_SHA=""
if [ -n "$APP_SHA" ] && [ -d "$CHECKOUT_DIR/.git" ]; then
  PREVIOUS_SHA="$(git -C "$CHECKOUT_DIR" rev-parse HEAD 2>/dev/null || true)"
fi

point_current_at() {
  ln -sfn "$1" "$CURRENT_LINK"
  log "current -> $(readlink -f "$CURRENT_LINK")"
}

# Points the checkout at a specific commit and rebuilds api + worker from it.
#
# `git reset --hard` is deliberate over `git pull`: pull can open a merge or
# refuse outright when the checkout has drifted, and a deploy must be able to
# state exactly which commit is running. reset only touches TRACKED files, so
# the gitignored .env.production files — which hold the QR secret, the database
# password and the SMTP credentials — are left alone. Losing those would
# invalidate every printed collar, so their presence is asserted, not assumed.
sync_and_build_services() { # $1 = target sha
  local sha="$1" pkg env_file
  [ -d "$CHECKOUT_DIR/.git" ] || fail "no git checkout at $CHECKOUT_DIR -- cannot build api/worker"
  command -v git  >/dev/null 2>&1 || fail "git not on PATH ($PATH)"
  command -v pnpm >/dev/null 2>&1 || fail "pnpm not on PATH ($PATH)"

  log "syncing $CHECKOUT_DIR to ${sha}"
  # Fetch main first (the normal case -- deploys run on push to main). Fall back
  # to fetching the bare SHA, which covers a force-push race where the commit is
  # no longer reachable from the branch tip.
  git -C "$CHECKOUT_DIR" fetch --prune --quiet origin main \
    || git -C "$CHECKOUT_DIR" fetch --quiet origin "$sha" \
    || fail "could not fetch ${sha} from origin"
  git -C "$CHECKOUT_DIR" reset --hard --quiet "$sha" \
    || fail "could not reset $CHECKOUT_DIR to ${sha}"
  log "checkout now at $(git -C "$CHECKOUT_DIR" rev-parse --short HEAD)"

  for env_file in apps/api/.env.production apps/web/.env.production; do
    [ -f "$CHECKOUT_DIR/$env_file" ] \
      || fail "$env_file is missing from $CHECKOUT_DIR -- refusing to continue; the API cannot boot without it, and printed collars depend on the QR secret it holds"
  done

  log "installing dependencies"
  ( cd "$CHECKOUT_DIR" && pnpm install --frozen-lockfile ) \
    || fail "pnpm install failed in $CHECKOUT_DIR"

  log "building: ${SERVICE_BUILD_ORDER[*]} (tsc only -- next build never runs on this box)"
  for pkg in "${SERVICE_BUILD_ORDER[@]}"; do
    ( cd "$CHECKOUT_DIR" && pnpm --filter "@hetja/${pkg}" build ) \
      || fail "build failed for @hetja/${pkg}"
  done

  [ -f "$CHECKOUT_DIR/apps/api/dist/server.js" ] \
    || fail "apps/api/dist/server.js absent after build -- refusing to restart into nothing"
  log "api + worker built from ${sha}"
}

restart_units() {
  log "restarting: ${UNITS[*]}"
  systemctl restart "${UNITS[@]}"
}

# Looks up one real collar slug from the database for the /d/<slug> check.
# Best-effort only: prints nothing (and the caller treats that as "skip")
# if PG env isn't set, psql isn't reachable, or the table is empty.
lookup_slug() {
  [ -n "${PGHOST:-}" ] && [ -n "${PGPASSWORD:-}" ] || return 0
  command -v psql >/dev/null 2>&1 || return 0
  PGPASSWORD="$PGPASSWORD" psql \
    "host=${PGHOST} port=${PGPORT:-5432} dbname=${PGDATABASE:-postgres} user=${PGUSER:-postgres} sslmode=${PGSSLMODE:-require} connect_timeout=8" \
    -tAc 'select slug from dogs limit 1' 2>/dev/null | tr -d '[:space:]' || true
}

# Runs the health-check ladder against the box's own loopback ports (Caddy
# fronts these; checking loopback here avoids depending on Caddy/DNS/TLS to
# validate that the units themselves came up correctly).
# Sets $HEALTH_STATUS to 0 (all OK) or 1 (something failed).
run_health_checks() {
  HEALTH_STATUS=0

  check() { # desc, url, wanted status
    local desc="$1" url="$2" want="${3:-200}" got
    got="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo 000)"
    if [ "$got" = "$want" ]; then
      printf 'OK    %-24s %-50s -> %s\n' "$desc" "$url" "$got"
    else
      printf 'FAIL  %-24s %-50s -> %s (wanted %s)\n' "$desc" "$url" "$got" "$want"
      HEALTH_STATUS=1
    fi
  }

  check_html() { # desc, url -- wants 200 AND a text/html content-type
    local desc="$1" url="$2" got ct
    got="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$url" 2>/dev/null || echo 000)"
    ct="$(curl -s -o /dev/null -D - --max-time 5 "$url" 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2; exit}')"
    if [ "$got" = "200" ] && printf '%s' "$ct" | grep -qi 'text/html'; then
      printf 'OK    %-24s %-50s -> %s (%s)\n' "$desc" "$url" "$got" "$ct"
    else
      printf 'FAIL  %-24s %-50s -> %s (%s) (wanted 200 / *text/html*)\n' "$desc" "$url" "$got" "$ct"
      HEALTH_STATUS=1
    fi
  }

  check      "web /"              "http://127.0.0.1:3100/"
  check      "web /scan"          "http://127.0.0.1:3100/scan"
  check      "api heatmap"        "http://127.0.0.1:8080/api/v1/heatmap?ward=A"

  local slug
  slug="$(lookup_slug)"
  if [ -n "$slug" ]; then
    check_html "scan /d/<slug>" "http://127.0.0.1:8081/d/${slug}"
  else
    log "WARN: no collar slug available (PG env unset, psql unreachable, or table empty) -- skipping /d/<slug> check"
  fi
}

prune_old_releases() {
  log "pruning old releases (keeping last ${KEEP})"
  local current_target="" name
  [ -L "$CURRENT_LINK" ] && current_target="$(basename "$(readlink -f "$CURRENT_LINK")")"

  # shellcheck disable=SC2012
  find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort \
    | head -n -"${KEEP}" \
    | while IFS= read -r name; do
        [ -n "$name" ] || continue
        if [ "$name" = "$current_target" ]; then
          continue
        fi
        log "removing old release: $name"
        rm -rf "${RELEASES_DIR:?}/${name:?}"
      done
}

main() {
  log "deploying release '${RELEASE_NAME}' (previous: ${PREVIOUS_RELEASE:-none})"

  # api/worker BEFORE the restart. Doing it afterwards would health-check the
  # old binary and pass, which is exactly the failure this script was missing.
  if [ -n "$APP_SHA" ]; then
    sync_and_build_services "$APP_SHA"
  else
    log "WARN: HETJA_APP_SHA unset -- api and worker will be RESTARTED but NOT"
    log "WARN: rebuilt, so they keep running whatever is already in"
    log "WARN: ${CHECKOUT_DIR}/apps/*/dist. Pass HETJA_APP_SHA to deploy them."
  fi

  point_current_at "$NEW_RELEASE"
  restart_units

  log "waiting for services to settle"
  sleep 3

  run_health_checks
  if [ "$HEALTH_STATUS" -eq 0 ]; then
    log "health checks passed -- ${RELEASE_NAME} is live"
    prune_old_releases
    exit 0
  fi

  log "health checks FAILED for ${RELEASE_NAME} -- rolling back"
  if [ -z "$PREVIOUS_RELEASE" ] || [ ! -d "$PREVIOUS_RELEASE" ]; then
    fail "no valid previous release to roll back to -- manual intervention required (current release '${RELEASE_NAME}' is left in place but is failing health checks)"
  fi

  # Roll back both halves. If the API is what broke, flipping only the web/scan
  # symlink leaves the broken API running, and the re-check below then fails for
  # a reason that has nothing to do with the rollback.
  if [ -n "$APP_SHA" ]; then
    if [ -n "$PREVIOUS_SHA" ]; then
      log "rolling the checkout back to ${PREVIOUS_SHA}"
      # In a subshell on purpose. sync_and_build_services reports problems via
      # fail(), which exits -- and on the rollback path an exit would skip the
      # symlink flip and restart below, the higher-value half of the rollback.
      # A subshell contains that exit so `||` can catch it.
      ( sync_and_build_services "$PREVIOUS_SHA" ) \
        || log "WARN: could not rebuild api/worker at ${PREVIOUS_SHA} -- continuing with the symlink rollback; api/worker may still be running ${APP_SHA}"
    else
      log "WARN: no previous SHA recorded -- api/worker stay on ${APP_SHA} while web/scan roll back"
    fi
  fi

  point_current_at "$PREVIOUS_RELEASE"
  restart_units
  sleep 3
  run_health_checks
  if [ "$HEALTH_STATUS" -eq 0 ]; then
    log "rolled back to $(basename "$PREVIOUS_RELEASE") successfully"
    fail "deploy of ${RELEASE_NAME} failed health checks; rolled back to $(basename "$PREVIOUS_RELEASE")"
  else
    fail "rolled back to $(basename "$PREVIOUS_RELEASE") but it ALSO fails health checks -- manual intervention required, both releases are unhealthy"
  fi
}

main
