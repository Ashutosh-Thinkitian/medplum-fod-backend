# Golden-Record MDM Bot — Local test + F2 curl set

A multi-operation Medplum Bot implementing the CalMHSA F2 golden-record / MDM lifecycle
(spec-sanctioned "Bot-based MDM", §3.2/§1.4). One Bot, one `$execute` endpoint; the
`operation` parameter selects the behavior. Destructive operations (`update-link`, `merge`)
are **propose-only** — they create a `Task` for human approval and mutate nothing.

> See `../DEPLOYMENT.md` for the generic multi-bot deploy flow and prerequisites. This file
> adds the **F2-specific curl set** for all 10 criteria.

## Operations
`link` · `query-links` · `create-link` · `update-link` (propose) · `merge` (propose) · `not-duplicate` · `find-duplicates`

---

## 0. Prereqs (same gotchas as every bot)
1. Target **project has the `bots` feature** enabled (Super-Admin → Project → Features → add `bots`).
2. **Server has `vmContextBotsEnabled: true`** (the SSM/config flag — set on dev once; see DEPLOYMENT.md).
3. An **admin** ClientApplication in that project for the deploy token.

## 1. Unit tests (no server needed — proves the logic)
```bash
cd bots/golden-record-mdm && npm install && npm test    # 64 tests
```

## 2. Get an admin token
```bash
BASE=http://localhost:8103        # or https://medplum-api.calmhsa-works.dev for dev
TOKEN=$(curl -s -X POST "$BASE/oauth2/token" \
  -d 'grant_type=client_credentials' \
  -d 'client_id=<ADMIN_CLIENT_ID>' \
  -d 'client_secret=<ADMIN_CLIENT_SECRET>' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
echo "$TOKEN"
```

## 3a. Deploy + run the whole F2 battery (local)
```bash
cd bots/golden-record-mdm
BASE=http://localhost:8103 TOKEN=$TOKEN ./scripts/deploy-and-test-local.sh
```

## 3b. Deploy for real use (idempotent, no test data)
```bash
cd bots/golden-record-mdm
BASE=https://medplum-api.calmhsa-works.dev TOKEN=$TOKEN ./scripts/deploy-bot-dev.sh
# prints the stable Bot id to use below as $BOT
```

---

## 4. F2 criteria → curl (all 10)

Set these once (use the Bot id printed by `deploy-bot-dev.sh`):
```bash
BASE=http://localhost:8103
BOT=<bot-id>
FHIR="$BASE/fhir/R4"
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/fhir+json' -H 'Accept: application/fhir+json')
X="$FHIR/Bot/$BOT/\$execute"
```

### F2.1 — Golden / master record + `_tag` search
Native FHIR search (golden records are tagged `GOLDEN_RECORD`):
```bash
curl -s "${H[@]}" "$FHIR/Patient?_tag=http://hapifhir.io/fhir/NamingSystem/mdm-record-status|GOLDEN_RECORD" | python3 -m json.tool
```
Expect: a `searchset` Bundle of golden Patients, each with the `GOLDEN_RECORD` + `CALMHSA-MDM` tags and an EID identifier (`https://calmhsa-works.dev/mdm-eid`).

### F2.2 — Auto-link source records on ingest (survivorship)
```bash
curl -s "${H[@]}" "$X" -d '{"resourceType":"Parameters","parameter":[
  {"name":"operation","valueString":"link"},
  {"name":"resource","resource":{"resourceType":"Patient","id":"<EXISTING_SOURCE_ID>","name":[{"family":"Garcia","given":["Maria"]}],"birthDate":"1985-03-12"}}
]}' | python3 -m json.tool
```
Expect: `action: linked` + `goldenRecord` ref on a MATCH (golden created/attached, survivorship recomputed); `action: review-queued` on a near-miss (RiskAssessment + Task created, NOT linked); `action: no-match` otherwise.
> NOTE: the `resource` Patient should be **persisted** (have an `id`) so it isn't matched against itself. To auto-link on every create, attach a Subscription (criteria `Patient`) that invokes this bot with `operation=link`.

### F2.3 — Inspect links (`$mdm-query-links` equivalent)
```bash
curl -s "${H[@]}" "$X" -d '{"resourceType":"Parameters","parameter":[
  {"name":"operation","valueString":"query-links"},
  {"name":"goldenResourceId","valueString":"Patient/<GOLDEN_ID>"}
]}' | python3 -m json.tool
```
Expect: `Parameters` with one `link` part per source — `goldenResourceId`, `sourceResourceId`, `matchResult`, `linkSource` (AUTO/MANUAL), `score`.
(Filter by source instead: pass `resourceId` = `Patient/<SOURCE_ID>`. Omit both to list all links.)

### F2.4 — Manual link create (`$mdm-create-link` equivalent)
```bash
curl -s "${H[@]}" "$X" -d '{"resourceType":"Parameters","parameter":[
  {"name":"operation","valueString":"create-link"},
  {"name":"goldenResourceId","valueString":"Patient/<GOLDEN_ID>"},
  {"name":"resourceId","valueString":"Patient/<SOURCE_ID>"}
]}' | python3 -m json.tool
```
Expect: `outcome: linked`, `linkSource: MANUAL`. Writes a `seealso` link + a link record + an AuditEvent, recomputes survivorship.

### F2.5 — Manual link override / re-grade (`$mdm-update-link` equivalent) — PROPOSE-ONLY
```bash
curl -s "${H[@]}" "$X" -d '{"resourceType":"Parameters","parameter":[
  {"name":"operation","valueString":"update-link"},
  {"name":"goldenResourceId","valueString":"Patient/<GOLDEN_ID>"},
  {"name":"resourceId","valueString":"Patient/<SOURCE_ID>"},
  {"name":"matchResult","valueString":"NO_MATCH"}
]}' | python3 -m json.tool
```
Expect: `proposed: true`, `taskId`. **No link is changed** — a `Task` (code `mdm-update-link`) is created for a human to approve. (Safety boundary; executing the change is a deliberate future phase.)

### F2.6 — Link history / audit (`$mdm-link-history` equivalent)
Native FHIR search of the AuditEvents the bot writes on each link change:
```bash
curl -s "${H[@]}" "$FHIR/AuditEvent?_sort=-_lastUpdated&_count=10" | python3 -m json.tool
# scoped to one golden:
curl -s "${H[@]}" "$FHIR/AuditEvent?entity=Patient/<GOLDEN_ID>" | python3 -m json.tool
```
Expect: AuditEvents with subtype `mdm-*` and entity refs to the golden + source.

### F2.7 — Duplicate-golden detection (`$mdm-duplicate-golden-resources` equivalent)
```bash
curl -s "${H[@]}" "$X" -d '{"resourceType":"Parameters","parameter":[
  {"name":"operation","valueString":"find-duplicates"}
]}' | python3 -m json.tool
```
Expect: `Parameters` with `duplicatePair` parts (`goldenA`, `goldenB`, `score`, `grade`) for golden pairs scoring ≥ possible. Pairs marked via `not-duplicate` are excluded. No merge happens.

### F2.8 — Resolve duplicate goldens (`$mdm-merge` + `$mdm-not-duplicate`)
Merge — **PROPOSE-ONLY**:
```bash
curl -s "${H[@]}" "$X" -d '{"resourceType":"Parameters","parameter":[
  {"name":"operation","valueString":"merge"},
  {"name":"sourceGolden","valueString":"Patient/<GOLDEN_A>"},
  {"name":"targetGolden","valueString":"Patient/<GOLDEN_B>"}
]}' | python3 -m json.tool
```
Expect: `proposed: true`, `taskId` (code `mdm-merge`). **Nothing is merged** — a human approves the Task.

Not-duplicate — mark two goldens as genuinely distinct:
```bash
curl -s "${H[@]}" "$X" -d '{"resourceType":"Parameters","parameter":[
  {"name":"operation","valueString":"not-duplicate"},
  {"name":"goldenA","valueString":"Patient/<GOLDEN_A>"},
  {"name":"goldenB","valueString":"Patient/<GOLDEN_B>"}
]}' | python3 -m json.tool
```
Expect: `outcome: marked-distinct`. `find-duplicates` will skip this pair afterward.

### F2.9 — Config-driven rules (thresholds + system-of-record priority)
Set on the **Bot resource's `secret` field** (no code change, no redeploy of code):
| Secret name | Meaning | Default |
|---|---|---|
| `CERTAIN` | auto-link (MATCH) threshold | `0.85` |
| `PROBABLE` | upper review-band threshold | `0.65` |
| `POSSIBLE` | review-band floor (below = no match) | `0.45` |
| `SOR_PRIORITY` | comma-separated identifier systems, highest-priority first (survivorship for SSN/Medi-Cal/MRN) | (none → recency only) |

> Set these in the Medplum app on the Bot's **Secrets**, e.g. `SOR_PRIORITY = http://hl7.org/fhir/sid/us-medicaid,http://hl7.org/fhir/sid/us-ssn,urn:calmhsa:mrn`. The bot reads them per-invocation.
> **Honest limitation vs HAPI:** thresholds + SoR are config; the *matching algorithm itself* is code (HAPI's `mdm-rules.json` externalises both).

### F2.10 — Works live on the deployed server
The `deploy-bot-dev.sh` deploy itself + any `$execute` above prove this. Smoke test after deploy:
```bash
curl -s "${H[@]}" "$X" -d '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"find-duplicates"}]}' | python3 -m json.tool
```
Expect: a `Parameters` response (not an error) → the bot is live on the server.

---

## 5. Notes / honest scope
- **Propose-only** for `update-link` + `merge`: these return `proposed: true` and create a Task; they do **not** execute the destructive change. Executing (with approval workflow + reversibility) is a deliberate future phase.
- **Equivalent, not identical** to HAPI: operations are custom Bot endpoints (`$execute` with `operation`), not the standard `$mdm-*` operation URLs, and there is no `:mdm` search qualifier (`query-links` is the equivalent).
- **Platform gap (not bot-fixable):** runtime custom SearchParameters / `$reindex` (Medplum, §3.1).
- Full feasibility analysis: `../../docs/medplum-bots-f2-mdm-feasibility.md`.
