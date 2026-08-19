#!/bin/bash
# check-queries.sh — CI gate (INVARIANT 12): every documented query in
# docs/queries/ must EXPLAIN against the committed schema.
# Parametrized queries get per-query sample args (valid literals for the
# parameter types), prepared then EXPLAIN EXECUTE'd. Exit 1 on any failure.
set -u
cd "$(dirname "$0")/.."
# Defaults target a DISPOSABLE TEST database, not production.
#
# This used to default to PGDATABASE=hetja -- the live database -- with a
# hard-coded 64-hex password literal on this line. Two problems, both real:
#
#   1. The password was a rotated app_user credential, committed to a public
#      AGPL repository. It is dead now (authentication fails), but it was the
#      reason this gate reported "EXPLAIN FAIL" on all five queries: they were
#      failing to AUTHENTICATE, not failing to EXPLAIN. Every query in
#      docs/queries/ plans fine. An operator reading the old output went hunting
#      a schema divergence that did not exist.
#   2. A CI gate whose default target is production is one typo away from being
#      a production query. EXPLAIN/PREPARE do not execute, so it was read-only in
#      practice -- but the default should not need that argument to be safe.
#
# hetja_test matches what apps/api/vitest.setup.ts insists on, so a developer who
# has bootstrapped a test database per AGENTS.md section f can run this bare.
PGHOST=${PGHOST:-127.0.0.1} PGPORT=${PGPORT:-5432} PGDATABASE=${PGDATABASE:-hetja_test}
PGUSER=${PGUSER:-app_user} PGPASSWORD=${PGPASSWORD:-}

sample_args() {  # per-query sample parameters (count must match $n)
  case "$1" in
    sos_fanout.sql) echo "'0101000020E610000048E17A14AE37524052B81E85EB113340', 40" ;;
    # dog_id is uuid, so the default 'x' literal fails the cast rather than the
    # query -- which would report a schema problem that is really a fixture one.
    ledger_dog_leaves.sql) echo "'00000000-0000-0000-0000-000000000000'::uuid" ;;
    *) echo "'x'" ;;
  esac
}

fail=0
for q in docs/queries/*.sql; do
  name=$(basename "$q")
  n=$(grep -o '\$[0-9]' "$q" | sort -u | wc -l)
  if [ "$n" -gt 0 ]; then
    args=$(sample_args "$name")
    sql="PREPARE q AS $(cat "$q"); EXPLAIN EXECUTE q($args); DEALLOCATE q;"
  else
    sql="EXPLAIN $(cat "$q")"
  fi
  # stderr is CAPTURED, not discarded, and printed on failure. Sending it to
  # /dev/null is what turned an authentication error into the indistinguishable
  # message "EXPLAIN FAIL: heatmap.sql" -- a gate that hides why it failed costs
  # more time than it saves.
  if err=$(PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" \
             -v ON_ERROR_STOP=1 -c "$sql" 2>&1 >/dev/null); then
    echo "EXPLAIN OK: $name"
  else
    echo "EXPLAIN FAIL: $name"
    printf '%s\n' "$err" | sed 's/^/       /'
    fail=1
  fi
done
exit $fail
