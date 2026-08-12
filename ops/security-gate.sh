#!/bin/bash
# security-gate.sh — CI security checklist (from the blueprint's cross-cutting
# gates). Each check is a hard failure if violated.
set -u
cd "$(dirname "$0")/.."
fail=0
check() {  # check <desc> <cmd...>
  local desc=$1; shift
  if "$@" >/dev/null 2>&1; then echo "PASS: $desc"; else echo "FAIL: $desc"; fail=1; fi
}

# No phone column anywhere (only phone_hmac) — INVARIANT 3
check "no bare 'phone' column in migrations" \
  bash -c "! grep -riE 'CREATE TABLE.*phone\b|\bphone\s+(TEXT|VARCHAR)' packages/db/migrations/ 2>/dev/null"

# No secret-looking strings committed (API keys, private keys)
check "no private keys in repo" \
  bash -c "! grep -rE 'BEGIN (RSA|OPENSSH|EC) PRIVATE KEY' --include='*' . 2>/dev/null | grep -v node_modules"
check "no sk- API keys in repo" \
  bash -c "! grep -rE 'sk-[A-Za-z0-9]{20,}' --include='*.ts' --include='*.json' --include='*.env*' . 2>/dev/null | grep -v node_modules"

# Env files must not be committed
check "no .env committed" \
  bash -c "! git ls-files 2>/dev/null | grep -qE '(^|/)\.env$'"

# Geo coarsening: no anonymous endpoint exposes >2 decimals (checked in
# contracts tests, but grep the API for suspicious raw-point returns)
# INVARIANT 2: reading a coordinate is fine, RETURNING an uncoarsened one is
# not. Any route touching ST_X/ST_Y must either coarsen it (coarsenToWard, or
# round() in SQL) or declare why its coordinates are legitimately public:
#   // SECURITY-GATE: public-coordinates -- <reason>
#
# The response-level form of this invariant is already asserted by
# apps/api/src/routes/dogs.test.ts ("returns ward-level geo only (<=2 decimals)"),
# which is the check that actually binds. This one catches a new route that
# reads coordinates and forgets to coarsen them before returning.
check "every route touching ST_X/ST_Y coarsens or justifies it" \
  bash -c '
    bad=""
    for f in $(grep -rlE "ST_X\(|ST_Y\(" apps/api/src/routes/ 2>/dev/null | grep -v "\.test\."); do
      grep -qE "coarsenToWard|round\(|SECURITY-GATE: public-coordinates" "$f" || bad="$bad $f"
    done
    [ -z "$bad" ] || { echo "    uncoarsened:$bad"; false; }
  '

# Ledger append-only: app_user revoke present in migration
check "medical_records append-only REVOKE present" \
  bash -c "grep -q 'REVOKE UPDATE, DELETE ON medical_records' packages/db/migrations/0001_init.sql"

# Random slugs: generator present + tested
check "slug generator tested" \
  bash -c "grep -q 'isValidSlug' packages/db/src/slugs.test.ts"

exit $fail
