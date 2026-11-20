#!/usr/bin/env bash
# Stage 2: held-out fixture check — UIpocalypse ONCE on Plain Pages, untouched.
# Serves held-out-app-2 statically and runs verify_deployment_safety with defaults.
set -euo pipefail
cd "$(dirname "$0")/.."

# serve Plain Pages on :4180
python3 -m http.server 4180 --directory held-out-app-2 > /tmp/opencode/plainpages.log 2>&1 &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null" EXIT
sleep 1

# health check
C=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:4180)
[ "$C" = "200" ] || { echo "Plain Pages not responding"; exit 1; }

# run UIpocalypse with defaults against the static app — no config file, no invariants,
# the default target is overridden by the URL argument
cd uipocalypse
mkdir -p ../benchmarks/plain-pages
rm -rf /tmp/opencode/plainpages-ws
UIP_WORKSPACE=/tmp/opencode/plainpages-ws npx tsx src/index.ts swarm --url http://localhost:4180 --agents 20 --budget 60 > ../benchmarks/plain-pages/run.json 2>&1 || true
echo "run complete — output saved to benchmarks/plain-pages/run.json"
