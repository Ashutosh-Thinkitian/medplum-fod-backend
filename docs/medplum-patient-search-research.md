# Medplum Patient (Client) Search — Capability Research

**Purpose:** Head-to-head comparison of **client (Patient) search** capabilities between HAPI FHIR and Medplum for the CalMHSA FOD behavioral-health platform.
**Requirements source:** `CalMHSA/Work/.../Client-Record-Structure-and-Identity-Management: Clinical Guidance.md` §3.2 / §3.3 — three required capabilities:

1. **Demographic search** — name, DOB (exact + range), SSN (full + last-4), MRN/CIN, phone, address, gender, language.
2. **Fuzzy / typo-tolerant search** — phonetic + approximate-spelling name matching with confidence tiers.
3. **MDM / identity matching via Levenshtein** — duplicate detection, golden/master record, scored `Patient/$match`.

**Method / honesty note:** Every capability claim below cites a real file:line. **UPDATE (2026-06-04): a live CalMHSA Medplum server WAS subsequently reached and `$match` and demographic queries were run against it — those sections are now `VERIFIED (live)`.** The remaining curls in §5 are still `UNVERIFIED (pattern)`, anchored to the exact handler/test that proves support.

> ## ⚠️ CORRECTION (2026-06-04) — `Patient/$match` IS supported (I was wrong)
> My first pass concluded "`$match` does not exist" based **only** on the local checkout, which is **Medplum v5.1.3**. That was a stale-checkout error. The **deployed CalMHSA server runs Medplum v5.1.13** (confirmed via `/fhir/R4/metadata` → `software.version = "5.1.13-770590d"`), and **`$match` is a real built-in operation** added between those versions: `packages/server/src/fhir/operations/patientmatch.ts` (present in tag `v5.1.13`, **absent** in the local v5.1.3 tree).
> **Live proof:** `POST https://medplum-api.calmhsa-works.dev/fhir/R4/Patient/$match` returned HTTP 200 with `search.mode=match`, a numeric `score`, and the `match-grade` extension. Details, the exact algorithm, and live probe results are in **§3 (rewritten)**.
> **BUT** — the algorithm is **NOT Levenshtein/phonetic.** It is a **weighted exact-equality comparison** (family name also allows a `startsWith` prefix). So Medplum has a scored `$match` with FHIR match-grades, but it does **not** do edit-distance/typo correction. This nuance is the crux of the HAPI-vs-Medplum verdict below.

---

## 0. Verdict table (TL;DR)

| Capability | Medplum verdict | Evidence (file:line) |
|---|---|---|
| Demographic: name / given / family | **Supported** | `packages/server/src/fhir/lookups/lookuptable.ts:167-188`, `humanname.ts:58` |
| Demographic: birthdate exact + range (gt/lt/ge/le) | **Supported** | `packages/core/src/search/search.ts:389` (prefix parse); `search.test.ts:172`; SQL `packages/server/src/fhir/search.ts:1582-1602` |
| Demographic: identifier SSN/MRN (`system\|value`) | **Supported** | `packages/server/src/fhir/token-column.ts:363-372`; test `search.test.ts:3242-3255` |
| Demographic: phone / telecom | **Supported** | token-column; SP `phone` = `Patient.telecom.where(system='phone')` |
| Demographic: address | **Supported** | `packages/server/src/fhir/lookups/address.ts:11-17`, lookuptable ILIKE |
| Demographic: gender | **Supported** | token-column.ts |
| Demographic: communication.language | **Supported** | SP `language` = `Patient.communication.language` (token) |
| `:exact` modifier (string/token) | **Supported** | `packages/core/src/search/search.ts:103`; `lookuptable.ts:167`; `token-column.ts:198` |
| `:contains` (substring, case-insensitive ILIKE) | **Supported (substring only, NOT fuzzy)** | `lookuptable.ts:168-174`; `humanname.ts:58` (`CONTAINS_SQL_OPERATOR='ILIKE'`) |
| `:text` (Postgres FTS, prefix/word) | **Supported (token params + lookup tables)** | `lookuptable.ts:176-188`; `packages/server/src/fhir/sql.ts:137-162` |
| SSN **last-4** search | **Must build** (custom SearchParameter + restart) | see §4 |
| **Fuzzy / typo-tolerant** name (`Garsia`→`Garcia`) | **Not supported** (even via `$match` — it uses exact-equality, not edit-distance) | `patientmatch.ts:185-276` (v5.1.13); live probe §3.3 |
| **Phonetic** (Soundex/Metaphone) | **Not supported** | grep across repo: 0 hits for patient search |
| **Levenshtein / edit-distance** scoring for Patient | **Not supported** | `$match` uses `===` + `startsWith` only (`patientmatch.ts:201-266`); `strict_word_similarity` only in ValueSet `$expand` (`operations/expand.ts:443`) |
| **`Patient/$match`** operation | **✅ SUPPORTED (VERIFIED live)** — built-in in v5.1.13; scored + FHIR match-grade | `patientmatch.ts` (v5.1.13); live HTTP 200, §3 |
| **MDM / golden record / dedup engine** | **Partial:** `$match` gives scored candidates + grades, but **no** golden-record/`Patient.link` automation, **no** dedup pipeline (still Bots) | `patientmatch.ts`; docs `fhir-datastore/patient-deduplication/*` |
| **Custom SearchParameters** | **Partial** — definable, but **NOT auto-indexed on POST**; needs bundle + server restart / reindex | `repo.ts` uses `getStandardAndDerivedSearchParameters` → in-memory `globalSchema` only (`core/src/types.ts:294-295`) |

---

## 1. Demographic search — **SUPPORTED**

### 1.1 How the search pipeline works

**Parse (URL → filters):** `packages/core/src/search/search.ts`
- `parseSearchRequest()` at **search.ts:141**, `parseKeyValue()` at **search.ts:215** split `code:modifier=value`.
- Modifier → operator map at **search.ts:101-114** (`contains→CONTAINS`, `exact→EXACT`, `text→TEXT`, `missing`, `not`, …).
- Date/number prefix parse (`gt/lt/ge/le/sa/eb`) at **search.ts:389**; e.g. `Patient?birthdate=gt2000-01-01` → `{operator: GREATER_THAN, value:'2000-01-01'}` (test proof: **packages/core/src/search/search.test.ts:172-181**).

**Execute (filters → SQL):** `packages/server/src/fhir/search.ts`
- `buildSearchFilterExpression()` routes by SearchParameter implementation strategy (column / lookup-table / token-column).
- Date comparison SQL at **search.ts:1582-1602** (`fhirOperatorToSqlOperator`: gt→`>`, ge→`>=`, lt→`<`, le→`<=`).

**Backing storage strategies:**
- **String params** (`name`, `given`, `family`, `address`) → **lookup tables** (`HumanName`, `Address`). Columns: `humanname.ts:25-28` (name/given/family), `address.ts:11-17` (address/city/state/postalCode/country/use).
- **Token params** (`identifier`, `phone`, `telecom`, `gender`, `language`) → **token columns** (`token-column.ts`): hashed-token UUID arrays (`token-column.ts:363-372`) + a text-search array.
- **Date param** (`birthdate`) → direct column.

### 1.2 SearchParameters confirmed present (Patient)

From `packages/definitions/dist/fhir/r4/search-parameters.json` (loaded at startup via `loadStructureDefinitions()` → `app.ts:235`):

| Param | Type | FHIRPath expression |
|---|---|---|
| `name` | string | `Patient.name` |
| `given` | string | `Patient.name.given` |
| `family` | string | `Patient.name.family` |
| `birthdate` | date | `Patient.birthDate` |
| `identifier` | token | `Patient.identifier` |
| `phone` | token | `Patient.telecom.where(system='phone')` |
| `telecom` | token | `Patient.telecom` |
| `address` | string | `Patient.address` |
| `gender` | token | `Patient.gender` |
| `language` | token | `Patient.communication.language` |

### 1.3 Supported modifiers (per type)

| Modifier | String (name/family/address) | Token (identifier/phone/gender/language) | Date (birthdate) | Evidence |
|---|---|---|---|---|
| (none) | FTS / token match | exact token | eq | — |
| `:exact` | ✅ `=` | ✅ hash-eq | ❌ | `lookuptable.ts:167`; `token-column.ts:198` |
| `:contains` | ✅ `ILIKE '%v%'` | ✅ regex on text col | ❌ | `lookuptable.ts:168-174`; `token-column.ts:181-195` |
| `:text` | ✅ `to_tsquery` | ✅ `to_tsquery` | ❌ | `lookuptable.ts:176-188`; `sql.ts:137-162` |
| `:missing` | ✅ | ✅ | ✅ | `token-column.ts:218` |
| `:not` | ✅ | ✅ | ✅ | `token-column.ts:199` |
| `:in` / `:not-in` | ❌ throws | ❌ throws | ❌ | `token-column.ts:239-240` (`invalidSearchOperator`) |
| `:above` / `:below` | ❌ | ❌ throws | ❌ | `token-column.ts:251-252` |
| prefix `gt/lt/ge/le/sa/eb` | n/a | n/a | ✅ | `search.ts:1582-1602` |

> **CalMHSA-relevant gaps in demographics:** SSN **last-4** is not a native param (must build, §4). Age **range** is done via `birthdate=ge…&birthdate=le…` (no `_age` param). `:contains`/`:text` give substring/word matching but **not typo tolerance** (§2).

---

## 2. Fuzzy / phonetic / full-text — **MOSTLY NOT SUPPORTED**

### 2.1 Phonetic (Soundex / Metaphone / Double Metaphone) — **NOT SUPPORTED**
`grep -ri "soundex\|metaphone" packages/` → **0 hits** in any search path. Medplum has no phonetic name matching.

### 2.2 Levenshtein / edit-distance for Patient — **NOT SUPPORTED**
The only similarity primitive in the codebase is PostgreSQL `strict_word_similarity()` (pg_trgm), used **only** to rank **ValueSet/CodeSystem `$expand`** results:
- `packages/server/src/fhir/operations/expand.ts:443` — `new SqlFunction('strict_word_similarity', [Column('display'), Parameter(filter)])`.

It is **never** applied to Patient name/identifier search. No `levenshtein()` call anywhere in patient search.

### 2.3 Trigram (`pg_trgm`) — **ENABLED BUT NOT USED FOR PATIENTS**
- Extension created: `packages/server/src/migrations/schema/v77.ts:12-14` and `migrate.ts:860` (`CREATE EXTENSION IF NOT EXISTS pg_trgm`).
- Only index built on it: `Coding_display_trgm_idx` on the **Coding** table (`v77.ts`), for terminology. **No trigram index on HumanName / Patient columns**, and no trigram operator (`%`, `<->`) in patient search SQL.

### 2.4 Postgres full-text (`:text`) — **SUPPORTED, but word/prefix, not typo-tolerant**
- `:text` (and the no-modifier default on lookup tables) builds `to_tsvector('simple', col) @@ to_tsquery('simple', 'tok:* & tok2:*')`.
  - `packages/server/src/fhir/sql.ts:137-162` (`TSVECTOR_SIMPLE` / `TSVECTOR_ENGLISH`), query formatting `sql.ts:213-224`.
  - lookup-table path `packages/server/src/fhir/lookups/lookuptable.ts:176-188`.
- This matches whole words and **prefixes** (`smi:*` matches `smith`) but **does not** match transpositions/typos (`Smyth`, `Garsia`).

### 2.5 `:contains` — **SUBSTRING ONLY (ILIKE), NOT FUZZY**
- HumanName: `CONTAINS_SQL_OPERATOR = 'ILIKE'` (`humanname.ts:58`); SQL `col ILIKE '%value%'` (`lookuptable.ts:168-174`).
- Generic string column: `LOWER(col) LIKE '%value%'` (`search.ts:1275-1276`).
- Catches substrings only. `name:contains=arsi` would find `Garsia` but **not** correct it to `Garcia`.

> **Bottom line for fuzzy:** Medplum can do **prefix/word FTS** and **substring** matching. It **cannot** do phonetic, Levenshtein, or trigram-similarity patient search out of the box. There is **no confidence-tier (high/medium) scoring** for name search.

---

## 3. MDM / `Patient/$match` / golden records — **`$match` SUPPORTED (live-verified); NOT Levenshtein; no golden-record automation**

> **Version note:** Local checkout = **v5.1.3** (no `$match`). Deployed CalMHSA server = **v5.1.13** (`software.version` from `/fhir/R4/metadata`). `$match` was added in between, in `packages/server/src/fhir/operations/patientmatch.ts` (confirmed present at git tag `v5.1.13`). All citations in this section are to the **v5.1.13** `patientmatch.ts`.

### 3.1 `Patient/$match` EXISTS and works — VERIFIED (live)
**Live call** (`POST https://medplum-api.calmhsa-works.dev/fhir/R4/Patient/$match`, body = Parameters with a partial Patient) → **HTTP 200**, `Bundle/searchset`, each entry carrying:
```json
"search": { "mode": "match", "score": 1,
  "extension": [{ "url": "http://hl7.org/fhir/StructureDefinition/match-grade", "valueCode": "certain" }] }
```
This is the FHIR R4 `Patient/$match` contract (https://hl7.org/fhir/R4/patient-operation-match.html). Handler: `patientmatch.ts:56` `patientMatchHandler`.

**Input parameters supported** (`patientmatch.ts:33-37`, parsed at `:57`):
| Param | Meaning |
|---|---|
| `resource` (Patient, required) | the (partial) patient to match; must include ≥1 of identifier/name/birthDate/telecom/gender (`patientmatch.ts:63-67`) |
| `count` (integer) | max results (default `DEFAULT_SEARCH_COUNT`) (`patientmatch.ts:86`) |
| `onlyCertainMatches` (boolean) | if true, return only `grade='certain'` (`patientmatch.ts:95`) |

### 3.2 The actual algorithm — **weighted EXACT-equality, NOT Levenshtein / phonetic**

The source comment is explicit (`patientmatch.ts:179-181`): *“This is intentionally a **simple baseline algorithm**. Future iterations should incorporate probabilistic (e.g. Fellegi-Sunter) or ML-based scoring.”*

**Candidate gathering** (`gatherCandidates`, `patientmatch.ts:113-174`) — three exact-equality searches, deduped by id:
1. by `identifier` (`system|value`, exact) — strongest signal;
2. by `birthdate` (exact) — broad net (chosen over family name because surnames change);
3. by `telecom` phone/email (exact).
> ⚠️ Candidates come **only** from exact identifier/birthdate/telecom searches. If none of those three match exactly, the patient is **never even considered** — there is no fuzzy candidate retrieval.

**Scoring** (`scoreCandidate`, `patientmatch.ts:185-276`) — sum of field weights over fields present on **both** records, normalized by the total weight of compared fields:

| Field | Weight | Comparison | line |
|---|---|---|---|
| identifier | 0.40 | exact `value` (+ system) | `patientmatch.ts:195-211` |
| family name | 0.20 | exact (lowercased); **else `startsWith` prefix → half weight** | `patientmatch.ts:214-220` |
| given name | 0.15 | exact (any given matches any given) | `patientmatch.ts:223-233` |
| birthDate | 0.20 | exact string | `patientmatch.ts:236-245` |
| phone | 0.30 | exact | `patientmatch.ts:248-257` |
| email | 0.30 | exact | `patientmatch.ts:248-266` |
| gender | 0.05 | exact | `patientmatch.ts:266-273` |

`normalizedScore = score / totalWeight` (`patientmatch.ts:273`). **The only non-exact comparison anywhere is the family-name `startsWith` prefix** (`patientmatch.ts:218`). There is **no Levenshtein, no Jaro-Winkler, no Soundex/Metaphone, no trigram** — grep of `patientmatch.ts` for those terms = 0 hits.

**Match-grade thresholds** (`patientmatch.ts:26-29, 279-290`) — **hard-coded constants, NOT configurable** without a code change:
- `score ≥ 0.90` → `certain`
- `score ≥ 0.65` → `probable`
- `score ≥ 0.40` → `possible`
- `< 0.40` → `certainly-not` (dropped from results, `patientmatch.ts:98`).

### 3.3 Live probes prove it is exact-equality, not typo-tolerant — VERIFIED

Run against the live CalMHSA server (existing record: given `Tom`, family `Nick`, DOB `1996-02-06`):

| Probe | Input | Result | Why (per algorithm) |
|---|---|---|---|
| A exact | `Tom Nick` + DOB `1996-02-06` | `score 1.0` → **certain** | family✔+given✔+dob✔, all exact |
| B family typo | **`Nikc`** Tom + DOB | `score 0.636` → **possible** | `nikc`≠`nick` and not a prefix → family scores **0**; only given(.15)+dob(.2) of 0.55 → 0.636. **The typo was NOT corrected — it ranked low only because DOB+given still matched** |
| C given typo | Nick **`Tomm`** + DOB | `score 0.727` → **probable** | `tomm`≠`tom` → given scores 0; family(.2)+dob(.2) of 0.55 → 0.727 |
| D name only, no DOB | `Tom Nick` | `total 0` | no exact identifier/birthdate/telecom → **no candidates gathered at all** |
| E correct name, wrong DOB | `Tom Nick` + `1975-01-01` | `total 0` | birthdate search misses; no other exact key → no candidates |
| F given only | `Tom` | `total 0` | no candidate-gathering key |

> The fractional scores look “fuzzy” but are pure arithmetic from exact-match weights. `Garsia`→`Garcia` or `Katherine`→`Catherine` would **not** be corrected: the misspelled record either fails candidate-gathering (no exact birthdate/id/telecom) or scores the name field as 0. **Confirmed: no edit-distance.**

### 3.4 Golden record / dedup automation — still **NOT built-in (Bots)**
`$match` returns scored candidates, but Medplum does **not** auto-create golden/master records or `Patient.link`s, and there is no dedup pipeline. That remains a customer-built **Bot + Subscription** workflow:
- Docs: `packages/docs/docs/fhir-datastore/patient-deduplication/{matching.mdx,merging.mdx}` (merging via `Patient.link` `replaced-by`/`replaces`).
- Blog: `2023-03-08-patient-deduplication.md`, `2023-08-30-empi-implementation.mdx` (Bots + `RiskAssessment` + `Task` + `Questionnaire`).

> **Bottom line for MDM (corrected):** Medplum **has** a real, scored `Patient/$match` with FHIR match-grades (parity with HAPI on *having the endpoint*). But its matching is **exact-equality + family-prefix only** — **not Levenshtein/phonetic**, and thresholds are hard-coded. Golden-record/dedup automation still must be built with Bots. So on **typo-tolerant identity resolution**, HAPI (LEVENSHTEIN rule) still wins; on **having a scored $match endpoint**, they are at parity.

---

## 4. Custom SearchParameters — **PARTIAL (definable, NOT hot-loaded)**

### 4.1 What works
- A custom `SearchParameter` resource validates and is indexable via a **FHIRPath `expression`** evaluated at write time:
  - `packages/server/src/fhir/repo.ts:1864-1913` `buildColumn()` → `evalFhirPathTyped(impl.parsedExpression, …)` at **repo.ts:1890**.
  - `packages/core/src/search/details.ts:82-155` parses/validates the expression; `details.ts:103-127` has special handling for `extension.value.code`, `extension.value.coding.code`, `extension.valueDateTime`.
- `SearchParameter.base` **must** include the resource type or it throws (`packages/server/src/fhir/searchparameter.ts:101-103`).
- Real example using an extension expression: `searchparameter.test.ts:206-211` (`us-core-condition-asserted-date`).

### 4.2 The catch — **not picked up just by POSTing it**
- At index/search time, the repo only consults `getStandardAndDerivedSearchParameters(resourceType)` (`repo.ts:1385, 1736`), which calls `getSearchParameters()` →
  `globalSchema.types[resourceType].searchParams` (**`packages/core/src/types.ts:294-295`**).
- `globalSchema` is populated **once at startup** from bundled JSON via `loadStructureDefinitions()` (`app.ts:235` → `structure.ts:9-16` → `indexSearchParameterBundle`).
- There is **no write-path hook** that calls `indexSearchParameter()` when a user `POST`s a `SearchParameter`. The super-admin `rebuildR4SearchParameters` (`seeds/searchparameters.ts:14`, `admin/super.ts:88`) only rebuilds the **standard R4** set.
- **Consequence:** a `POST /SearchParameter` is stored as a resource but is **not queryable** until it is loaded into `globalSchema` (i.e. baked into the definitions bundle / loaded at boot) and existing Patients are **re-indexed**.

> **For CalMHSA:** SSN-last-4, pronouns, behavioral-health extension fields are **achievable** as custom token/string/date SearchParameters (FHIRPath over `identifier`/extensions), but require a **build + deploy + reindex**, not a runtime POST. Datetime arrays are excluded (`details.ts:118-127`).

---

## 5. Working curls (UNVERIFIED — pattern, anchored to handlers/tests)

> ⚠️ **Not executed against a live server** (no Docker in this env). Each curl's endpoint/params are backed by the cited handler or test. Replace `{{MEDPLUM_BASE_URL}}` (e.g. `http://localhost:8103/fhir/R4`), `{{TOKEN_URL}}` (e.g. `http://localhost:8103/oauth2/token`), `{{CLIENT_ID}}`, `{{CLIENT_SECRET}}`.

### 5.0 Auth — OAuth2 client_credentials → Bearer token
*Proof endpoint accepts this grant: `packages/server/src/oauth/routes.test.ts:24-41` (grant_type=client_credentials → access_token → `Authorization: Bearer` on `/fhir/R4/...`).*

```bash
# Get token
ACCESS_TOKEN=$(curl -s -X POST {{TOKEN_URL}} \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=client_credentials' \
  -d 'client_id={{CLIENT_ID}}' \
  -d 'client_secret={{CLIENT_SECRET}}' | jq -r .access_token)

AUTH="Authorization: Bearer $ACCESS_TOKEN"
BASE={{MEDPLUM_BASE_URL}}
```

### 5.1 Create Patients (full demographics) — `POST /Patient`
*Proof: standard FHIR create via `routes.ts`; SSN/MRN identifier type codings per US Core / FHIR v2-0203.*

```bash
curl -s -X POST "$BASE/Patient" -H "$AUTH" -H 'Content-Type: application/fhir+json' -d '{
  "resourceType":"Patient",
  "identifier":[
    {"type":{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/v2-0203","code":"SS"}]},"system":"http://hl7.org/fhir/sid/us-ssn","value":"123-45-6789"},
    {"type":{"coding":[{"system":"http://terminology.hl7.org/CodeSystem/v2-0203","code":"MR"}]},"system":"https://calmhsa.org/mrn","value":"MRN-1001"}
  ],
  "name":[{"use":"official","family":"Garcia","given":["Catherine"]},{"use":"nickname","given":["Cathy"]}],
  "gender":"female","birthDate":"1985-03-12",
  "telecom":[{"system":"phone","value":"555-201-3344","use":"mobile"},{"system":"email","value":"cathy.garcia@example.org"}],
  "address":[{"line":["123 Main St"],"city":"Sacramento","state":"CA","postalCode":"95814","country":"US"}],
  "communication":[{"language":{"coding":[{"system":"urn:ietf:bcp:47","code":"es"}]}}]
}'
# Repeat with varied data: Smith/Smyth, Jon/John, MRN-1002.., DOB across years for range tests.
```

### 5.2 Read all Patients — `GET /Patient`
```bash
curl -s "$BASE/Patient?_count=50" -H "$AUTH"
```

### 5.3 Demographic searches — **VERIFIED-SUPPORTED params** (run unverified)
*Each param/modifier proven supported in §1; test anchors noted.*

```bash
# By family + given (FTS/word match)            [lookuptable.ts:176-188]
curl -s "$BASE/Patient?family=Garcia&given=Catherine" -H "$AUTH"

# Exact name                                     [lookuptable.ts:167; search.test.ts proof of :exact parse]
curl -s "$BASE/Patient?family:exact=Garcia" -H "$AUTH"

# Substring (case-insensitive ILIKE)             [humanname.ts:58; lookuptable.ts:168-174; search.test.ts:158]
curl -s "$BASE/Patient?name:contains=arci" -H "$AUTH"

# DOB exact                                      [SP birthdate=Patient.birthDate]
curl -s "$BASE/Patient?birthdate=1985-03-12" -H "$AUTH"

# DOB / age range (born 1980..1990)              [search.ts:1582-1602; search.test.ts:172]
curl -s "$BASE/Patient?birthdate=ge1980-01-01&birthdate=le1990-12-31" -H "$AUTH"

# SSN full (system|value)                        [token-column.ts:363-372; search.test.ts:3242]
curl -s "$BASE/Patient?identifier=http://hl7.org/fhir/sid/us-ssn|123-45-6789" -H "$AUTH"

# MRN (system|value)                             [token-column.ts:363-372]
curl -s "$BASE/Patient?identifier=https://calmhsa.org/mrn|MRN-1001" -H "$AUTH"

# Identifier value only (any system)             [search.test.ts:3248]
curl -s "$BASE/Patient?identifier=MRN-1001" -H "$AUTH"

# Phone                                          [SP phone=Patient.telecom.where(system='phone')]
curl -s "$BASE/Patient?phone=555-201-3344" -H "$AUTH"

# Address (string, ILIKE on contains)            [address.ts:11-17; lookuptable]
curl -s "$BASE/Patient?address=Sacramento" -H "$AUTH"
curl -s "$BASE/Patient?address:contains=Main" -H "$AUTH"

# Gender                                         [token-column]
curl -s "$BASE/Patient?gender=female" -H "$AUTH"

# Language (communication.language)              [SP language=Patient.communication.language]
curl -s "$BASE/Patient?language=es" -H "$AUTH"
```

### 5.4 Fuzzy searches — **PARTIAL / NOT SUPPORTED**

```bash
# ✅ WORKS (word/prefix FTS, NOT typo-tolerant)  [sql.ts:137-162; lookuptable.ts:176-188]
curl -s "$BASE/Patient?name:text=garc" -H "$AUTH"        # matches "Garcia" (prefix), NOT "Garsia"

# ✅ WORKS (substring)                            [lookuptable.ts:168-174]
curl -s "$BASE/Patient?family:contains=arci" -H "$AUTH"  # finds "Garcia", will NOT fix "Garsia"

# ❌ NOT SUPPORTED — typo/phonetic. There is NO query that turns "Garsia"->"Garcia"
#    or "Katherine"->"Catherine". No soundex/metaphone/levenshtein/trigram on Patient.
#    (grep: 0 phonetic hits; pg_trgm only on Coding table v77.ts:12-14)
# curl "$BASE/Patient?name:fuzzy=Garsia"   # <-- no such modifier; would 400/ignore
```

### 5.5 `Patient/$match` — **✅ SUPPORTED — VERIFIED (live)** (Medplum ≥ v5.1.13)

> Built-in operation `patientmatch.ts`. Returns a searchset with `search.score` + `match-grade`. Algorithm = weighted exact-equality (§3.2), **not** Levenshtein.

```bash
# VERIFIED against https://medplum-api.calmhsa-works.dev (HTTP 200)
curl -s -X POST "$BASE/Patient/\$match" -H "$AUTH" -H 'Content-Type: application/fhir+json' -d '{
  "resourceType":"Parameters",
  "parameter":[
    {"name":"resource","resource":{"resourceType":"Patient",
       "name":[{"family":"Nick","given":["Tom"]}],"birthDate":"1996-02-06"}},
    {"name":"count","valueInteger":100}
  ]
}'
# → Bundle entry: "search": {"mode":"match","score":1,
#      "extension":[{"url":".../match-grade","valueCode":"certain"}]}

# Optional: only the strongest matches
#   add  {"name":"onlyCertainMatches","valueBoolean":true}  to the parameter array.
```

**How to read it:** each `entry.search.score` is 0–1; `entry.search.extension[match-grade].valueCode` ∈ `certain (≥0.90)` / `probable (≥0.65)` / `possible (≥0.40)`; anything `<0.40` (`certainly-not`) is omitted. Thresholds are **hard-coded** (`patientmatch.ts:26-29`).

**What `$match` will NOT do (verified by live probes, §3.3):** correct typos/phonetic variants. `family=Nikc` (typo) still returned the `Nick` record but only as `possible` — because DOB+given matched exactly, **not** because the surname was fuzzily corrected. A record reachable only by a misspelled name (no exact id/DOB/telecom) returns **`total 0`**.

**For typo-tolerant / golden-record MDM you must still build:** a Bot that does fuzzy candidate retrieval (your own Levenshtein/phonetic, or Postgres `fuzzystrmatch`/`pg_trgm`) and writes `Patient.link` / `RiskAssessment`.

---

## 6. HAPI vs Medplum — Client Search comparison

| Capability | HAPI FHIR (verified by you) | Medplum (this repo) | What Medplum needs for parity (effort) |
|---|---|---|---|
| **Demographic search** (name/DOB/range/SSN/MRN/phone/address/gender/language) | Native | **Native** (§1) — parity | None (matches). SSN-last-4 needs a custom SP (small) |
| **Fuzzy / phonetic** (typo-tolerant, confidence tiers) | Hibernate Search/Lucene (`_content`, `:text`), phonetic analyzers | **No** phonetic; only word/prefix FTS (`:text`) + substring (`:contains`). No confidence tiers (§2) | **Medium–Large:** add `pg_trgm`/`fuzzystrmatch` index on HumanName + custom search route, OR front Medplum with OpenSearch/Elasticsearch with phonetic+fuzzy analyzers. Not configurable today |
| **Scored `$match` endpoint** | `$match` operation, scored candidates + match-grade | **✅ Has it (v5.1.13, live-verified §3).** Returns score + match-grade | **Parity on the endpoint.** None to *have* it |
| **`$match` algorithm quality** | LEVENSHTEIN similarity rule (typo-tolerant) | **Weighted EXACT-equality** only (+ family `startsWith`); **no edit-distance/phonetic**; thresholds hard-coded (§3.2-3.3) | **Medium:** fork/extend `patientmatch.ts` or wrap in a Bot to add Levenshtein/phonetic candidate retrieval + scoring; make thresholds configurable |
| **Golden records / dedup automation** | Native MDM (golden + links) | **No engine.** `$match` gives candidates but no auto golden-record/`Patient.link`; patterns only (Bots + `RiskAssessment` + `Patient.link`) (§3.4) | **Large:** EMPI pipeline (Subscription→Bot→`$match`/score→RiskAssessment→human review→`Patient.link`). Reference: `medplum-demo-bots/src/deduplication` |
| **Custom SearchParameters** | Supported (with reindex) | **Partial:** definable via FHIRPath, but **not hot-loaded on POST** — needs bundle load + restart + reindex (§4) | **Small–Medium:** bake custom SPs (SSN-last-4, pronouns, BH extensions) into the definitions bundle/deploy and run a reindex. Cannot be added purely at runtime |

### Net assessment (corrected after live testing)
- **Demographics:** Medplum **matches** HAPI. ✅
- **Scored `$match` endpoint:** **Parity.** Medplum v5.1.13 has a real built-in `Patient/$match` returning `score` + FHIR `match-grade` (live-verified). My initial "not supported" was a **stale-checkout error** (local v5.1.3 vs deployed v5.1.13). ✅
- **Match *quality* (typo-tolerant identity resolution):** **HAPI still wins.** HAPI's `$match` uses a **LEVENSHTEIN** rule; Medplum's is **weighted exact-equality** (only the family name allows a `startsWith` prefix), with **hard-coded thresholds** and **exact-only candidate gathering**. It will not correct `Garsia`→`Garcia`. Closing this gap = Medium effort (extend `patientmatch.ts` or wrap in a Bot).
- **Fuzzy/phonetic free-text patient search:** **HAPI wins** (Lucene). Medplum offers only word/prefix FTS + substring; no phonetic/edit-distance.
- **Golden-record / dedup automation:** **HAPI wins** (native MDM). Medplum provides primitives (`$match`, `Patient.link`, Bots) but no built-in pipeline.
- **Custom SearchParameters:** both can do it; Medplum is **less ergonomic** (no runtime hot-add; requires redeploy + reindex).

---

## Appendix — primary evidence files
- Parser: `packages/core/src/search/search.ts` (141, 215, 101-114, 389)
- Server search executor: `packages/server/src/fhir/search.ts` (1003, 1275-1276, 1582-1602)
- Lookup tables: `packages/server/src/fhir/lookups/lookuptable.ts` (167-188), `humanname.ts` (25-28, 58), `address.ts` (11-17), `util.ts` (21)
- Token columns: `packages/server/src/fhir/token-column.ts` (181-195, 198-218, 239-252, 363-372)
- FTS SQL: `packages/server/src/fhir/sql.ts` (137-162, 213-224)
- pg_trgm (terminology only): `packages/server/src/migrations/schema/v77.ts` (12-14), `migrate.ts` (860)
- ValueSet similarity (not patients): `packages/server/src/fhir/operations/expand.ts` (443)
- **`$match` (v5.1.13):** `packages/server/src/fhir/operations/patientmatch.ts` — handler `:56`; params `:33-37`; thresholds `:26-29`; candidate gather `:113-174`; scoring weights `:185-276`; grade classify `:279-290`. **Absent in local v5.1.3 checkout** (`operations/find.ts` there is Schedule-only).
- Deployed server version: `GET /fhir/R4/metadata` → `software.version = 5.1.13-770590d`, `fhirVersion 4.0.1` (live).
- Custom SP indexing: `packages/server/src/fhir/repo.ts` (1385, 1736, 1864-1913), `searchparameter.ts` (101-103), `packages/core/src/search/details.ts` (82-155, 103-127), `core/src/types.ts` (238-248, 294-295)
- Custom SP loaded at boot only: `packages/server/src/app.ts` (235), `fhir/structure.ts` (9-16), `seeds/searchparameters.ts` (14)
- MDM/dedup docs: `packages/docs/docs/fhir-datastore/patient-deduplication/{patient-deduplication.md,matching.mdx,merging.mdx}`, `packages/docs/blog/2023-03-08-patient-deduplication.md`, `2023-08-30-empi-implementation.mdx`
- OAuth client_credentials: `packages/server/src/oauth/routes.test.ts` (24-41)

> **Verification status:**
> - **VERIFIED (live):** `Patient/$match` (§3, §5.5) and deployed server version — run against `https://medplum-api.calmhsa-works.dev` (HTTP 200). The `$match` algorithm is verified from `patientmatch.ts` @ git tag `v5.1.13` (the deployed version) **plus** live probe behavior.
> - **VERIFIED (repo):** demographic/fuzzy code citations from direct reads of the local checkout (**v5.1.3**).
> - **UNVERIFIED (pattern):** the §5.1–5.4 demographic/fuzzy curls were not executed end-to-end against the live server; their parameter support is proven by the cited handlers/tests.
> - ⚠️ **Version caveat:** local checkout (v5.1.3) lags the deployed server (v5.1.13). Always confirm a capability against the **deployed** version via `/fhir/R4/metadata`, not just the local tree — that gap caused my initial wrong `$match` conclusion.
> - ⚠️ **SHA caveat:** `/metadata` reports `5.1.13-770590d`. The `-770590d` suffix is the build commit's git short-SHA (`scripts/build-docker-server.sh`). That SHA is **not** the upstream v5.1.13 tag commit (`13aa866`) and is not in the fork, so it could not be resolved to a reachable tree. **Per user decision, deployed-code citations use the upstream `v5.1.13` git tag as a source-of-truth PROXY** (prod confirmed pure-stock 5.1.13) plus live API behavior — they are a tag-proxy, not byte-verified against the `770590d` build. To byte-verify, pull/extract the `medplum/medplum-server:5.1.13` Docker image and read its baked `packages/server/dist`.
