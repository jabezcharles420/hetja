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
check "no ST_X/ST_Y raw point in API routes" \
  bash -c "! grep -rE 'ST_X\(|ST_Y\(' apps/api/src/routes/ 2>/dev/null"

# Ledger append-only: app_user revoke present in migration
check "medical_records append-only REVOKE present" \
  bash -c "grep -q 'REVOKE UPDATE, DELETE ON medical_records' packages/db/migrations/0001_init.sql"

# Random slugs: generator present + tested
check "slug generator tested" \
  bash -c "grep -q 'isValidSlug' packages/db/src/slugs.test.ts"

exit $fail
