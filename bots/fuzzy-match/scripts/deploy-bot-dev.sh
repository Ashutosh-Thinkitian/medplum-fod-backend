#!/usr/bin/env bash
# Idempotent deploy of the fuzzy-match Bot to a Medplum server.
# - Creates the Bot ONCE (found by a stable identifier on re-runs), then deploys code.
# - Does NOT create test patients and does NOT run the F1 battery (use deploy-and-test.sh for that).
#
# Usage:
#   BASE=https://medplum-api.calmhsa-works.dev TOKEN=<admin bearer> ./scripts/deploy-bot.sh
#   (run from the bots/fuzzy-match directory)
#
# Requires: an ADMIN token (project admin) for the project the bot should live in,
#           and that project must have the "bots" feature enabled.
set -euo pipefail

BASE="${BASE:?set BASE, e.g. https://medplum-api.calmhsa-works.dev}"
TOKEN="${TOKEN:?set TOKEN (admin bearer access token)}"
FHIR="$BASE/fhir/R4"
AUTH=(-H "Authorization: Bearer $TOKEN")
JSON=(-H 'Content-Type: application/fhir+json' -H 'Accept: application/fhir+json')

# Stable identity so re-runs UPDATE the same Bot instead of creating duplicates.
BOT_IDENTIFIER_SYSTEM="https://calmhsa-works.dev/bots"
BOT_IDENTIFIER_VALUE="patient-fuzzy-match"
BOT_NAME="patient-fuzzy-match"

echo "==> Building bot bundle (CJS, vmcontext-safe)"
npm run build >/dev/null

echo "==> Looking for existing Bot by identifier ($BOT_IDENTIFIER_VALUE)"
BOT_ID=$(curl -s "${AUTH[@]}" "${JSON[@]}" \
  "$FHIR/Bot?identifier=${BOT_IDENTIFIER_SYSTEM}|${BOT_IDENTIFIER_VALUE}" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);e=d.get('entry') or [];print(e[0]['resource']['id'] if e else '')")

if [[ -z "$BOT_ID" ]]; then
  echo "==> No existing bot found — creating new Bot resource"
  BOT_ID=$(curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot" -d "{
    \"resourceType\":\"Bot\",
    \"name\":\"$BOT_NAME\",
    \"identifier\":[{\"system\":\"$BOT_IDENTIFIER_SYSTEM\",\"value\":\"$BOT_IDENTIFIER_VALUE\"}],
    \"runtimeVersion\":\"vmcontext\",
    \"description\":\"Levenshtein+Soundex fuzzy Patient \$match (read-only candidate finder)\"
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
CODE=$(python3 -c "import json;print(json.dumps(open('dist/patient-fuzzy-match.cjs').read()))")
DEPLOY_OUT=$(curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot/$BOT_ID/\$deploy" \
  -d "{\"code\": $CODE, \"filename\": \"index.js\"}")
echo "$DEPLOY_OUT" | python3 -c "
import sys,json
d=json.load(sys.stdin)
issues=d.get('issue',[])
sev=issues[0].get('severity') if issues else None
if sev in (None,'information'):
    print('    deploy OK')
else:
    print('    deploy response:', json.dumps(d)[:300]); sys.exit(1)
"

echo ""
echo "============================================================"
echo " Bot deployed."
echo "   Bot id   : $BOT_ID"
echo "   Invoke   : POST $FHIR/Bot/$BOT_ID/\$execute"
echo "   Body     : a \$match-shaped Parameters with a Patient 'resource'"
echo "   Returns  : searchset Bundle with search.score + match-grade"
echo "============================================================"
echo ""
echo "Smoke test (optional) — replace the name/DOB with a real candidate in this project:"
cat <<EOF
curl -s "$FHIR/Bot/$BOT_ID/\\\$execute" \\
  -H "Authorization: Bearer \$TOKEN" -H 'Content-Type: application/fhir+json' \\
  -d '{"resourceType":"Parameters","parameter":[{"name":"resource","resource":{"resourceType":"Patient","name":[{"family":"Garcia","given":["Maria"]}],"birthDate":"1985-03-12"}}]}' | python3 -m json.tool
EOF
