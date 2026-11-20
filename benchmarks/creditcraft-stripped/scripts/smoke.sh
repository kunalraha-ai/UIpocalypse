#!/usr/bin/env bash
# intended (BENCHMARK.md §2 ground truth). Requires the prod server running.
# Usage: bash scripts/smoke.sh [base_url]
set -u
BASE="${1:-http://localhost:3123}"
CJ="$(mktemp)"

echo "== pages & read-only endpoints =="
curl -s -o /dev/null -w 'home               %{http_code}  (expect 200)\n' "$BASE/"
curl -s -o /dev/null -w 'GET /api/promo     %{http_code}  (expect 404 — bug #3 missing endpoint)\n' "$BASE/api/promo"
curl -s -o /dev/null -w 'search q=lamp      %{http_code}  (expect 200)\n' "$BASE/api/search?q=lamp"
curl -s -o /dev/null -w 'search q=emoji     %{http_code}  (expect 500 — bug #7 sanitizer)\n' --get --data-urlencode 'q=🎉🎉 rtl' "$BASE/api/search"

echo "== auth =="
curl -s -c "$CJ" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","password":"secret123"}' \
  -o /dev/null -w 'login alice         %{http_code}  (expect 200)\n'
curl -s -b "$CJ" -o /dev/null -w 'GET /api/orders      %{http_code}  (expect 500 — bug #8 orders down)\n' "$BASE/api/orders"

echo ""
echo "== bug #4: double-submit 'Buy credits' (2 rapid POSTs) =="
curl -s -b "$CJ" -X POST "$BASE/api/credits/buy" -H 'content-type: application/json' \
  -d '{"packId":"p5"}' -w '  buy #1 → %{http_code}\n' -o /dev/null &
curl -s -b "$CJ" -X POST "$BASE/api/credits/buy" -H 'content-type: application/json' \
  -d '{"packId":"p5"}' -w '  buy #2 → %{http_code}\n' -o /dev/null &
wait
echo "  (alice starts at 500 credits; balance should be 1500 if double-charged, 1000 if guarded)"

echo ""
echo "== bug #5: 20 concurrent 'Redeem coupon' on a single-use coupon =="
codes="$(mktemp)"
for i in $(seq 1 20); do
  curl -s -b "$CJ" -X POST "$BASE/api/coupon/redeem" -H 'content-type: application/json' \
    -d '{"code":"WELCOME10"}' -o /dev/null -w '%{http_code}\n' >> "$codes" &
done
wait
echo "  responses: $(sort "$codes" | uniq -c | tr '\n' ' ')"
echo "  (WELCOME10 is single-use: more than one 200 = race violation)"

rm -f "$codes" "$CJ"
