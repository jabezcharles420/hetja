#!/bin/bash
# Config-as-code gate for the browser security headers in ops/caddy/Caddyfile
# (audit T10). Sibling of ops/check-caddy-cache.sh and built the same way:
# it parses blocks by brace depth, reads only real directive lines (never
# comments), fails on a MISSING header rather than passing vacuously, and has
# a --self-test that proves it fails on deliberately broken copies.
#
# What it pins:
#   (common) snippet, sent on every vhost:
#     Permissions-Policy       exactly the audited value below
#     Cross-Origin-Opener-Policy "same-origin"
#     plus the pre-existing HSTS / nosniff / X-Frame-Options / Referrer-Policy
#   every site block imports (common)
#   hetja.in (the only vhost that serves pages): a Content-Security-Policy,
#     report-only for now (enforcing is also accepted, so promoting it later
#     does not need this gate changed), carrying the directives and origins
#     the apps actually depend on. A missing origin here means a broken map,
#     scanner or embed the day the policy is enforced.
set -u
cd "$(dirname "$0")/.."
CADDY=${CADDY:-ops/caddy/Caddyfile}

PERMISSIONS_POLICY='camera=(self), geolocation=(self), microphone=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), browsing-topics=()'

if [ "${1:-}" = "--self-test" ]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  st_fail=0
  expect_fail() { # <name> <sed-expression>
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
  expect_fail 'no-permissions-policy'       '/^[[:space:]]*Permissions-Policy /d'
  expect_fail 'permissions-policy-commented' 's/^\([[:space:]]*\)Permissions-Policy /\1# Permissions-Policy /'
  expect_fail 'camera-for-everyone'         's/camera=(self)/camera=*/'
  expect_fail 'microphone-allowed'          's/microphone=()/microphone=(self)/'
  expect_fail 'no-coop'                     '/^[[:space:]]*Cross-Origin-Opener-Policy /d'
  expect_fail 'coop-unsafe-none'            's/Cross-Origin-Opener-Policy "same-origin"/Cross-Origin-Opener-Policy "unsafe-none"/'
  expect_fail 'no-hsts'                     '/^[[:space:]]*Strict-Transport-Security /d'
  expect_fail 'no-csp'                      '/^[[:space:]]*header Content-Security-Policy-Report-Only /d'
  expect_fail 'csp-without-frame-ancestors' "s/ frame-ancestors 'none';//"
  expect_fail 'csp-without-youtube-frame'   's# frame-src https://www.youtube-nocookie.com;##'
  expect_fail 'csp-without-esri-tiles'      's# https://static-map-tiles-api.arcgis.com##'
  expect_fail 'csp-without-wasm'            "s/ 'wasm-unsafe-eval'//"
  expect_fail 'csp-object-src-allowed'      "s/object-src 'none'/object-src *;/"
  expect_fail 'hetja-in-without-common'     '/^http:\/\/hetja.in {/,/import common/ s/import common/import real_ip/'
  if CADDY="$CADDY" bash "$0" >/dev/null 2>&1; then
    echo "SELF-TEST ok: gate passes the real $CADDY"
  else
    echo "SELF-TEST FAIL: gate rejects the real $CADDY"; st_fail=1
  fi
  exit "$st_fail"
fi

[ -f "$CADDY" ] || { echo "FAIL: $CADDY not found"; exit 1; }

fail=0
pass() { echo "PASS: $1"; }
bad()  { echo "FAIL: $1"; fail=1; }

# block <ERE for the opening line>: print the body of the FIRST top-level block
# whose opening line matches, comments stripped, braces tracked per character.
block() {
  RE="$1" awk '
    BEGIN { re = ENVIRON["RE"] }
    {
      line = $0
      sub(/^[[:space:]]*#.*$/, "", line)
      sub(/[[:space:]]#.*$/, "", line)
      if (!inb && depth == 0 && line ~ re) { inb = 1 }
      n = length(line)
      for (i = 1; i <= n; i++) {
        c = substr(line, i, 1)
        if (c == "{") depth++
        else if (c == "}") depth--
      }
      if (inb) print line
      if (inb && depth == 0) exit
    }
  ' "$CADDY"
}

# header_value <block-text> <Header-Name>: the quoted value of the one
# `Header-Name "..."` (or `header Header-Name "..."`) directive in the block.
header_value() {
  printf '%s\n' "$1" | sed -nE "s/^[[:space:]]*(header[[:space:]]+)?$2[[:space:]]+\"(.*)\"[[:space:]]*\$/\\2/p"
}

COMMON=$(block '^\(common\)[[:space:]]*\{')
if [ -z "$COMMON" ]; then
  bad "no (common) snippet in $CADDY"
else
  pp=$(header_value "$COMMON" 'Permissions-Policy')
  if [ "$pp" = "$PERMISSIONS_POLICY" ]; then
    pass "(common) Permissions-Policy is the audited value"
  elif [ -z "$pp" ]; then
    bad "(common) has no Permissions-Policy"
  else
    bad "(common) Permissions-Policy drifted: got \"$pp\", want \"$PERMISSIONS_POLICY\""
  fi

  coop=$(header_value "$COMMON" 'Cross-Origin-Opener-Policy')
  if [ "$coop" = "same-origin" ]; then
    pass "(common) Cross-Origin-Opener-Policy is same-origin"
  else
    bad "(common) Cross-Origin-Opener-Policy must be \"same-origin\" (got \"${coop:-<missing>}\")"
  fi

  for pair in 'Strict-Transport-Security|max-age=31536000; includeSubDomains' \
              'X-Content-Type-Options|nosniff' \
              'X-Frame-Options|DENY' \
              'Referrer-Policy|strict-origin-when-cross-origin'; do
    name=${pair%%|*}; want=${pair#*|}
    got=$(header_value "$COMMON" "$name")
    if [ "$got" = "$want" ]; then pass "(common) $name: $want"; else bad "(common) $name must be \"$want\" (got \"${got:-<missing>}\")"; fi
  done
fi

# Every site block must import (common), or that hostname ships none of it.
sites=$(grep -E '^http://[^[:space:]]+[[:space:]]*\{' "$CADDY" | sed -E 's/[[:space:]]*\{.*$//')
if [ -z "$sites" ]; then
  bad "no http:// site blocks found"
fi
for site in $sites; do
  esc=$(printf '%s' "$site" | sed 's/[.]/[.]/g')
  body=$(block "^${esc}[[:space:]]*\\{")
  if printf '%s\n' "$body" | grep -qE '^[[:space:]]*import[[:space:]]+common[[:space:]]*$'; then
    pass "$site imports (common)"
  else
    bad "$site does not import (common): it would ship without the security headers"
  fi
done

# hetja.in: the Content-Security-Policy.
HETJA=$(block '^http://hetja[.]in[[:space:]]*\{')
csp=$(printf '%s\n' "$HETJA" | sed -nE 's/^[[:space:]]*header[[:space:]]+Content-Security-Policy(-Report-Only)?[[:space:]]+"(.*)"[[:space:]]*$/\2/p' | head -1)
if [ -z "$csp" ]; then
  bad "hetja.in has no Content-Security-Policy(-Report-Only) header"
else
  pass "hetja.in sends a Content-Security-Policy ($(printf '%s\n' "$HETJA" | grep -oE 'Content-Security-Policy(-Report-Only)?' | head -1))"
  # directive <name>: its source list, space-padded so ' x ' matching is exact.
  directive() { printf '%s' "$csp" | tr ';' '\n' | sed -nE "s/^[[:space:]]*$1[[:space:]]+(.*)\$/ \\1 /p" | head -1; }
  # need <directive> <source>...
  need() {
    local d=$1; shift
    local list; list=$(directive "$d")
    if [ -z "$list" ]; then bad "CSP has no $d"; return; fi
    local s missing=""
    for s in "$@"; do
      case "$list" in *" $s "*) ;; *) missing="$missing $s" ;; esac
    done
    if [ -z "$missing" ]; then pass "CSP $d allows:$(printf ' %s' "$@")"; else bad "CSP $d is missing:$missing"; fi
  }
  # exactly <directive> <value>: for the lock-down directives.
  exactly() {
    local got; got=$(directive "$1" | sed -E 's/^ +| +$//g')
    if [ "$got" = "$2" ]; then pass "CSP $1 $2"; else bad "CSP $1 must be exactly $2 (got \"${got:-<missing>}\")"; fi
  }
  exactly default-src     "'self'"
  exactly frame-ancestors "'none'"
  exactly object-src      "'none'"
  exactly base-uri        "'self'"
  exactly form-action     "'self'"
  need script-src  "'self'" "'wasm-unsafe-eval'" https://fastly.jsdelivr.net https://cdn.jsdelivr.net
  need style-src   "'self'" https://fonts.googleapis.com
  need img-src     "'self'" data: blob: https://api.hetja.in https://static-map-tiles-api.arcgis.com 'https://*.basemaps.cartocdn.com'
  need connect-src "'self'" https://api.hetja.in 'https://*.supabase.co' https://fastly.jsdelivr.net
  need font-src    "'self'" https://fonts.gstatic.com
  need frame-src   https://www.youtube-nocookie.com
  need worker-src  "'self'" blob:
  # A wildcard source anywhere defeats the policy.
  if printf '%s' "$csp" | tr ';' '\n' | grep -qE "(^|[[:space:]])(\*|https:|http:)([[:space:]]|\$)"; then
    bad "CSP contains a bare *, https: or http: source"
  else
    pass "CSP has no bare wildcard source"
  fi
fi

if [ "$fail" -eq 0 ]; then
  echo "PASS: Caddy security headers intact"
  exit 0
fi
exit 1
