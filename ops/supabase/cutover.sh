#!/bin/bash
# ---------------------------------------------------------------------------
# cutover.sh — stand up a Hetja database on a fresh Supabase project.
#
# Why this exists: a Supabase project's region is fixed at creation, so moving
# regions means creating a new project and migrating into it. The pilot project
# was in ap-southeast-1 (Singapore) while the app server is in Europe and the
# users are in Mumbai — a measured 154 ms per warm query against a 150 ms p95
# gateway SLO, which the dog-profile path multiplies by four.
#
# Usage:
#   PROJECT_REF=abcdefghijklmnop DB_PASSWORD='...' ./cutover.sh [--repoint]
#
#   --repoint   also rewrite apps/api/.env.production to use this project and
#               restart the API. Omit for a dry stand-up you can verify first.
#
# Idempotent: every step is ON CONFLICT / IF NOT EXISTS / CREATE OR REPLACE.
# ---------------------------------------------------------------------------
set -uo pipefail
export LANG=C.UTF-8
cd "$(dirname "$0")/../.." || exit 1
REPO="$(pwd)"

: "${PROJECT_REF:?set PROJECT_REF to the Supabase project ref (dashboard URL segment)}"
: "${DB_PASSWORD:?set DB_PASSWORD to the project database password}"
REPOINT="${1:-}"

clean() { grep -v '^perl:' | grep -v 'LC_\|LANGUAGE\|LANG =\|supported\|Falling back'; }
say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

# --- find a reachable pooler in ap-south-1 ---------------------------------
# The direct host db.<ref>.supabase.co is IPv6-only, which fails on an IPv4-only
# box. A wrong region answers "ENOTFOUND tenant/user", which is how the pilot
# project's true region was discovered.
say "locating the ap-south-1 pooler"
HOST=""
for pre in aws-0 aws-1; do
  for port in 5432 6543; do
    h="$pre-ap-south-1.pooler.supabase.com"
    getent hosts "$h" >/dev/null 2>&1 || continue
    if PGPASSWORD="$DB_PASSWORD" psql \
         "host=$h port=$port user=postgres.$PROJECT_REF dbname=postgres sslmode=require connect_timeout=12" \
         -tAc 'select 1' >/dev/null 2>&1; then
      HOST="$h"; PORT="$port"; break 2
    fi
  done
done

if [ -z "$HOST" ]; then
  echo "FAILED: no ap-south-1 pooler accepted this project." >&2
  echo "  Confirm the project really is in ap-south-1 (Mumbai) and that the" >&2
  echo "  password is the DATABASE password, not an API key." >&2
  exit 1
fi
echo "    $HOST:$PORT"

PG="host=$HOST port=$PORT user=postgres.$PROJECT_REF dbname=postgres sslmode=require connect_timeout=25"
run() { PGPASSWORD="$DB_PASSWORD" psql "$PG" "$@" 2>&1 | clean; }
q()   { PGPASSWORD="$DB_PASSWORD" psql "$PG" -tAc "$1" 2>&1 | clean; }

say "target server"
q "select version()" | cut -c1-60 | sed 's/^/    /'

EXISTING=$(q "select count(*) from information_schema.tables where table_schema='public'")
if [ "${EXISTING:-0}" -gt 1 ]; then
  echo "    NOTE: public schema already has $EXISTING tables — steps are idempotent,"
  echo "          but check this is the project you meant."
fi

# --- schema, data, hardening ----------------------------------------------
say "01_schema.sql"
run -v ON_ERROR_STOP=1 -q -f "$REPO/ops/supabase/01_schema.sql" | tail -3 || exit 1

say "04_seed_real.sql (5 dogs with their real collar slugs)"
run -v ON_ERROR_STOP=1 -q -f "$REPO/ops/supabase/04_seed_real.sql" | tail -3 || exit 1

say "03_hardening.sql (RLS, append-only trigger, signature-gated RPCs)"
run -v ON_ERROR_STOP=1 -q -f "$REPO/ops/supabase/03_hardening.sql" | tail -3 || exit 1

# --- the QR secret --------------------------------------------------------
# Must match the API's HETJA_QR_SECRET byte for byte, or every collar
# signature check fails. Passed via a psql variable so it never lands in a file
# or in shell history.
say "seeding private.app_secrets.qr_secret"
QR=$(grep '^HETJA_QR_SECRET=' "$REPO/apps/api/.env.production" | cut -d= -f2-)
if [ -z "$QR" ]; then
  echo "    FAILED: HETJA_QR_SECRET missing from apps/api/.env.production" >&2
  exit 1
fi
PGPASSWORD="$DB_PASSWORD" psql "$PG" -q -v qr="$QR" \
  -c "INSERT INTO private.app_secrets (name, value) VALUES ('qr_secret', :'qr')
      ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;" 2>&1 | clean
echo "    done"

# --- care providers, from code -------------------------------------------
say "seeding care_providers"
( cd "$REPO" && PGHOST="$HOST" PGPORT="$PORT" PGUSER="postgres.$PROJECT_REF" \
    PGDATABASE=postgres PGPASSWORD="$DB_PASSWORD" PGSSLMODE=require \
    pnpm --filter @hetja/db seed:care 2>&1 | tail -3 )

# --- verification --------------------------------------------------------
say "row counts"
q "select 'dogs '||count(*) from dogs
   union all select 'collars '||count(*) from collars
   union all select 'feeders '||count(*) from feeders
   union all select 'care_providers '||count(*) from care_providers
   union all select 'migrations '||count(*) from schema_migrations" | sed 's/^/    /'

say "the five collar slugs (must match the printed tags exactly)"
q "select slug||'  '||name from dogs order by slug" | sed 's/^/    /'

say "RLS: any public table left unprotected? (want none)"
OPEN=$(q "select coalesce(string_agg(t.tablename,', '),'(none)') from pg_tables t
 where t.schemaname='public' and t.tablename<>'spatial_ref_sys'
   and not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relname=t.tablename and c.relrowsecurity)")
echo "    $OPEN"

say "anon table privileges remaining (want none)"
GRANTS=$(q "select coalesce(string_agg(distinct table_name,', '),'(none)') from information_schema.role_table_grants
            where grantee='anon' and table_schema='public'")
echo "    $GRANTS"

say "INVARIANT 9: append-only trigger must reject a mutation"
q "do \$\$ begin
     begin
       update medical_records set diagnosis='probe' where true;
       raise notice 'NOT ENFORCED — trigger missing';
     exception when others then raise notice 'enforced: %', SQLERRM;
     end;
   end \$\$;" | sed 's/^/    /'

say "HMAC parity: node vs the SQL twin, all five collars"
for slug in $(q "select slug from dogs order by slug"); do
  sig=$(node -e 'const{createHmac}=require("crypto");console.log(createHmac("sha256",process.argv[1]).update(process.argv[2]).digest("base64url"))' "$QR" "$slug")
  ok=$(q "select private.verify_slug_sig('$slug','$sig')")
  bad=$(q "select private.verify_slug_sig('$slug','tampered')")
  printf '    %-11s valid=%-5s tampered=%s\n' "$slug" "$ok" "$bad"
done

say "latency — the reason for this migration"
TOTAL=0
for i in 1 2 3 4 5; do
  ms=$(q "select round(1000*extract(epoch from clock_timestamp()-statement_timestamp()))::int" >/dev/null 2>&1; \
       s=$(date +%s%N); q "select slug from dogs limit 1" >/dev/null 2>&1; e=$(date +%s%N); echo $(( (e-s)/1000000 )) )
  TOTAL=$((TOTAL+ms))
done
AVG=$((TOTAL/5))
echo "    round-trip incl. connect: ${AVG} ms   (Singapore baseline was ~1144 ms)"
echo "    steady-state warm query is the number that matters — measure after repointing."

# --- optional repoint ----------------------------------------------------
if [ "$REPOINT" = "--repoint" ]; then
  say "repointing apps/api/.env.production and restarting the API"
  ENVF="$REPO/apps/api/.env.production"
  cp "$ENVF" "$ENVF.bak.$(date +%s)"
  python3 - "$ENVF" "$HOST" "$PORT" "postgres.$PROJECT_REF" "$DB_PASSWORD" <<'PY'
import io, re, sys
p, host, port, user, pw = sys.argv[1:6]
s = io.open(p, encoding="utf8").read()
def setkv(s, k, v):
    if re.search(r"^%s=" % k, s, re.M):
        return re.sub(r"^%s=.*$" % k, "%s=%s" % (k, v), s, count=1, flags=re.M)
    return s.rstrip("\n") + "\n%s=%s\n" % (k, v)
for k, v in (("PGHOST", host), ("PGPORT", port), ("PGUSER", user),
             ("PGDATABASE", "postgres"), ("PGPASSWORD", pw), ("PGSSLMODE", "require")):
    s = setkv(s, k, v)
io.open(p, "w", encoding="utf8").write(s)
print("    env rewritten (backup alongside)")
PY
  systemctl restart straynet-api straynet-worker
  sleep 5
  printf '    healthz: '; curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 http://127.0.0.1:8080/healthz
  printf '    care:    '; curl -s -o /dev/null -w '%{http_code}\n' --max-time 20 "http://127.0.0.1:8080/api/v1/care?lat=19.076&lng=72.8777"
  echo
  echo "    Rollback: restore the .bak file and restart straynet-api."
else
  say "not repointed"
  echo "    The API is still on its current database. Re-run with --repoint when"
  echo "    the verification above looks right."
fi

say "done"
