#!/usr/bin/env bash
# Quick end-to-end smoke check of a running stack.
#   ./scripts/smoke.sh            (defaults to http://localhost:4000/api/v1)
#   API_URL=https://api.example.com/api/v1 ./scripts/smoke.sh
set -euo pipefail
API_URL="${API_URL:-http://localhost:4000/api/v1}"

echo "▶ Health:  $API_URL/health"
BODY=$(curl -fsS "$API_URL/health")
echo "$BODY" | python3 -m json.tool

STATUS=$(python3 -c "import json,sys;print(json.load(sys.stdin)['status'])" <<<"$BODY")
if [ "$STATUS" != "ok" ]; then
  echo "❌ Health status is '$STATUS' (expected 'ok')"
  exit 1
fi

echo
echo "▶ 404 error contract"
curl -s -o /tmp/_404.json -w "  HTTP %{http_code}\n" "$API_URL/does-not-exist"
python3 -m json.tool < /tmp/_404.json

echo
echo "✅ Smoke checks passed"
