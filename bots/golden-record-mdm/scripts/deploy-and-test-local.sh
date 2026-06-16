#!/usr/bin/env bash
# Deploy golden-record-mdm to a Medplum server and exercise ALL F2 operations end to end.
# Usage: BASE=http://localhost:8103 TOKEN=<admin bearer> ./scripts/deploy-and-test-local.sh
#   (run from the bots/golden-record-mdm directory)
# Creates throwaway test Patients + a fresh test Bot — point only at a LOCAL/dev eval server.
set -euo pipefail
BASE="${BASE:?set BASE, e.g. http://localhost:8103}"
TOKEN="${TOKEN:?set TOKEN (admin bearer access token)}"
FHIR="$BASE/fhir/R4"
AUTH=(-H "Authorization: Bearer $TOKEN")
JSON=(-H 'Content-Type: application/fhir+json' -H 'Accept: application/fhir+json')

echo "==> Build + deploy a fresh test Bot"
npm run build >/dev/null
BOT_ID=$(curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot" \
  -d '{"resourceType":"Bot","name":"golden-record-mdm-test","runtimeVersion":"vmcontext"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
if [[ -z "$BOT_ID" || "$BOT_ID" == "None" ]]; then
  echo "ERROR: Bot create failed (need project admin + 'bots' feature on this project)." >&2; exit 1
fi
CODE=$(python3 -c "import json;print(json.dumps(open('dist/golden-record-mdm.cjs').read()))")
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot/$BOT_ID/\$deploy" -d "{\"code\": $CODE, \"filename\":\"index.js\"}" >/dev/null
echo "    Bot/$BOT_ID"

exec_op() { curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot/$BOT_ID/\$execute" -d "$1" | python3 -m json.tool; }
new_patient() { curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Patient" -d "$1" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])"; }

echo "==> Seed source Patients (two matching Maria Garcia + one distinct)"
P1=$(new_patient '{"resourceType":"Patient","name":[{"family":"Garcia","given":["Maria"]}],"birthDate":"1985-03-12","gender":"female","identifier":[{"system":"urn:mrn","value":"M-1"}]}')
sleep 1
echo "--- F2.2 link (source 1 → creates golden) ---"
exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"link"},{"name":"resource","resource":{"resourceType":"Patient","id":"'"$P1"'","name":[{"family":"Garcia","given":["Maria"]}],"birthDate":"1985-03-12"}}]}'
P2=$(new_patient '{"resourceType":"Patient","name":[{"family":"Garcia","given":["Maria"]}],"birthDate":"1985-03-12","identifier":[{"system":"urn:ssn","value":"S-2"}]}')
sleep 1
echo "--- F2.2 link (source 2 → same golden, survivorship recompute) ---"
exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"link"},{"name":"resource","resource":{"resourceType":"Patient","id":"'"$P2"'","name":[{"family":"Garcia","given":["Maria"]}],"birthDate":"1985-03-12"}}]}'

echo "--- F2.1 golden _tag search ---"
curl -s "${AUTH[@]}" "$FHIR/Patient?_tag=http://hapifhir.io/fhir/NamingSystem/mdm-record-status|GOLDEN_RECORD" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('goldens:',d.get('total'));[print('  ',e['resource']['id']) for e in d.get('entry',[])]"
GOLDEN=$(curl -s "${AUTH[@]}" "$FHIR/Patient?_tag=http://hapifhir.io/fhir/NamingSystem/mdm-record-status|GOLDEN_RECORD" \
  | python3 -c "import sys,json;e=json.load(sys.stdin).get('entry') or [];print(e[0]['resource']['id'] if e else '')")

echo "--- F2.3 query-links (sources of the golden) ---"
exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"query-links"},{"name":"goldenResourceId","valueString":"Patient/'"$GOLDEN"'"}]}'

echo "--- F2.4 create-link (manual link of a 3rd source) ---"
P3=$(new_patient '{"resourceType":"Patient","name":[{"family":"Garcia","given":["Maria"]}]}')
exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"create-link"},{"name":"goldenResourceId","valueString":"Patient/'"$GOLDEN"'"},{"name":"resourceId","valueString":"Patient/'"$P3"'"}]}'

echo "--- F2.5 update-link (PROPOSE-ONLY → returns proposed:true + taskId) ---"
exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"update-link"},{"name":"goldenResourceId","valueString":"Patient/'"$GOLDEN"'"},{"name":"resourceId","valueString":"Patient/'"$P3"'"},{"name":"matchResult","valueString":"NO_MATCH"}]}'

echo "--- F2.6 audit / link history (recent AuditEvents) ---"
curl -s "${AUTH[@]}" "$FHIR/AuditEvent?_count=5&_sort=-_lastUpdated" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('auditEvents:',d.get('total'))"

echo "--- F2.7 find-duplicates (scan goldens for dup pairs) ---"
exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"find-duplicates"}]}'

echo "==> Seed a second distinct cluster (Robert Johnson) so merge/not-duplicate have 2 goldens"
PJ=$(new_patient '{"resourceType":"Patient","name":[{"family":"Johnson","given":["Robert"]}],"birthDate":"1978-11-02","gender":"male"}')
sleep 1
exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"link"},{"name":"resource","resource":{"resourceType":"Patient","id":"'"$PJ"'","name":[{"family":"Johnson","given":["Robert"]}],"birthDate":"1978-11-02"}}]}' >/dev/null || true
GOLDEN2=$(curl -s "${AUTH[@]}" "$FHIR/Patient?_tag=http://hapifhir.io/fhir/NamingSystem/mdm-record-status|GOLDEN_RECORD&_count=50" | python3 -c "
import sys,json
gs=[e['resource']['id'] for e in json.load(sys.stdin).get('entry',[])]
print(next((g for g in gs if g!='$GOLDEN'), ''))")

echo "--- F2.8 merge (PROPOSE-ONLY → returns proposed:true + taskId) ---"
if [[ -n "$GOLDEN2" ]]; then
  exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"merge"},{"name":"sourceGolden","valueString":"Patient/'"$GOLDEN"'"},{"name":"targetGolden","valueString":"Patient/'"$GOLDEN2"'"}]}'
else
  echo "(only one golden; skipping merge demo)"
fi

echo "--- F2.8 not-duplicate (mark two goldens distinct) ---"
if [[ -n "$GOLDEN2" ]]; then
  exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"not-duplicate"},{"name":"goldenA","valueString":"Patient/'"$GOLDEN"'"},{"name":"goldenB","valueString":"Patient/'"$GOLDEN2"'"}]}'
else
  echo "(only one golden; skipping not-duplicate demo)"
fi

echo "==> done. Bot/$BOT_ID"
