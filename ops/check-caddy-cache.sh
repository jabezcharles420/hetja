#!/bin/bash
# Config-as-code gate: ops/caddy/Caddyfile must keep the Phase 0 cache policy
# (enhancement stack §M.4). A misconfigured cache rule on /d/* is a life-safety
# bug — the collar page shows SOS state that changes underneath it — not a
# perf regression. This gate runs in CI so the policy cannot silently rot.
#
# The first version of this gate read one block with
# `grep -F -A4 "handle $1" | head -5`, which had two holes big enough to let
# through exactly the bug it exists to catch:
#
#   1. Only the FIRST match was inspected. The Caddyfile already declares the
#      API policy twice (hetja.in and api.hetja.in), so a third vhost — or a
#      second /d/* handler added below the first — was never looked at.
#   2. A missing block passed vacuously. `grep` on an absent pattern returns
#      nothing, and "this block contains no max-age" is trivially true of no
#      block at all. Deleting the /d/* handler outright would have satisfied
#      half these assertions.
#
# So this version parses the file: it finds EVERY `handle <pattern> {` block,
# tracks brace depth to get the whole body (including the nested
# reverse_proxy { … }), and asserts the policy on each one — plus a presence
# check, so a renamed or deleted handler fails instead of passing quietly.
set -u
cd "$(dirname "$0")/.."
# Overridable so the gate can be negative-tested against a deliberately broken
# copy — a gate nobody has ever seen fail is not known to work.
CADDY=${CADDY:-ops/caddy/Caddyfile}

[ -f "$CADDY" ] || { echo "FAIL: $CADDY not found"; exit 1; }

# Emit one TSV row per handle block: pattern <TAB> nth <TAB> flags
# where flags is a comma-joined set drawn from no-store,max-age,immutable.
# Brace depth is counted per-character so `reverse_proxy 127.0.0.1:8080 {`
# nested inside a handle does not end the block early.
parse_blocks() {
  awk '
    function flush() {
      f = ""
      if (has_nostore)   f = f "no-store,"
      if (has_maxage)    f = f "max-age,"
      if (has_immutable) f = f "immutable,"
      seen[pat]++
      printf "%s\t%d\t%s\n", pat, seen[pat], f
    }
    {
      line = $0
      if (depth == 0) {
        # `handle /d/* {`  or the pattern-less catch-all `handle {`
        if (match(line, /^[[:space:]]*handle[[:space:]]+[^{[:space:]]+[[:space:]]*\{/)) {
          pat = line
          sub(/^[[:space:]]*handle[[:space:]]+/, "", pat)
          sub(/[[:space:]]*\{.*$/, "", pat)
        } else if (match(line, /^[[:space:]]*handle[[:space:]]*\{/)) {
          pat = "(catch-all)"
        } else {
          next
        }
        has_nostore = has_maxage = has_immutable = 0
      }
      # count braces on this line
      n = length(line)
      for (i = 1; i <= n; i++) {
        c = substr(line, i, 1)
        if (c == "{") depth++
        else if (c == "}") depth--
      }
      if (line ~ /no-store/)  has_nostore = 1
      if (line ~ /max-age/)   has_maxage = 1
      if (line ~ /immutable/) has_immutable = 1
      if (depth <= 0) { flush(); depth = 0 }
    }
  ' "$CADDY"
}

BLOCKS=$(parse_blocks)
fail=0

pass() { echo "PASS: $1"; }
bad()  { echo "FAIL: $1"; fail=1; }

# require_all <pattern> <description> <must-have-regex|-> <must-NOT-have-regex|->
# Asserts the pattern appears at least once, and that EVERY occurrence complies.
require_all() {
  local pat="$1" desc="$2" must="$3" mustnot="$4"
  local rows count=0
  rows=$(printf '%s\n' "$BLOCKS" | awk -F'\t' -v p="$pat" '$1 == p')
  count=$(printf '%s' "$rows" | grep -c . || true)
  if [ "$count" -eq 0 ]; then
    bad "$desc — no \`handle $pat\` block found at all (renamed or deleted?)"
    return
  fi
  local n flags ok=1
  while IFS=$'\t' read -r _ n flags; do
    [ -n "${n:-}" ] || continue
    if [ "$must" != "-" ] && ! printf '%s' "$flags" | grep -q "$must"; then
      bad "$desc — occurrence #$n is missing $must"
      ok=0
    fi
    if [ "$mustnot" != "-" ] && printf '%s' "$flags" | grep -qE "$mustnot"; then
      bad "$desc — occurrence #$n must not set $mustnot (got: ${flags%,})"
      ok=0
    fi
  done <<< "$rows"
  [ "$ok" -eq 1 ] && pass "$desc (all $count occurrence(s))"
}

# /d/* is the collar page a stranger loads standing over a hurt dog. It renders
# SOS state, so it must never be cached anywhere, by anyone, ever.
require_all '/d/*'              '/d/* is no-store and never cached' 'no-store' 'max-age|immutable'

# The API catch-all is no-store. INVARIANT-adjacent: /api/v1/dogs/* and
# /api/v1/sos/* both fall under it, and apps/api/src/server.ts independently
# strips ETag and forces no-store on those two prefixes — belt and braces.
require_all '/api/v1/*'         'API catch-all is no-store'         'no-store' 'max-age|immutable'

# The public care-provider directory is the one cacheable API surface: it is
# read-only reference data, identical for every caller in a ward.
require_all '/api/v1/care*'     'care* is cached for 60s'           'max-age'  '-'

# Content-addressed build output; safe to cache for a year.
require_all '/_next/static/*'   '_next/static is immutable'         'immutable' '-'

# If anyone ever adds an explicit handler for the dog API or the SOS API, it
# must be no-store too — these carry live case state. Absent is fine (the
# catch-all covers them), which is why this is a conditional check rather than
# require_all.
for pat in '/api/v1/dogs*' '/api/v1/dogs/*' '/api/v1/sos*' '/api/v1/sos/*'; do
  rows=$(printf '%s\n' "$BLOCKS" | awk -F'\t' -v p="$pat" '$1 == p')
  if [ -n "$(printf '%s' "$rows" | grep -c . | grep -v '^0$' || true)" ]; then
    while IFS=$'\t' read -r _ n flags; do
      [ -n "${n:-}" ] || continue
      if printf '%s' "$flags" | grep -q 'no-store'; then
        pass "explicit \`handle $pat\` #$n is no-store"
      else
        bad "explicit \`handle $pat\` #$n carries live state and must be no-store"
      fi
    done <<< "$rows"
  fi
done

# Real-IP forwarding (enhancement stack §L.6): cloudflared terminates the client
# connection at Cloudflare's edge, so without this every stranger arrives as a
# loopback address. Note what this does and does not buy: the API has no
# IP-based rate limiter (INVARIANT 6 rate-limits per device token, never per IP,
# because Indian carrier CGNAT means one IP is hundreds of real subscribers).
# What it fixes is request logging and any future per-IP flood cap on token
# MINTING, which is a different subject from capping a user's actions.
check_simple() { # desc, condition-command...
  if "${@:2}"; then pass "$1"; else bad "$1"; fi
}
check_simple 'CF-Connecting-IP forwarded upstream' grep -q 'CF-Connecting-IP' "$CADDY"
check_simple 'trusted_proxies pinned to Cloudflare ranges' grep -q 'trusted_proxies cloudflare' "$CADDY"

# Every reverse_proxy must import the real_ip snippet, or that vhost silently
# reverts to seeing loopback.
proxies=$(grep -c 'reverse_proxy' "$CADDY" || true)
realips=$(grep -c 'import real_ip' "$CADDY" || true)
if [ "$proxies" -eq "$realips" ]; then
  pass "all $proxies reverse_proxy blocks import real_ip"
else
  bad "only $realips of $proxies reverse_proxy blocks import real_ip"
fi

if [ "$fail" -eq 0 ]; then
  echo "PASS: Caddy cache policy intact"
  exit 0
fi
exit 1
