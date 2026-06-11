# Local test — Medplum Fuzzy Match Bot

Step-by-step guide to deploy the patient-fuzzy-match Bot to a local (or prod) Medplum server and run the F1 regression battery live.

---

## 1. Prerequisites

- **Docker** running locally (needed for the local Medplum stack).
- **Node 22+** (`node --version` should print `v22.x.x` or higher).
- **python3** on PATH (used by the deploy script to JSON-escape the bundle and parse responses).
- The repo cloned and you are in the repo root (`medplum/`).

---

## 2. Start a local Medplum

From the **medplum repo root**, bring up the full local stack (postgres + redis + server + app):

```bash
docker compose up -d
# wait ~30 s for postgres migrations and server startup, then verify:
curl -s http://localhost:8103/healthcheck
```

Expected response: `{"ok":true}` (or a JSON object with `"ok":true`).

The Medplum app UI is available at http://localhost:3000.

---

## 3. Get an access token (client_credentials)

1. Open http://localhost:3000 in a browser.
2. Log in with the default super-admin credentials: **admin@example.com** / **medplum** (first-time setup wizard may appear — complete it).
3. Navigate to your Project > **Clients** (or **Security > Client Applications**).
4. Create a new ClientApplication (or copy an existing one's **ID** and **Secret**).

Then obtain a bearer token from the terminal:

```bash
CID=<client-id>
CSECRET=<client-secret>

TOKEN=$(curl -s -X POST http://localhost:8103/oauth2/token \
  -d 'grant_type=client_credentials' \
  -d "client_id=$CID" \
  -d "client_secret=$CSECRET" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

echo "$TOKEN"   # should print a long JWT string
```

---

## 4. Run unit tests (no server needed)

The unit-test suite covers 33 cases (scoring, phonetics, threshold logic, edge cases) and runs entirely in-process — no Medplum server required.

```bash
cd bots/fuzzy-match
npm install
npm test
```

All 33 tests should pass. This is the fastest way to confirm the matching logic is correct before touching any server.

---

## 5. Deploy + run the F1 battery against local

From the **bots/fuzzy-match** directory, run the deploy-and-test script with the token obtained in step 3:

```bash
cd bots/fuzzy-match
BASE=http://localhost:8103 TOKEN=$TOKEN ./scripts/deploy-and-test.sh
```

The script will:
1. Build the bot bundle (`npm run build` → `dist/patient-fuzzy-match.mjs`).
2. Create a `Bot` FHIR resource (`POST /fhir/R4/Bot`).
3. Upload the compiled JS via `$deploy` (`POST /fhir/R4/Bot/{id}/$deploy`).
4. Seed a test Patient (Maria Garcia / 1985-03-12 / MRN-FZ-2001).
5. Fire six `$execute` calls (F1.1 – F1.6) and pretty-print score + match-grade for each result.

### Expected output (parity with HAPI)

| Case | Query | Expected |
|------|-------|----------|
| F1.1 | exact name + DOB | total ≥ 1, grade **certain** |
| F1.2 | typo `Garcis` + DOB | total ≥ 1, grade certain or probable |
| F1.3 | dropped `Garca` + DOB | total ≥ 1, grade certain or probable |
| F1.4 | name-only typo, no DOB | total ≥ 1, at least one candidate returned |
| F1.5 | phonetic `Garsia` | total ≥ 1, at least one candidate returned |
| F1.6 | garbage `Zzzzzz` + DOB | total **0** (garbage rejected) |

Paste the script output back to fill the "Medplum + Bot" column in
`docs/medplum-vs-hapi-feature-matrix.md`.

---

## 6. Run against prod (when satisfied)

Once local testing passes, re-run against the CalMHSA production server using a prod service-account token:

```bash
cd bots/fuzzy-match
BASE=https://medplum-api.calmhsa-works.dev TOKEN=<prod-token> ./scripts/deploy-and-test.sh
```

Obtain the prod token the same way as step 3, but pointing at the prod Medplum app and using prod ClientApplication credentials.

---

## 7. Alternative: deploy via @medplum/cli

The `@medplum/cli` `bot deploy` command requires a `medplum.config.json` that is not included in this project. The supported path is the `deploy-and-test.sh` script in step 5, which handles build, Bot creation, code upload, test-Patient seeding, and the F1 battery in one step. If you prefer the CLI-driven workflow, see https://www.medplum.com/docs/bots for the `medplum.config.json` schema and CLI reference.

---

## 8. Tuning note

Thresholds are applied in this order: **CERTAIN ≥ 0.85**, **PROBABLE ≥ 0.65**, **POSSIBLE ≥ 0.45**. Candidates below POSSIBLE are dropped.

If garbage queries (e.g. F1.6) ever surface a false positive on real data, raise the POSSIBLE threshold **without redeploying code** by setting a Bot secret:

1. Open the Bot resource in the Medplum app.
2. Under **Secrets**, add a secret named `POSSIBLE` with value e.g. `0.5`.
3. Re-run `$execute` — the bot reads secrets at runtime.

Similarly, `CERTAIN` and `PROBABLE` can be overridden the same way. No code change or redeploy is needed when adjusting thresholds.
