#!/bin/bash
# Config-as-code gate: ops/caddy/Caddyfile must keep the Phase 0 cache policy
# (enhancement stack §M.4). A misconfigured cache rule on /d/* is a life-safety
# bug — the collar page shows SOS state that changes underneath it — not a
# perf regression. This gate runs in CI so the policy cannot silently rot.
set -u
cd "$(dirname "$0")/.."
CADDY=ops/caddy/Caddyfile
fail=0
check() { # desc, expected, actual
  if [ "$3" != "$2" ]; then echo "FAIL: $1 (expected $2, got $3)"; fail=1; else echo "PASS: $1"; fi
}

block() { grep -F -A4 "handle $1" "$CADDY" | head -5; }

care=$(block '/api/v1/care*')
check "care* block has 60s cache" yes "$(echo "$care" | grep -q 'max-age=60' && echo yes || echo no)"

d=$(block '/d/*')
check "/d/* block no-store" yes "$(echo "$d" | grep -q 'no-store' && echo yes || echo no)"
check "/d/* block has NO max-age/immutable" no "$(echo "$d" | grep -qE 'max-age|immutable' && echo yes || echo no)"

s=$(block '/_next/static/*')
check "_next/static block immutable" yes "$(echo "$s" | grep -q 'immutable' && echo yes || echo no)"

api=$(block '/api/v1/*')
check "api catch-all no-store" yes "$(echo "$api" | grep -q 'no-store' && echo yes || echo no)"

[ "$fail" -eq 0 ] && echo "PASS: Caddy cache policy intact" && exit 0
exit 1
