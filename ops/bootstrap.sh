#!/usr/bin/env bash
# ops/bootstrap.sh — bring the Hetja stack up on a fresh box,
# unattended. Implements AGENTS.md sections (d) Bootstrap and (e) Verify as
# one idempotent script: safe to re-run, and it exits non-zero the moment
# anything is wrong so a coding agent (or CI) can tell success from failure
# without a human reading scrollback.
#
# Usage: run as root from a fresh clone, after apps/api/.env.production and
# apps/web/.env.production have been created from their .env.example
# templates and filled in (see AGENTS.md section (c) — in particular,
# HETJA_QR_SECRET must be the value carried over from the previous
# deployment, never freshly generated).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

log()  { printf -- '==> %s\n' "$*"; }
fail() { printf 'FATAL: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Prerequisites — fail with a clear, specific message, not a stack trace.
# ---------------------------------------------------------------------------
log "checking prerequisites"

command -v node >/dev/null 2>&1 || fail \
  "node is not installed. Install Node 20+ (see .nvmrc) — no Postgres/PostGIS/pgvector install is needed, the database is managed Supabase (AGENTS.md section b)."
command -v pnpm >/dev/null 2>&1 || fail \
  "pnpm is not installed. Run 'corepack enable' or install pnpm matching the 'packageManager' field in package.json."
command -v caddy >/dev/null 2>&1 || fail \
  "caddy is not installed. Install it (https://caddyserver.com/docs/install) — it is the only process meant to be reachable from outside this box; see ops/caddy/HOSTING.md if this box has no public IP."
command -v systemctl >/dev/null 2>&1 || fail \
  "systemctl is not available. This script installs systemd units for the four services and will not work on a box without systemd."
command -v openssl >/dev/null 2>&1 || fail \
  "openssl is not installed. It is needed to generate secrets per AGENTS.md section (c) (e.g. 'openssl rand -hex 32')."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node $NODE_MAJOR found at $(command -v node), but Node 20+ is required (see .nvmrc)."
fi
NODE_BIN="$(command -v node)"

for f in apps/api/.env.production apps/web/.env.production; do
  if [ ! -f "$f" ]; then
    fail "$f is missing. Copy ${f%.production}.example to $f and fill it in — see AGENTS.md section (c). HETJA_QR_SECRET in particular must be carried over from the previous deployment, never freshly generated, or every printed collar QR silently stops verifying."
  fi
done

log "prerequisites OK (node $NODE_MAJOR at $NODE_BIN)"

# ---------------------------------------------------------------------------
# 2. Install + build, in dependency order.
# ---------------------------------------------------------------------------
log "pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

for pkg in @hetja/ledger @hetja/contracts @hetja/db @hetja/api @hetja/worker @hetja/scan @hetja/web; do
  log "build $pkg"
  pnpm --filter "$pkg" build
done

# ---------------------------------------------------------------------------
# 3. Render + install the four systemd units.
# ---------------------------------------------------------------------------
log "rendering systemd units (__REPO_ROOT__=$REPO_ROOT, __NODE_BIN__=$NODE_BIN)"

for unit in ops/systemd/hetja-api.service ops/systemd/hetja-web.service \
            ops/systemd/hetja-worker.service ops/systemd/hetja-scan.service; do
  [ -f "$unit" ] || fail "missing unit template: $unit"
  name="$(basename "$unit")"
  sed -e "s#__REPO_ROOT__#${REPO_ROOT}#g" -e "s#__NODE_BIN__#${NODE_BIN}#g" \
    "$unit" > "/etc/systemd/system/${name}"
  log "installed /etc/systemd/system/${name}"
done

systemctl daemon-reload
systemctl enable --now hetja-api hetja-web hetja-worker hetja-scan

if [ -f ops/caddy/Caddyfile ]; then
  systemctl enable --now caddy 2>/dev/null || \
    log "WARN: could not enable caddy via systemd — start it manually with ops/caddy/Caddyfile (see ops/caddy/HOSTING.md if this box has no public IP)."
fi

# ---------------------------------------------------------------------------
# 4. Verify — the curl ladder from AGENTS.md section (e).
# ---------------------------------------------------------------------------
log "waiting for services to come up"
sleep 3

status=0

check_status() {
  local desc="$1" url="$2" want="$3" got
  got="$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo "000")"
  if [ "$got" = "$want" ]; then
    printf 'OK    %-22s %-52s -> %s\n' "$desc" "$url" "$got"
  else
    printf 'FAIL  %-22s %-52s -> %s (wanted %s)\n' "$desc" "$url" "$got" "$want"
    status=1
  fi
}

check_status_and_type() {
  local desc="$1" url="$2" want="$3" want_type="$4" got ct
  got="$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo "000")"
  ct="$(curl -s -o /dev/null -D - "$url" 2>/dev/null | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2; exit}')"
  if [ "$got" = "$want" ] && printf '%s' "$ct" | grep -qi "$want_type"; then
    printf 'OK    %-22s %-52s -> %s (%s)\n' "$desc" "$url" "$got" "$ct"
  else
    printf 'FAIL  %-22s %-52s -> %s (%s) (wanted %s / *%s*)\n' "$desc" "$url" "$got" "$ct" "$want" "$want_type"
    status=1
  fi
}

check_status       "web"          "http://127.0.0.1:3100/"                        200
check_status       "scan landing" "http://127.0.0.1:8081/"                        200
check_status       "api healthz"  "http://127.0.0.1:8080/healthz"                 200
check_status       "api heatmap"  "http://127.0.0.1:8080/api/v1/heatmap?ward=A"   200

# The /d/<slug> and /d/main.js checks need a real collar slug. Look one up
# from the DB if data already exists (e.g. carried over via Supabase from a
# previous deployment); skip with a warning rather than failing bootstrap on
# a genuinely empty, just-provisioned database.
SLUG=""
if [ -f packages/db/dist/pool.js ]; then
  SLUG="$(node --env-file=apps/api/.env.production --input-type=module -e "
    import('./packages/db/dist/pool.js').then(async ({ pool }) => {
      try {
        const r = await pool.query('select slug from dogs limit 1');
        process.stdout.write(r.rows[0]?.slug ?? '');
      } finally {
        await pool.end();
      }
    }).catch(() => {});
  " 2>/dev/null || true)"
fi

if [ -n "$SLUG" ]; then
  check_status_and_type "scan dog page" "http://127.0.0.1:8081/d/${SLUG}" 200 "text/html"
  check_status_and_type "scan bundle"   "http://127.0.0.1:8081/d/main.js" 200 "text/javascript"
else
  log "WARN: no seeded dog found — skipping /d/<slug> and /d/main.js checks. Run 'pnpm --filter @hetja/db seed' and re-run this script to exercise them."
fi

for svc in hetja-api hetja-web hetja-worker hetja-scan; do
  if systemctl is-active --quiet "$svc"; then
    printf 'OK    %-22s active\n' "$svc"
  else
    printf 'FAIL  %-22s not active (see: journalctl -u %s -n 50)\n' "$svc" "$svc"
    status=1
  fi
done

if [ "$status" -ne 0 ]; then
  fail "one or more verification checks failed — see FAIL lines above."
fi

log "bootstrap complete"
