#!/bin/bash
# Destructive-change gate for migration files (AGENTS.md §g).
#
# Fails on DROP / TRUNCATE / DELETE FROM in a migration unless the file carries
# an explicit `-- MIGRATION-APPROVED: <reason>` line. Additive changes flow
# through untouched. Usage:
#
#     ops/check-destructive-migrations.sh packages/db/migrations/00xx_foo.sql ...
#     ops/check-destructive-migrations.sh              # all migrations
#
# EXTRACTED FROM .github/workflows/deploy.yml, where this logic lived inline as
# a 40-line `run:` block. That placement had two costs. It could not be run
# before pushing — the only way to learn a migration would be rejected was to
# push and watch the Migrate job go red — and it could not be tested, so the
# comment-stripping bug below survived unnoticed in the one gate AGENTS.md
# describes as having "no override except an explicit human marker".
#
# THE BUG THIS REPLACES: comments were stripped with `sed -e 's/--.*$//'`, which
# deletes from the first `--` to end of line unconditionally. SQL string
# literals routinely contain `--`, and everything after one on that physical
# line vanished from what the gate inspected:
#
#     INSERT INTO notes(t) VALUES ('a -- b'); DROP TABLE medical_records;
#
# stripped to `INSERT INTO notes(t) VALUES ('a `, so the gate saw no DROP and
# passed. An unattended `DROP TABLE medical_records` then reached the Apply
# step — against an append-only table whose loss is not recoverable.
#
# The stripper below is a character-level state machine that only treats `--` as
# a comment when it is OUTSIDE a single-quoted string and outside a
# dollar-quoted block ($$ ... $$, which 0015 uses for its DO block). That is the
# fail-CLOSED direction: real SQL is never removed from what gets inspected.
set -uo pipefail

# Resolve arguments against the CALLER's directory before cd-ing to the repo
# root, so `cd packages/db && ../../ops/check-destructive-migrations.sh
# migrations/0016_*.sql` means what it looks like it means.
FILES=()
for arg in "$@"; do
  case "$arg" in
    /*) FILES+=("$arg") ;;
    *)  FILES+=("$PWD/$arg") ;;
  esac
done

cd "$(dirname "$0")/.." || exit 1
[ "${#FILES[@]}" -gt 0 ] || FILES=(packages/db/migrations/*.sql)

# Reads a .sql file, emits it as ONE lowercase line with comments removed and
# newlines collapsed to spaces, so a statement split across lines is still seen
# as one and `;` remains the statement boundary.
strip_sql_comments() {
  awk '
    # sq: inside a single-quoted SQL string. dq: inside a dollar-quoted block.
    BEGIN { sq = 0; dq = 0 }
    {
      line = $0; n = length(line); i = 1; out = ""
      while (i <= n) {
        c  = substr(line, i, 1)
        c2 = substr(line, i, 2)
        if (sq) {
          out = out c
          # "" inside a single-quoted string is an escaped quote, not the end.
          if (c == "\047") {
            if (substr(line, i + 1, 1) == "\047") { out = out "\047"; i += 2; continue }
            sq = 0
          }
          i++
        } else if (dq) {
          out = out c
          if (c2 == "$$") { out = out "$"; dq = 0; i += 2; continue }
          i++
        } else if (c2 == "$$") {
          out = out c2; dq = 1; i += 2
        } else if (c == "\047") {
          out = out c; sq = 1; i++
        } else if (c2 == "--") {
          break                        # a real comment: discard to end of line
        } else {
          out = out c; i++
        }
      }
      printf "%s ", out
    }
  ' "$1" | tr '[:upper:]' '[:lower:]'
}

fail=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "FAIL: $f not found"; fail=1; continue; }

  # Destructive STATEMENTS only -- not the mere appearance of the words.
  # `GRANT ... DELETE`, `ON DELETE CASCADE`, `DROP DEFAULT`, `DROP NOT NULL` and
  # a `deleted_at` column are ordinary DDL and must not trip this, or the
  # approval marker becomes noise people paste in reflexively -- at which point
  # the gate protects nothing. Two further exemptions, both from real migrations:
  #
  #   * `REVOKE TRUNCATE` / `BEFORE TRUNCATE` -- removing the privilege, or
  #     adding a trigger forbidding it, is the OPPOSITE of destructive. So
  #     TRUNCATE only counts at the start of a statement.
  #   * `DROP TRIGGER IF EXISTS` / `DROP FUNCTION IF EXISTS` before CREATE is
  #     the standard idempotent-redefinition idiom and carries no data. A DROP
  #     without `IF EXISTS` still counts, as does every DROP of a data-bearing
  #     object.
  BODY="$(strip_sql_comments "$f" \
          | sed -e 's/drop[[:space:]]\{1,\}trigger[[:space:]]\{1,\}if[[:space:]]\{1,\}exists/ /g' \
                -e 's/drop[[:space:]]\{1,\}function[[:space:]]\{1,\}if[[:space:]]\{1,\}exists/ /g')"

  if printf '%s' "$BODY" | grep -qE '(^|;)[[:space:]]*truncate[[:space:]]|drop[[:space:]]+(table|column|schema|database|view|materialized|index|constraint|type|function|trigger|extension|sequence)|delete[[:space:]]+from'; then
    if grep -qE -- '-- MIGRATION-APPROVED:[[:space:]]*\S' "$f"; then
      echo "OK (approved): $f"
      grep -nE -- '-- MIGRATION-APPROVED:' "$f"
    else
      echo "::error file=$f::destructive statement (DROP/TRUNCATE/DELETE) found with no '-- MIGRATION-APPROVED: <reason>' line in this file. medical_records is append-only and a bad migration against Supabase is not reversible -- this needs an explicit human sign-off marker in the SQL file itself, not just a passing test suite."
      fail=1
    fi
  else
    echo "OK (additive): $f"
  fi
done

exit "$fail"
