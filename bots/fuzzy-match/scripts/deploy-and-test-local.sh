#!/usr/bin/env bash
# Deploy the fuzzy-match Bot to a Medplum server and run the F1 battery.
# Usage: BASE=http://localhost:8103 TOKEN=<bearer> ./scripts/deploy-and-test.sh
#   (run from the bots/fuzzy-match directory)
set -euo pipefail

BASE="${BASE:?set BASE, e.g. http://localhost:8103}"
TOKEN="${TOKEN:?set TOKEN (bearer access token)}"
FHIR="$BASE/fhir/R4"
AUTH=(-H "Authorization: Bearer $TOKEN")
JSON=(-H 'Content-Type: application/fhir+json' -H 'Accept: application/fhir+json')

echo "==> Building bot bundle"
npm run build >/dev/null

echo "==> Creating Bot resource"
BOT_ID=$(curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot" -d '{
  "resourceType":"Bot","name":"patient-fuzzy-match",
  "runtimeVersion":"vmcontext","description":"Levenshtein+Soundex fuzzy Patient match"
}' | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('id',''))")
if [[ -z "${BOT_ID:-}" || "$BOT_ID" == "None" ]]; then
  echo "ERROR: failed to create Bot (check TOKEN has Bot create permission and the project is set up). Aborting." >&2
  exit 1
fi
echo "    Bot/$BOT_ID"

echo "==> Uploading bot code (\$deploy)"
CODE=$(python3 -c "import json;print(json.dumps(open('dist/patient-fuzzy-match.cjs').read()))")
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot/$BOT_ID/\$deploy" \
  -d "{\"code\": $CODE, \"filename\": \"index.js\"}" >/dev/null
echo "    deployed"

echo "==> Creating target test Patient (Maria Garcia / 1985-03-12)"
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Patient" -d '{
  "resourceType":"Patient","active":true,
  "identifier":[{"system":"urn:calmhsa:mrn","value":"MRN-FZ-2001"}],
  "name":[{"use":"official","family":"Garcia","given":["Maria","Elena"]}],
  "gender":"female","birthDate":"1985-03-12",
  "telecom":[{"system":"phone","value":"555-0201"},{"system":"email","value":"maria.garcia.fz@example.com"}]
}' >/dev/null
echo "    created (allow a moment for search indexing)"
sleep 2

run() {  # $1 = label, $2 = resource JSON
  echo "--- $1 ---"
  curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot/$BOT_ID/\$execute" \
    -d "{\"resourceType\":\"Parameters\",\"parameter\":[{\"name\":\"resource\",\"resource\":$2}]}" \
  | python3 -c "
import sys,json
raw=sys.stdin.read()
try:
  d=json.loads(raw)
except Exception:
  print('  non-JSON response:', raw[:300]); sys.exit()
if d.get('resourceType')!='Bundle':
  print('  unexpected:', json.dumps(d)[:300]); sys.exit()
es=d.get('entry',[])
print('  total:',len(es))
for e in es:
  r=e.get('resource',{}); s=e.get('search',{}); nm=(r.get('name') or [{}])[0]
  g=[x.get('valueCode') for x in (s.get('extension') or []) if 'match-grade' in x.get('url','')]
  sc=s.get('score'); sc=round(sc,4) if isinstance(sc,(int,float)) else sc
  print('   -',nm.get('given'),nm.get('family'),r.get('birthDate'),'| score',sc,'grade',g)"
}

echo "==> F1 battery"
run "F1.1 exact name+DOB"        '{"resourceType":"Patient","name":[{"family":"Garcia","given":["Maria"]}],"birthDate":"1985-03-12"}'
run "F1.2 typo Garcis+DOB"       '{"resourceType":"Patient","name":[{"family":"Garcis","given":["Maria"]}],"birthDate":"1985-03-12"}'
run "F1.3 dropped Garca+DOB"     '{"resourceType":"Patient","name":[{"family":"Garca","given":["Maria"]}],"birthDate":"1985-03-12"}'
run "F1.4 name-only typo no DOB" '{"resourceType":"Patient","name":[{"family":"Garca","given":["Maria"]}]}'
run "F1.5 phonetic Garsia"       '{"resourceType":"Patient","name":[{"family":"Garsia","given":["Maria"]}]}'
run "F1.6 garbage Zzzzzz+DOB"    '{"resourceType":"Patient","name":[{"family":"Zzzzzz","given":["Maria"]}],"birthDate":"1985-03-12"}'
echo "==> done. Bot/$BOT_ID"
