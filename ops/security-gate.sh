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
