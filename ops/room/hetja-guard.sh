#!/usr/bin/env bash
# Hetja yields to the co-tenant agent. Runs as root every minute from
# hetja-guard.timer and only ever starts/stops hetja.target.
#
# The agent's watchdog (/usr/local/bin/jobagent-watchdog) restarts its browser
# when MemAvailable < 250 MB. This guard stops the whole site at < 400 MB, well
# before that, and brings it back at > 900 MB (hysteresis, so it never flaps).
set -u
LOW=400; HIGH=900
MARK=/run/hetja-guard.paused
LOG=/var/log/hetja-guard.log
avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
if [ "${avail:-9999}" -lt "$LOW" ] && [ ! -e "$MARK" ]; then
  echo "$(date '+%F %T') MemAvailable ${avail} MB < ${LOW}: stopping hetja.target to protect the agent" >> "$LOG"
  touch "$MARK"
  systemctl stop hetja.target   # PartOf= propagates the stop to every hetja unit
elif [ -e "$MARK" ] && [ "${avail:-0}" -gt "$HIGH" ]; then
  echo "$(date '+%F %T') MemAvailable ${avail} MB > ${HIGH}: restarting hetja.target" >> "$LOG"
  rm -f "$MARK"
  systemctl start hetja.target
fi
exit 0
