#!/bin/bash
# Config-as-code gate: ops/caddy/Caddyfile must keep the Phase 0 cache policy
# (enhancement stack §M.4). A misconfigured cache rule on /d/* is a life-safety
# bug (the collar page shows SOS state that changes underneath it), not a
# perf regression. This gate runs in CI so the policy cannot silently rot.
#
# The first version of this gate read one block with
# `grep -F -A4 "handle $1" | head -5`, which had two holes big enough to let
# through exactly the bug it exists to catch:
#
#   1. Only the FIRST match was inspected. The Caddyfile already declares the
#      API policy twice (hetja.in and api.hetja.in), so a third vhost (or a
#      second /d/* handler added below the first) was never looked at.
#   2. A missing block passed vacuously. `grep` on an absent pattern returns
#      nothing, and "this block contains no max-age" is trivially true of no
#      block at all. Deleting the /d/* handler outright would have satisfied
#      half these assertions.
#
# So this version parses the file: it finds EVERY `handle <pattern> {` block,
# tracks brace depth to get the whole body (including the nested
# reverse_proxy { … }), and asserts the policy on each one, plus a presence
# check, so a renamed or deleted handler fails instead of passing quietly.
set -u
cd "$(dirname "$0")/.."
# Overridable so the gate can be negative-tested against a deliberately broken
# copy: a gate nobody has ever seen fail is not known to work.
CADDY=${CADDY:-ops/caddy/Caddyfile}

# --self-test: run this gate against deliberately broken copies of the real
# Caddyfile and require each to FAIL, then require the real file to PASS.
# CI runs it next to the gate itself.
if [ "${1:-}" = "--self-test" ]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  st_fail=0
  # expect_fail <name> <sed-expression>
  expect_fail() {
    sed -e "$2" "$CADDY" > "$tmp/$1"
    if cmp -s "$CADDY" "$tmp/$1"; then
      echo "SELF-TEST BROKEN: mutation '$1' did not change the file"; st_fail=1; return
    fi
    if CADDY="$tmp/$1" bash "$0" >/dev/null 2>&1; then
      echo "SELF-TEST FAIL: gate passed a Caddyfile with: $1"; st_fail=1
    else
      echo "SELF-TEST ok: gate rejects $1"
    fi
  }
  expect_fail 'ward-list-rule-widened-onto-detail' 's#handle /api/v1/map/wards {#handle /api/v1/map/wards* {#'
  expect_fail 'ward-detail-handle-cached' '/handle \/api\/v1\/map\/wards\/\* {/,/}/ s#"no-store"#"public, max-age=60"#'
  expect_fail 'ward-list-no-store' '/handle \/api\/v1\/map\/wards {/,/reverse_proxy/ s#"public, max-age=60, s-maxage=60"#"no-store"#'
  expect_fail 'heatmap-handle-renamed' 's#handle /api/v1/heatmap\* {#handle /api/v1/heatmapx* {#'
  expect_fail 'places-without-s-maxage' '/handle \/api\/v1\/map\/places\* {/,/reverse_proxy/ s#, s-maxage=60##'
  expect_fail 'reports-made-cacheable' 's#handle /api/v1/stats/impact {#handle /api/v1/reports* {#'
  expect_fail 'd-star-cached' '/handle \/d\/\* {/,/}/ s#"no-store"#"public, max-age=60"#'
  expect_fail 'cache-header-not-deferred' '/handle \/d\/\* {/,/reverse_proxy/ s#header >Cache-Control#header Cache-Control#'
  expect_fail 'reverse-proxy-without-real-ip' '0,/import real_ip/ s#import real_ip#import common#'
  if CADDY="$CADDY" bash "$0" >/dev/null 2>&1; then
    echo "SELF-TEST ok: gate passes the real $CADDY"
  else
    echo "SELF-TEST FAIL: gate rejects the real $CADDY"; st_fail=1
  fi
  exit "$st_fail"
fi

[ -f "$CADDY" ] || { echo "FAIL: $CADDY not found"; exit 1; }

# Emit one TSV row per handle block: pattern <TAB> nth <TAB> flags
# where flags is a comma-joined set drawn from no-store,max-age,immutable,s-maxage.
# Brace depth is counted per-character so `reverse_proxy 127.0.0.1:8080 {`
# nested inside a handle does not end the block early.
parse_blocks() {
  awk '
    function flush() {
      f = ""
      if (has_nostore)   f = f "no-store,"
      if (has_maxage)    f = f "max-age,"
      if (has_immutable) f = f "immutable,"
      if (has_smaxage)   f = f "s-maxage,"
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
        has_nostore = has_maxage = has_immutable = has_smaxage = 0
      }
      # count braces on this line
      n = length(line)
      for (i = 1; i <= n; i++) {
        c = substr(line, i, 1)
        if (c == "{") depth++
        else if (c == "}") depth--
      }
      # Flags may only come from a real `header ... Cache-Control ...` DIRECTIVE.
      #
      # These three tests used to run against the raw line, so any line merely
      # CONTAINING the word set the flag, including a comment. That made the
      # gate fail open in the one direction that matters: delete
      # `header Cache-Control "no-store"` from the /d/* block, leave behind a
      # comment such as `# no-store is handled at the Cloudflare edge now`, and
      # the gate printed `PASS: /d/* is no-store and never cached` and exited 0.
      # The collar page a stranger loads over an injured dog would be cacheable,
      # with stale SOS state, and CI would call the policy intact. A `max-age`
      # regression was still caught (the `mustnot` clause), so the hole was
      # specifically "the directive is gone entirely", the exact edit a
      # well-meaning refactor makes.
      code = line
      sub(/^[[:space:]]*#.*$/, "", code)   # whole-line comment
      sub(/[[:space:]]#.*$/, "", code)     # trailing comment
      if (code ~ /Cache-Control/) {
        if (code ~ /no-store/)  has_nostore = 1
        if (code ~ /max-age/)   has_maxage = 1
        if (code ~ /immutable/) has_immutable = 1
        if (code ~ /s-maxage/)  has_smaxage = 1
      }
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
    bad "$desc: no \`handle $pat\` block found at all (renamed or deleted?)"
    return
  fi
  local n flags ok=1
  while IFS=$'\t' read -r _ n flags; do
    [ -n "${n:-}" ] || continue
    if [ "$must" != "-" ] && ! printf '%s' "$flags" | grep -q "$must"; then
      bad "$desc: occurrence #$n is missing $must"
      ok=0
    fi
    if [ "$mustnot" != "-" ] && printf '%s' "$flags" | grep -qE "$mustnot"; then
      bad "$desc: occurrence #$n must not set $mustnot (got: ${flags%,})"
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
# strips ETag and forces no-store on those two prefixes. Belt and braces.
require_all '/api/v1/*'         'API catch-all is no-store'         'no-store' 'max-age|immutable'

# The public care-provider directory is the one cacheable API surface: it is
# read-only reference data, identical for every caller in a ward.
require_all '/api/v1/care*'     'care* is cached for 60s'           'max-age'  '-'

# Content-addressed build output; safe to cache for a year.
require_all '/_next/static/*'   '_next/static is immutable'         'immutable' '-'

# Feeder-uploaded dog photos, served off disk. The filename is a random UUID so
# the bytes never change, and a photo is orders of magnitude larger than any JSON
# response on this box -- it is the single biggest caching win available, so a
# regression to no-store is worth failing the build over. Present on BOTH vhosts:
# hetja.in serves the same-origin path and api.hetja.in is what
# apps/web/lib/api.ts actually builds photo URLs against.
require_all '/photos/*'         'photos are immutable'              'immutable' '-'

# Public read-only reference data, cached 60 s at the browser AND at
# Cloudflare (audit T17). Each must exist on both vhosts (hetja.in and
# api.hetja.in) and must not be no-store (that would silently throw the
# origin offload away) or immutable (these change).
for pat in '/api/v1/wards' '/api/v1/map/wards' '/api/v1/map/places*' '/api/v1/stats/impact' '/api/v1/heatmap*'; do
  require_all "$pat" "$pat is cached for 60s (browser + edge)" 's-maxage' 'no-store|immutable'
  n=$(printf '%s\n' "$BLOCKS" | awk -F'\t' -v p="$pat" '$1 == p' | grep -c . || true)
  if [ "$n" -ge 2 ]; then
    pass "$pat declared on both vhosts ($n handles)"
  else
    bad "$pat declared $n time(s); expected one handle on hetja.in and one on api.hetja.in"
  fi
done

# Ward DETAIL is live and per-viewer: GET /api/v1/map/wards/<id> returns the
# signed-in responder's own SOS options (apps/api map.ts answers it with
# private, no-store). It gets its own explicit no-store handle, so the ward
# LIST's cache rule can never be widened onto it by accident.
require_all '/api/v1/map/wards/*' 'ward detail is no-store'       'no-store' 'max-age|immutable'

# The general rule behind the one above: no CACHEABLE handle, on any vhost,
# may match a path that carries live or per-viewer state. Matching is glob
# style like Caddy's path matcher (`*` spans slashes; Caddy also matches
# case-insensitively, hence the lowercasing). This is what catches a
# `handle /api/v1/map/wards* {` or `handle /api/v1/reports* {` edit that the
# per-pattern checks above would not notice.
LIVE_PATHS='/api/v1/map/wards/k-west /api/v1/map/wards/ /api/v1/sos /api/v1/sos/cases/x /api/v1/sos/cases/x/ack /api/v1/reports /api/v1/reports/x/status /api/v1/dogs /api/v1/dogs/abc /api/v1/dogs/abc/medical /d/abc123xyz /d/'
live_ok=1
while IFS=$'\t' read -r bpat n flags; do
  [ -n "${bpat:-}" ] || continue
  [ "$bpat" = "(catch-all)" ] && continue
  printf '%s' "$flags" | grep -qE 'max-age|immutable' || continue
  lpat=$(printf '%s' "$bpat" | tr '[:upper:]' '[:lower:]')
  for lp in $LIVE_PATHS; do
    # Unquoted right-hand side on purpose: it is the glob.
    # shellcheck disable=SC2053
    if [[ "$lp" == $lpat ]]; then
      bad "cacheable \`handle $bpat\` #$n would match live path $lp (${flags%,})"
      live_ok=0
    fi
  done
done <<< "$BLOCKS"
[ "$live_ok" -eq 1 ] && pass "no cacheable handle matches a live-state path (ward detail, /sos, /reports, /dogs, /d/)"

# Every Cache-Control header must be the DEFERRED form `header >Cache-Control`.
# The immediate form `header Cache-Control` is applied before reverse_proxy,
# which then ADDS the upstream's own Cache-Control beside it: measured on caddy
# 2.11.4 against a stub upstream, /d/abc went out with both `no-store` and the
# upstream's `public, max-age=86400`. Deferred, Caddy's value replaces it.
undeferred=$(grep -nE '^[[:space:]]*header[[:space:]]+Cache-Control[[:space:]]' "$CADDY" || true)
if [ -z "$undeferred" ]; then
  pass "every Cache-Control header is deferred (replaces the upstream's)"
else
  bad "Cache-Control set without '>' (the upstream's value would be sent too):"
  printf '%s\n' "$undeferred" | sed 's/^/       /'
fi

# If anyone ever adds an explicit handler for the dog API, the SOS API or the
# report API, it must be no-store too: these carry live case state. Absent is
# fine (the catch-all covers them), which is why this is a conditional check
# rather than require_all.
for pat in '/api/v1/dogs*' '/api/v1/dogs/*' '/api/v1/sos*' '/api/v1/sos/*' '/api/v1/reports*' '/api/v1/reports/*'; do
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
# reverts to seeing loopback. Directive lines only: a comment that merely
# mentions reverse_proxy must not skew the count either way.
proxies=$(grep -cE '^[[:space:]]*reverse_proxy[[:space:]]' "$CADDY" || true)
realips=$(grep -cE '^[[:space:]]*import[[:space:]]+real_ip[[:space:]]*$' "$CADDY" || true)
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
