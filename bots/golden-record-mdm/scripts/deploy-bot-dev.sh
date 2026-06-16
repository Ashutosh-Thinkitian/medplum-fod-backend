#!/usr/bin/env bash
# Idempotent deploy of the golden-record-mdm Bot. Creates once (by identifier), then deploys code.
# Usage: BASE=https://medplum-api.calmhsa-works.dev TOKEN=<admin bearer> ./scripts/deploy-bot-dev.sh
#   (run from the bots/golden-record-mdm directory)
# Requires: an ADMIN token for the target project, and that project must have the "bots" feature enabled.
set -euo pipefail
BASE="${BASE:?set BASE, e.g. https://medplum-api.calmhsa-works.dev}"
TOKEN="${TOKEN:?set TOKEN (admin bearer access token)}"
FHIR="$BASE/fhir/R4"
AUTH=(-H "Authorization: Bearer $TOKEN")
JSON=(-H 'Content-Type: application/fhir+json' -H 'Accept: application/fhir+json')
SYS="https://calmhsa-works.dev/bots"; VAL="golden-record-mdm"; NAME="golden-record-mdm"

echo "==> Building bundle"
npm run build >/dev/null

echo "==> Find-or-create Bot by identifier ($VAL)"
BOT_ID=$(curl -s "${AUTH[@]}" "${JSON[@]}" "$FHIR/Bot?identifier=${SYS}|${VAL}" \
  | python3 -c "import sys,json;e=json.load(sys.stdin).get('entry') or [];print(e[0]['resource']['id'] if e else '')")
if [[ -z "$BOT_ID" ]]; then
  BOT_ID=$(curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot" -d "{
    \"resourceType\":\"Bot\",\"name\":\"$NAME\",
    \"identifier\":[{\"system\":\"$SYS\",\"value\":\"$VAL\"}],
    \"runtimeVersion\":\"vmcontext\",
    \"description\":\"Golden-record MDM (F2): link/query-links/create-link/update-link/merge/not-duplicate/find-duplicates\"
  }" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
  if [[ -z "$BOT_ID" || "$BOT_ID" == "None" ]]; then
    echo "ERROR: failed to create Bot. Check the token is a PROJECT ADMIN and the project has the 'bots' feature enabled." >&2
    exit 1
  fi
  echo "    created Bot/$BOT_ID"
else
  echo "    found existing Bot/$BOT_ID — will redeploy code into it"
fi

echo "==> Deploying bot code (\$deploy)"
CODE=$(python3 -c "import json;print(json.dumps(open('dist/golden-record-mdm.cjs').read()))")
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot/$BOT_ID/\$deploy" \
  -d "{\"code\": $CODE, \"filename\": \"index.js\"}" >/dev/null
echo "    deployed"

echo ""
echo "============================================================"
echo " golden-record-mdm deployed."
echo "   Bot id : $BOT_ID"
echo "   Invoke : POST $FHIR/Bot/$BOT_ID/\$execute"
echo "   Body   : Parameters with an 'operation' value (see LOCAL-TEST.md)"
echo "============================================================"
