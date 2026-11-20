#!/usr/bin/env bash
# Benchmark orchestrator: runs one contender at a time with clean state.
# Usage: bash benchmarks/run-one.sh <run-id> <kind>
#   kind: blind (subagent) | c (UIpocalypse)
set -euo pipefail
cd "$(dirname "$0")/.."

RUN_ID="$1"
KIND="$2"

echo "== reset DB for run $RUN_ID =="
(cd sample-app && npx -y supabase@latest db reset) > /dev/null 2>&1

echo "== verify stripped app on :3124 =="
C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3124)
if [ "$C" != "200" ]; then
  echo "app not responding on 3124 — starting"
  (cd benchmarks/creditcraft-stripped && nohup npx next start -p 3124 > /tmp/opencode/bm-app.log 2>&1 &)
  sleep 5
  C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3124)
  [ "$C" = "200" ] || { echo "FAILED to start app"; exit 1; }
fi
echo "app OK ($C)"
