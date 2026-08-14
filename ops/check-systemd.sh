#!/bin/bash
# Config-as-code gate: every systemd unit committed under ops/systemd/ must
# actually be installed by ops/bootstrap.sh, and every unit bootstrap.sh
# installs must exist.
#
# This gate exists because of a specific failure, not as a general tidiness
# rule. docs/CREDITS.md and ops/RUNBOOK.md both documented a
# `hetja-restic.timer` running daily at 02:15 IST. The timer was real — on one
# hand-configured box. It was in no committed file, `ops/bootstrap.sh` did not
# install it, and `ops/deploy-remote.sh` did not either. So a box provisioned
# from this repository had no backups whatsoever while two documents said it
# did, which is the worst version of this mistake: you only discover it when you
# reach for a restore.
#
# The reverse direction matters too. A unit listed in bootstrap.sh but missing
# from the repo makes bootstrap fail hard (it calls `fail` on a missing
# template), which is at least loud — but catching it in CI is cheaper than
# catching it while provisioning.
set -u
cd "$(dirname "$0")/.."

BOOTSTRAP=ops/bootstrap.sh
UNIT_DIR=ops/systemd
fail=0

[ -f "$BOOTSTRAP" ] || { echo "FAIL: $BOOTSTRAP not found"; exit 1; }
[ -d "$UNIT_DIR" ]  || { echo "FAIL: $UNIT_DIR not found"; exit 1; }

units=$(find "$UNIT_DIR" -maxdepth 1 -type f \( -name '*.service' -o -name '*.timer' \) -printf '%f\n' | sort)
[ -n "$units" ] || { echo "FAIL: no systemd units found in $UNIT_DIR"; exit 1; }

while read -r name; do
  [ -n "$name" ] || continue
  if grep -qF "$UNIT_DIR/$name" "$BOOTSTRAP"; then
    echo "PASS: $name is installed by bootstrap.sh"
  else
    echo "FAIL: $UNIT_DIR/$name exists but ops/bootstrap.sh never installs it — a fresh box would not get it"
    fail=1
  fi
done <<< "$units"

# And the reverse: anything bootstrap.sh claims to install must be present.
while read -r ref; do
  [ -n "$ref" ] || continue
  if [ ! -f "$ref" ]; then
    echo "FAIL: ops/bootstrap.sh installs $ref, which does not exist"
    fail=1
  fi
done <<< "$(grep -oE "$UNIT_DIR/[A-Za-z0-9._-]+\.(service|timer)" "$BOOTSTRAP" | sort -u)"

# A .timer is inert without the .service it triggers.
while read -r timer; do
  [ -n "$timer" ] || continue
  want=$(grep -oE '^Unit=.*' "$UNIT_DIR/$timer" | head -1 | cut -d= -f2)
  # Default when Unit= is omitted is the same basename with .service.
  [ -n "$want" ] || want="${timer%.timer}.service"
  if [ -f "$UNIT_DIR/$want" ]; then
    echo "PASS: $timer triggers $want, which exists"
  else
    echo "FAIL: $timer triggers $want, which is not committed"
    fail=1
  fi
done <<< "$(find "$UNIT_DIR" -maxdepth 1 -type f -name '*.timer' -printf '%f\n' | sort)"

if [ "$fail" -eq 0 ]; then
  echo "PASS: systemd units and bootstrap.sh agree"
  exit 0
fi
exit 1
