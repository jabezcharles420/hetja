#!/bin/bash
# check-queries.sh — CI gate (INVARIANT 12): every documented query in
# docs/queries/ must EXPLAIN against the committed schema.
# Parametrized queries get per-query sample args (valid literals for the
# parameter types), prepared then EXPLAIN EXECUTE'd. Exit 1 on any failure.
set -u
cd "$(dirname "$0")/.."
PGHOST=${PGHOST:-127.0.0.1} PGPORT=${PGPORT:-5432} PGDATABASE=${PGDATABASE:-straynet}
PGUSER=${PGUSER:-app_user} PGPASSWORD=${PGPASSWORD:-straynet_dev_2026}

sample_args() {  # per-query sample parameters (count must match $n)
  case "$1" in
    sos_fanout.sql) echo "'0101000020E610000048E17A14AE37524052B81E85EB113340', 40" ;;
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
  if PGPASSWORD="$PGPASSWORD" psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -c "$sql" >/dev/null 2>&1; then
    echo "EXPLAIN OK: $name"
  else
    echo "EXPLAIN FAIL: $name"
    fail=1
  fi
done
exit $fail
