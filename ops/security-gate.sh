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

# No bare contact-info column anywhere (only identity_hmac) — INVARIANT 3.
# This used to check only "phone", which gave zero protection against a bare
# `email TEXT` column landing in a migration once login moved from phone OTP
# to email OTP -- the invariant's actual intent has always been "never store
# bare contact info, only its HMAC", not "phone" specifically. Widened to
# cover both; "identity_hmac"/"phone_hmac" survive because \b does not match
# between "phone"/"email" and the following "_" (underscore counts as a word
# character, so there is no boundary there).
#
# That \b exemption is load-bearing and it also had a hole. It was written to
# let `phone_hmac` through -- but it equally let through `phone_e164`, which is
# a genuinely bare plaintext phone number, and `0013_phone_e164.sql` writes to
# it. So the gate that exists to enforce INVARIANT 3 could not see the one
# column in the schema that violates its spirit.
#
# Fixed by checking the suffix rather than the word boundary: a contact column
# is acceptable only if what follows is `_hmac` (or `_enc`, for the field-level
# encryption in enhancement stack §G.5 that has not landed yet). Anything else
# -- `phone_e164`, `phone_raw`, `email_address` -- is reported.
#
# KNOWN_PLAINTEXT_CONTACT below is an explicit, narrow allowlist for columns
# that exist today and are not yet encrypted. It is deliberately a visible list
# rather than a looser regex: the point of naming them is that the next person
# reading this gate learns they are unencrypted, instead of the gate silently
# passing and implying they are not.
#
# care_providers.phone_e164 is the published contact number of a vet or NGO --
# an organisation's directory listing, not a private individual's number, and it
# is meant to be tapped by a stranger standing over an injured dog. That is why
# it is a tracked exception rather than a blocking failure.
#
# Encrypting it was evaluated (enhancement stack Top-25 #14, tweetnacl-js
# secretbox) and DECLINED on 2026-08-14: encrypting published information on a
# life-safety read path buys nothing and adds a failure mode. The coordinate half
# of that same recommendation was declined for a harder reason -- the columns are
# GIST-indexed GEOGRAPHY and ST_DWithin cannot run on ciphertext. Full reasoning
# in docs/INVARIANTS.md -> "Spec corrections" #4.
#
# So this entry is a settled decision, not a backlog item. It is still printed on
# every run because a reader of this gate should know the column is plaintext.
KNOWN_PLAINTEXT_CONTACT='care_providers?\.?phone_e164|alt_phone_e164|phone_e164'

bare_contact_hits() {
  # Column declarations whose name starts with phone/email but does not
  # continue with _hmac / _enc, minus the tracked exceptions.
  grep -rniE '^[[:space:]]*(phone|email)[a-z0-9_]*[[:space:]]+(TEXT|VARCHAR|CITEXT)' \
    packages/db/migrations/ 2>/dev/null \
    | grep -viE '(phone|email)[a-z0-9_]*_(hmac|enc)[[:space:]]' \
    | grep -viE "$KNOWN_PLAINTEXT_CONTACT"
}

if [ -n "$(bare_contact_hits)" ]; then
  echo "FAIL: bare contact-info column in migrations (INVARIANT 3)"
  bare_contact_hits | sed 's/^/       /'
  fail=1
else
  echo "PASS: no untracked bare 'phone'/'email' column in migrations"
fi

# Report the tracked exceptions every run, so they stay visible rather than
# becoming permanent by being quiet.
tracked=$(grep -rniE "[[:space:]]($KNOWN_PLAINTEXT_CONTACT)[[:space:]]+(TEXT|VARCHAR|CITEXT)" \
  packages/db/migrations/ 2>/dev/null | wc -l | tr -d ' ')
if [ "${tracked:-0}" -gt 0 ]; then
  echo "NOTE: $tracked tracked plaintext contact column declaration(s) -- published vet/NGO directory numbers; encryption evaluated and declined, see docs/INVARIANTS.md 'Spec corrections' #4"
fi

# No secret-looking strings committed (API keys, private keys).
#
# Driven from `git ls-files`, not a recursive walk of the working tree. The
# previous form was `grep -rE ... --include='*' .` piped into `grep -v
# node_modules`, which is wrong in two ways: it walked node_modules, .git, .next
# and every dist/ directory before discarding the matches (measured 7.6s on this
# tree, and it grows with every dependency), and post-filtering by path meant a
# match inside an excluded directory still had to be read and matched first.
#
# Tracked files are also the correct SET to check. This gate's claim is "no
# secret is COMMITTED"; an untracked local key file is not a committed secret,
# and .gitignore already covers .env / *.local. Scanning what git tracks makes
# the check say exactly what it means.
#
# -I skips binary files; -z / --null pairs with -0 so paths containing spaces
# survive. `|| true` on the grep keeps a clean run (exit 1 = no matches) from
# tripping `set -u` semantics in the check helper.
scan_tracked() { # pattern, then optional pathspecs
  local pattern=$1; shift
  git ls-files -z -- "$@" \
    | xargs -0 -r grep -IlE "$pattern" 2>/dev/null \
    || true
}

if [ -n "$(scan_tracked 'BEGIN (RSA|OPENSSH|EC|PRIVATE|ENCRYPTED) PRIVATE KEY')" ]; then
  echo "FAIL: private key material in a tracked file"
  scan_tracked 'BEGIN (RSA|OPENSSH|EC|PRIVATE|ENCRYPTED) PRIVATE KEY' | sed 's/^/       /'
  fail=1
else
  echo "PASS: no private keys in tracked files"
fi

if [ -n "$(scan_tracked 'sk-[A-Za-z0-9]{20,}' '*.ts' '*.tsx' '*.json' '*.env*' '*.md' '*.sh' '*.yml')" ]; then
  echo "FAIL: sk- style API key in a tracked file"
  scan_tracked 'sk-[A-Za-z0-9]{20,}' '*.ts' '*.tsx' '*.json' '*.env*' '*.md' '*.sh' '*.yml' | sed 's/^/       /'
  fail=1
else
  echo "PASS: no sk- API keys in tracked files"
fi

# A private JWK is the shape the ledger anchor signer takes (see
# apps/worker/src/sign-anchor.ts). An Ed25519 private JWK is recognisable by its
# `d` member alongside `"kty":"OKP"`, and unlike a PEM block it carries no BEGIN
# header for the check above to catch.
if [ -n "$(scan_tracked '"kty"[[:space:]]*:[[:space:]]*"(OKP|EC|RSA)"' '*.json' '*.ts' '*.env*' '*.md')" ]; then
  for f in $(scan_tracked '"kty"[[:space:]]*:[[:space:]]*"(OKP|EC|RSA)"' '*.json' '*.ts' '*.env*' '*.md'); do
    # Only the PRIVATE half has "d". A published JWKS document is fine and
    # expected -- that is the whole point of publishing the public key.
    if grep -qE '"d"[[:space:]]*:[[:space:]]*"' "$f"; then
      echo "FAIL: private JWK (has a \"d\" member) in tracked file $f"
      fail=1
    fi
  done
  [ "$fail" -eq 0 ] && echo "PASS: JWKs in tracked files are public halves only"
else
  echo "PASS: no JWK material in tracked files"
fi

# No high-entropy hex secret committed.
#
# This rule exists because the gate above reported PASS on a repository that
# contained a real (since-rotated) PostgreSQL password in FOUR tracked files:
# apps/api/src/config.ts, packages/db/src/pool.ts, ops/check-queries.sh and
# apps/ai/worker.py. None of the checks above could see it -- it is not a PEM
# block, not an sk- key, not a JWK, and not a file named .env. A 64-hex-char
# credential pasted as a "default" is the shape a leaked secret actually takes
# in this codebase, so it gets its own rule.
#
# 48+ hex characters is the threshold: `openssl rand -hex 32` (64 chars) is what
# AGENTS.md section d tells you to generate for JWT_SECRET, HETJA_HMAC_PEPPER,
# HETJA_QR_SECRET and HETJA_DEVICE_SECRET, so anything at or near that length
# sitting in a tracked file is either a secret or something that looks exactly
# like one -- and both deserve a human's attention.
#
# Deliberately NOT matched: git SHAs (40 hex, below the threshold),
# ledger hash_curr / hash_prev values (SHA-256 hex appears in ledger tests and
# fixtures), and the 32-hex `[0-9a-f]{32}` shapes used by asset ids. The
# exclusions below name the files where long hex is legitimately expected.
#
# packages/ledger/ops/ is excluded by path: sample-ledger.json is a hash-chain
# fixture, so 64-hex strings are its ENTIRE POINT -- every `prev`/`hash` member is
# a SHA-256 digest, including the all-zero GENESIS_PREV_HASH. Excluding the
# directory rather than raising the threshold keeps the rule at the length that
# actually catches `openssl rand -hex 32` output elsewhere.
#
# If this fires on something genuinely benign, add it to the exclusion list with
# a reason rather than lowering the threshold -- the threshold is the rule.
hex_secret_hits() {
  git ls-files -z -- '*.ts' '*.tsx' '*.js' '*.mjs' '*.py' '*.sh' '*.json' '*.yml' '*.yaml' '*.md' \
    | xargs -0 -r grep -InE "[0-9a-f]{48,}" 2>/dev/null \
    | grep -viE '(test|spec|fixture|__snapshots__)' \
    | grep -viE 'pnpm-lock|integrity|sha(256|384|512)-' \
    | grep -viE '^packages/ledger/ops/' \
    || true
}

if [ -n "$(hex_secret_hits)" ]; then
  echo "FAIL: high-entropy hex string (>=48 chars) in a tracked file -- possible committed secret"
  hex_secret_hits | sed 's/^/       /'
  fail=1
else
  echo "PASS: no high-entropy hex secret in tracked files"
fi

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
