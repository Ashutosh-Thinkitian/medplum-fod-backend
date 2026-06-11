# Medplum `$match` vs HAPI FHIR `$mdm-match` — Head-to-head (5 scenarios)

**Goal:** compare identity-matching across 5 scenarios — (1) exact name+DOB, (2) typo, (3) dropped letter, (4) broad fuzzy (name only), (5) name+DOB+identifier (high confidence) — using the live CalMHSA Patient data.

**Servers (BOTH LIVE-VERIFIED 2026-06-08)**
- **Medplum** = `medplum/medplum-server:5.1.13` @ `https://medplum-api.calmhsa-works.dev/fhir/R4` — built-in `Patient/$match`. Target patient: **Aiden Garcia**, DOB `1940-01-01`, MRN `urn:calmhsa:mrn|MRN-000000`.
- **HAPI** = HAPI FHIR **8.10.0** @ `https://hapi-fhir-api.calmhsa-works.dev/fhir` — **MDM is ENABLED and running** (Patient ops include `match`; `GOLDEN_RECORD`/`HAPI-MDM` resources exist). Target patient: **Maria Elena Garcia**, DOB `1985-03-12`, MRN `MRN-2001` (Patient id 1001; golden record 1011).

> Both use the FHIR-standard `POST /Patient/$match` with a `Parameters` body and return a Bundle with `search.score` + `match-grade`. HAPI also exposes `$mdm-submit`, `$merge`, `$undo-merge` (real MDM lifecycle).

---

## ⚠️ Corrections to earlier premises (now resolved with live data)

1. **HAPI's match quality (live):** HAPI's `$match` here **does real fuzzy name matching** — it matches misspelled names **even with no DOB** (proven below). The deployed rules differ from the repo's committed `mdm-rules.json` (which used COLOGNE/SOUNDEX); the live server behaves like a similarity/phonetic blend. (The local repo also had `mdm_enabled: false`, but the **deployed** HAPI clearly has MDM on — always trust the live server, per our version lesson.)
2. **Medplum's "typo match" is NOT fuzzy (live-proven):** Medplum returns a misspelled-name record **only when an exact DOB/identifier also matches**; the name itself contributes nothing (a garbage surname scores the same as a 1-letter typo). See §1.

---

## 1. Medplum `Patient/$match` — algorithm (verified from source v5.1.13)

`packages/server/src/fhir/operations/patientmatch.ts`:
- **Candidate gathering** (`:113-174`): exact searches on **identifier**, **birthdate**, **telecom (phone/email)** only. If none of those is present+exact, **no candidates** are gathered → empty result, regardless of name.
- **Scoring** (`scoreCandidate`, `:185-276`): weighted **exact-equality**; only the **family name** allows a `startsWith` prefix (half weight). **No Levenshtein / phonetic.** Weights: identifier .40, family .20 (prefix → .10), given .15, birthDate .20, phone .30, email .30, gender .05. Score = sum / (total weight of fields present on both).
- **Grades** (`:26-29`): `certain ≥0.90`, `probable ≥0.65`, `possible ≥0.40`, else `certainly-not` (dropped).

### Results for the 5 scenarios — **VERIFIED LIVE 2026-06-08** (fresh token, target = Aiden Garcia)

| # | Scenario | Input | Candidate gathered? | Score | Grade | Why |
|---|---|---|---|---|---|---|
| 1 | Exact name+DOB | Garcia/Aiden/1940-01-01 | yes (DOB) | **1.000** ✅live | **certain** | fam .20 + giv .15 + dob .20 = .55/.55 |
| 2 | Typo `Garcis` | Garcis/Aiden/1940-01-01 | yes (DOB) | **0.6364** ✅live | **possible** | fam=**0** (≠, no prefix) + giv .15 + dob .20 = .35/.55 |
| 3 | Dropped letter `Garca` | Garca/Aiden/1940-01-01 | yes (DOB) | **0.6364** ✅live | **possible** | fam=**0** (not a `startsWith` prefix) + giv .15 + dob .20 |
| 4 | Name only (no DOB) | Garca/Aiden (no DOB) | **NO** | — | — | **0 results** ✅live — candidate gathering needs exact id/DOB/telecom |
| 5 | name+DOB+identifier | +MRN-000000 | yes (id+DOB) | **1.000** (0.95→1.0) | **certain** | id .40 + fam .20 + giv .15 + dob .20 |

### 🔬 The decisive control tests (live) — proving the name is **NOT** fuzzy-matched

| Control | Surname sent | Given | DOB | Score | Conclusion |
|---|---|---|---|---|---|
| Dropped `Garca` | Garca | Aiden | 1940-01-01 (right) | **0.6364** | record returned |
| Typo `Garcis` | Garcis | Aiden | 1940-01-01 (right) | **0.6364** | same as Garca |
| **Garbage `Zzzzzz`** | Zzzzzz | Aiden | 1940-01-01 (right) | **0.6364** | **IDENTICAL** → surname scored 0 regardless of how wrong; name has **zero** fuzzy influence |
| Dropped `Garca` | Garca | Aiden | **1999-12-31 (wrong)** | **0 results** | the **DOB**, not the name, was seeding/carrying the match |
| Dropped `Garca` | Garca | Aiden | **(none)** | **0 results** | no DOB/id/telecom → no candidates at all |
| Prefix `Garc` | Garc | Aiden | 1940-01-01 | **0.8182** | only non-exact name rule = `startsWith` prefix → half-weight (.10) |
| Wrong given `Xyz` | Garcia | Xyz | 1940-01-01 | **0.7273** | confirms given scored 0; family+dob = .40/.55 |

> **What "I got the typo back" really means (live-proven):** the misspelled record is returned **only because the exact DOB seeded candidate-gathering and the given+DOB cleared the `possible` ≥0.40 threshold** — NOT because Medplum corrected the name. `Garca`, `Garcis`, and even `Zzzzzz` all score **identically 0.6364**, so the surname contributes nothing. Remove the DOB crutch (wrong/absent DOB) and you get **0 results**. The ONLY non-exact name comparison is a `startsWith` **prefix** (`Garc`→`Garcia`, score 0.8182). **This is not edit-distance / typo-tolerance.** (Matches `patientmatch.ts:214-220`.)

### Medplum curls (work today — refresh the Bearer token first)

> Token expires ~hourly. Get a fresh one, then run. Replace `$TOKEN`.

```bash
TOKEN='<PASTE FRESH BEARER TOKEN>'
U='https://medplum-api.calmhsa-works.dev/fhir/R4/Patient/$match'
H=(-H "Authorization: Bearer $TOKEN" -H 'content-type: application/fhir+json' -H 'accept: application/fhir+json')

# 1. EXACT (name + DOB)  -> expect score 1.0 / certain
curl -s "$U" "${H[@]}" -d '{"resourceType":"Parameters","parameter":[
  {"name":"resource","resource":{"resourceType":"Patient","name":[{"family":"Garcia","given":["Aiden"]}],"birthDate":"1940-01-01"}}]}'

# 2. TYPO (Garcis) + DOB  -> expect score 0.636 / possible (typo NOT corrected)
curl -s "$U" "${H[@]}" -d '{"resourceType":"Parameters","parameter":[
  {"name":"resource","resource":{"resourceType":"Patient","name":[{"family":"Garcis","given":["Aiden"]}],"birthDate":"1940-01-01"}}]}'

# 3. DROPPED LETTER (Garca) + DOB  -> expect score 0.636 / possible
curl -s "$U" "${H[@]}" -d '{"resourceType":"Parameters","parameter":[
  {"name":"resource","resource":{"resourceType":"Patient","name":[{"family":"Garca","given":["Aiden"]}],"birthDate":"1940-01-01"}}]}'

# 4. BROADER FUZZY (name only, NO dob)  -> expect TOTAL 0 (candidate gathering needs id/dob/telecom)
curl -s "$U" "${H[@]}" -d '{"resourceType":"Parameters","parameter":[
  {"name":"resource","resource":{"resourceType":"Patient","name":[{"family":"Garcia","given":["Aiden"]}]}}]}'

# 5. HIGH CONFIDENCE (name + DOB + identifier)  -> expect score 1.0 / certain (0.95)
curl -s "$U" "${H[@]}" -d '{"resourceType":"Parameters","parameter":[
  {"name":"resource","resource":{"resourceType":"Patient",
     "identifier":[{"system":"urn:calmhsa:mrn","value":"MRN-000000"}],
     "name":[{"family":"Garcia","given":["Aiden"]}],"birthDate":"1940-01-01"}},
  {"name":"onlyCertainMatches","valueBoolean":false}]}'
```
**Read the result:** each `entry.search.score` (0–1) and `entry.search.extension[match-grade].valueCode`.

> ✅ **VERIFIED LIVE 2026-06-08** with a fresh token against `medplum-api.calmhsa-works.dev`. The scores in the table above and the control tests are real server responses, not predictions. (Note: the target now has 3 Aiden-Garcia duplicates in the data — MRN-000000, MRN2-000000, MRN2-000840 — all return the same score.)

---

## 2. HAPI `$mdm-match` — algorithm (from this repo's config + 8.10.0 jars)

- **Operation:** `POST /fhir/Patient/$mdm-match` (HAPI MDM). With MDM enabled, HAPI also exposes the FHIR-standard `POST /fhir/Patient/$match`. Returns a `Bundle` whose entries carry `search.score` + the `match-grade` extension (`certain`/`probable`/`possible`).
- **Candidate gathering** (`mdm-rules.json:4-18`): `candidateSearchParams` = Patient **birthdate**, any **identifier**, Patient **general-practitioner**; filtered to `active=true` (`:19-26`).
- **Match fields (AS CONFIGURED in this repo, `:27-46`):** given name → `COLOGNE` (phonetic), family name → `SOUNDEX` (phonetic). **These are phonetic, not Levenshtein.**
- **Result map** (`:47-50`): `cosine-given-name` alone → `POSSIBLE_MATCH`; `cosine-given-name,jaro-last-name` (both) → `MATCH`.
- **Available but unused matchers (8.10.0):** structural/phonetic `MatchTypeEnum` = STRING, SUBSTRING, SOUNDEX, METAPHONE, DOUBLE_METAPHONE, REFINED_SOUNDEX, CAVERPHONE1/2, COLOGNE, NYSIIS, MATCH_RATING_APPROACH, NICKNAME, NAME_ANY_ORDER, NAME_FIRST_AND_LAST, DATE, IDENTIFIER, NUMERIC; similarity `MdmSimilarityEnum` = **JARO_WINKLER, COSINE, JACCARD, LEVENSCHTEIN, SORENSEN_DICE** (+ NUMERIC variants).

### HAPI curls — **work today** (MDM is enabled on the deployed server)

```bash
B='https://hapi-fhir-api.calmhsa-works.dev/fhir'   # MDM ON; no auth needed
HJ=(-H 'content-type: application/fhir+json' -H 'accept: application/fhir+json')
M="$B/Patient/\$match"     # FHIR-standard; $mdm-match also works

# 1. EXACT name+DOB
curl -s "$M" "${HJ[@]}" -d '{"resourceType":"Parameters","parameter":[
  {"name":"resource","resource":{"resourceType":"Patient","name":[{"family":"Garcia","given":["Maria"]}],"birthDate":"1985-03-12"}}]}'

# 2. TYPO (Garcis) + DOB
curl -s "$M" "${HJ[@]}" -d '{"resourceType":"Parameters","parameter":[
  {"name":"resource","resource":{"resourceType":"Patient","name":[{"family":"Garcis","given":["Maria"]}],"birthDate":"1985-03-12"}}]}'

# 3. DROPPED LETTER (Garca) + DOB
curl -s "$M" "${HJ[@]}" -d '{"resourceType":"Parameters","parameter":[
  {"name":"resource","resource":{"resourceType":"Patient","name":[{"family":"Garca","given":["Maria"]}],"birthDate":"1985-03-12"}}]}'

# 4. BROADER FUZZY — NAME ONLY, no DOB  (the differentiator)
curl -s "$M" "${HJ[@]}" -d '{"resourceType":"Parameters","parameter":[
  {"name":"resource","resource":{"resourceType":"Patient","name":[{"family":"Garcis","given":["Maria"]}]}}]}'

# 5. HIGH CONFIDENCE (name + DOB + identifier)
curl -s "$M" "${HJ[@]}" -d '{"resourceType":"Parameters","parameter":[
  {"name":"resource","resource":{"resourceType":"Patient",
     "identifier":[{"system":"http://calmhsa-works.dev/fhir/identifier/mrn","value":"MRN-2001"}],
     "name":[{"family":"Garcia","given":["Maria"]}],"birthDate":"1985-03-12"}}]}'
```

### HAPI results — **VERIFIED LIVE 2026-06-08** (target Maria Garcia / 1985-03-12)

| # | Scenario | Score | Grade | Returns golden record? |
|---|---|---|---|---|
| 1 | Exact name+DOB | **1.0** | certain | ✅ source 1001 + GOLDEN 1011 |
| 2 | Typo `Garcis` + DOB | **0.639** | possible | ✅ |
| 3 | Dropped `Garca` + DOB | **0.639** | possible | ✅ |
| 4 | **Typo/dropped NAME-ONLY (no DOB)** | **0.472** | possible | ✅ **still matches!** |
| 5 | name+DOB+identifier | **1.0** | certain | ✅ |

### 🔬 HAPI control tests (live) — proving the name IS fuzzy-matched

| Control | Surname | Given | DOB | Score | Conclusion |
|---|---|---|---|---|---|
| **Garbage `Zzzzzz`** + correct DOB | Zzzzzz | Maria | 1985-03-12 | **0 results** | 💥 unlike Medplum, a wrong name is NOT carried by DOB — the **name must match** |
| Dropped `Garca` + **wrong DOB** | Garca | Maria | 1777-01-01 | **0.472 / possible** | 💥 misspelled name matches **without any DOB help** |
| Typo `Garcis` **name-only** | Garcis | Maria | (none) | **0.472 / possible** | real fuzzy name match |
| Dropped `Garca` **name-only** | Garca | Maria | (none) | **0.472 / possible** | real fuzzy name match |
| Phonetic `Garsia` **name-only** | Garsia | Maria | (none) | **0.639 / possible** | phonetic hit (Soundex G620) scores higher than the typo |
| Wrong given `Xyz` + family+DOB | Garcia | Xyz | 1985-03-12 | **0.667 / possible** | family+dob carry it |

> **HAPI does genuine fuzzy + phonetic name matching:** misspelled (`Garcis`/`Garca`) and phonetic (`Garsia`) surnames match **even with no DOB at all**, while a garbage surname (`Zzzzzz`) returns **nothing**. The name is actually scored — the opposite of Medplum.

---

## 3. Side-by-side outcome per scenario — BOTH LIVE-VERIFIED 2026-06-08

| # | Scenario | **Medplum 5.1.13** (live) | **HAPI 8.10.0 MDM** (live) | Winner |
|---|---|---|---|---|
| 1 | Exact name+DOB | ✅ 1.0 / certain | ✅ 1.0 / certain | tie |
| 2 | Typo `Garcis` + DOB | ⚠️ 0.636 / possible — **but name scored 0** (DOB carries it) | ✅ 0.639 / possible — **name actually matched** | **HAPI** |
| 3 | Dropped `Garca` + DOB | ⚠️ 0.636 / possible — name scored 0 | ✅ 0.639 / possible — name matched | **HAPI** |
| 4 | **Name only (no DOB)**, typo/dropped | ❌ **0 results** | ✅ **0.472 / possible — matches** | **HAPI (decisive)** |
| 5 | name+DOB+identifier | ✅ 1.0 / certain | ✅ 1.0 / certain | tie |
| — | Garbage name + correct DOB (control) | ⚠️ **0.636 returned** (false-ish positive: name ignored) | ✅ **0 results** (correctly rejects) | **HAPI** |
| — | Golden/master record | ❌ none | ✅ returns `GOLDEN_RECORD` (`HAPI-MDM`) | **HAPI** |

**Honest bottom line (live data):**
- **Exact & high-confidence (#1, #5): tie** — both return certain matches.
- **Typo / dropped-letter (#2, #3): HAPI wins.** Both *return* the record at a similar ~0.64 score, **but only HAPI actually matched the name.** Medplum's score is identical whether you type `Garca`, `Garcis`, or `Zzzzzz` — the surname contributes nothing; the exact DOB is doing all the work.
- **Name-only fuzzy (#4): HAPI wins decisively.** HAPI matches a misspelled name with **no DOB**; Medplum returns **0**.
- **Correctness on garbage input: HAPI wins.** A wrong name + right DOB returns nothing in HAPI (correct), but a `possible` in Medplum (misleading — the DOB carried a wrong name).
- **Golden records / dedup: HAPI wins** — it maintains `GOLDEN_RECORD` master records automatically; Medplum has none.

---

## 4. Against your requirement (§3.1 — "does this client already exist?")

The requirement is **typo-tolerant, name-led duplicate detection at intake.**
- **HAPI MDM (deployed):** ✅ **meets it.** Real fuzzy + phonetic name matching that works on name alone, scored + graded results, and automatic golden/master records for dedup. This is what the requirement describes.
- **Medplum `$match` (deployed):** ⚠️ **partially.** Useful when the operator enters an exact DOB/identifier/phone alongside the name, but it does **not** correct a misspelled name and **won't search by name alone** — so it misses the exact case the requirement targets (a clerk mistypes the surname). No golden records.

---

## 5. To make HAPI do **true Levenshtein** (edit-distance), set `mdm-rules.json`:

```json
"matchFields": [
  { "name": "lev-family", "resourceType": "*", "resourcePath": "name.family",
    "similarity": { "algorithm": "LEVENSCHTEIN", "matchThreshold": 0.8 } },
  { "name": "lev-given",  "resourceType": "*", "resourcePath": "name.given",
    "similarity": { "algorithm": "JARO_WINKLER", "matchThreshold": 0.8 } },
  { "name": "dob", "resourceType": "Patient", "resourcePath": "birthDate",
    "matcher": { "algorithm": "DATE" } }
],
"matchResultMap": { "lev-given,lev-family": "MATCH", "lev-family,dob": "MATCH", "lev-family": "POSSIBLE_MATCH" }
```
(`LEVENSCHTEIN` + `JARO_WINKLER` are valid `MdmSimilarityEnum` values in `hapi-fhir-server-mdm-8.10.0.jar`; similarity matchers use `matchThreshold` 0–1.)

## 6. To make **Medplum** typo-tolerant: there is no config — it requires **code** (fork `patientmatch.ts` to add Levenshtein/phonetic candidate retrieval + scoring) or a **Bot** doing fuzzy candidate search (Postgres `fuzzystrmatch`/`pg_trgm`) then its own scoring. Thresholds (0.90/0.65/0.40) are hard-coded.

---

## 7. FINAL VERDICT

**For CalMHSA client-search / duplicate-detection (requirement §3.1): HAPI FHIR wins.**

| Dimension | Medplum 5.1.13 | HAPI 8.10.0 (MDM, deployed) | Verdict |
|---|---|---|---|
| Exact match (name+DOB / +ID) | ✅ certain | ✅ certain | **Tie** |
| Typo tolerance (name) | ❌ name scored 0; only DOB carries it | ✅ real fuzzy name match | **HAPI** |
| Dropped-letter | ❌ same (name=0) | ✅ matches | **HAPI** |
| Name-only fuzzy (no DOB) | ❌ 0 results | ✅ matches | **HAPI** |
| Phonetic (`Garsia`→`Garcia`) | ❌ no | ✅ yes (Soundex) | **HAPI** |
| Rejects garbage name | ❌ returns `possible` (DOB-carried) | ✅ returns 0 | **HAPI** |
| Scored + match-grade output | ✅ yes | ✅ yes | **Tie** |
| Golden / master record (dedup) | ❌ none | ✅ `GOLDEN_RECORD` auto | **HAPI** |
| Configurable thresholds/algorithms | ❌ hard-coded, code-only | ✅ `mdm-rules.json` (Levenshtein/Jaro/Soundex/…) | **HAPI** |
| Works out-of-the-box on deployed server | ✅ yes | ✅ yes (MDM on) | **Tie** |

**One-line:** Both have a live, scored `Patient/$match`. But **Medplum's is exact-match-only with a DOB crutch** (it does not actually match misspelled names), while **HAPI's is a true fuzzy/phonetic MDM** that matches typos by name alone and maintains golden records — which is exactly what the intake-dedup requirement needs. To bring Medplum to parity you must write code (fork `patientmatch.ts` or a Bot with `pg_trgm`/`fuzzystrmatch`); HAPI gets there with a `mdm-rules.json` edit.

---

### Evidence
- Medplum algo: `patientmatch.ts` @ tag `v5.1.13` (`:26-29` thresholds, `:113-174` candidate gather, `:185-276` scoring).
- **Medplum live (2026-06-08):** `Garca`/`Garcis`/`Zzzzzz` + DOB all → 0.6364; wrong/no DOB → 0; `Garc` prefix → 0.8182.
- **HAPI live (2026-06-08):** `software 8.10.0`, Patient ops include `match`, `mdm-submit`, `merge`, `undo-merge`. Typo/dropped/phonetic match by name alone (0.472–0.639); garbage name → 0; `GOLDEN_RECORD`/`HAPI-MDM` resources present. Base `https://hapi-fhir-api.calmhsa-works.dev/fhir`.
- HAPI matcher catalog: `MatchTypeEnum` & `MdmSimilarityEnum` (incl. `LEVENSCHTEIN`, `JARO_WINKLER`) in `hapi-fhir-server-mdm-8.10.0.jar`.

> **Verification status:** ✅ **BOTH servers live-verified 2026-06-08** with real responses (curls in §1/§2 reproduce them). Medplum needs a fresh Bearer token; HAPI needs no auth. (Earlier draft predictions for HAPI were wrong about MDM being off — the *deployed* HAPI has MDM on; corrected here.)
