# Medplum Fuzzy Patient-Match Bot — Design Spec

**Date:** 2026-06-10
**Author:** Ashutosh (with Claude)
**Goal:** Prove that a **Medplum Bot** can bring Medplum's client/patient **search-match** (F1) to functional parity with HAPI FHIR MDM — using **Levenshtein distance** (Damerau-Levenshtein) + Soundex — and live-verify it with the same F1 battery used against HAPI.

**Out of scope (explicit):** golden/master records, auto-linking, `Patient.link`, merge/dedup lifecycle (F2). This spec is **search/match only**. The Bot is **read-only** — it reports scored candidates, it does not write/link/merge.

---

## 1. Problem (from live testing)

Medplum's built-in `Patient/$match` (v5.1.13, `patientmatch.ts`) uses **weighted exact-equality**; the name is only matched exact or by `startsWith` prefix. Live-proven gaps vs HAPI:
- Typo (`Garcis`), dropped-letter (`Garca`): name scores **0** (only an exact DOB carries the record).
- Name-only fuzzy (no DOB): **0 results** (candidate gathering needs exact id/DOB/telecom).
- Phonetic (`Garsia`): **no** match.
- Garbage name + correct DOB (`Zzzzzz`): returns `possible` (false-ish positive — name ignored).

HAPI MDM matches the **name itself** (fuzzy + phonetic), works name-only, and rejects garbage. We replicate that behavior with a Bot.

## 2. Architecture

A single Bot **`patient-fuzzy-match`**, invoked `POST {base}/fhir/R4/Bot/{id}/$execute` with a body **identical in shape to `$match`**:
```json
{ "resourceType":"Parameters","parameter":[
  {"name":"resource","resource":{ ...partial Patient... }},
  {"name":"count","valueInteger":100},
  {"name":"onlyCertainMatches","valueBoolean":false} ] }
```

Pipeline:
1. **Broad candidate gathering (FHIR API, not SQL).** Union of searches (deduped by id):
   - per family token: `Patient?family:contains=<token>`
   - per given token: `Patient?given:contains=<token>`
   - `Patient?birthdate=`, `Patient?phone=`, `Patient?email=`, `Patient?identifier=<system|value>` when present on input.
   - This is the **name-only / no-DOB fix** — built-in `$match` never seeds from the name.
   - *Substring caveat:* `:contains` is substring ILIKE, so a trailing-char typo (`Garcis`) won't substring-hit `Garcia`. Mitigation (in order): (a) also seed by the **first N chars** of each name token (`family:contains=Garc`), which catches `Garcia`, `Garca`, `Garcis`, `Garsia`-stem; (b) if a Soundex-backed custom SearchParameter exists, seed by it; (c) otherwise broad-fan-out by given-name token + score. The live test will confirm each F1 record is gathered; tune seeding if any row misses.
2. **Scoring (TypeScript, inlined — no external npm deps).** For fields present on **both** input and candidate:

   | Field | Weight | Comparison |
   |---|---|---|
   | identifier | 0.35 | exact (value + system) |
   | family | 0.30 | **fuzzy** (see below) |
   | given | 0.20 | **fuzzy** (best over all given/name entries) |
   | birthDate | 0.20 | exact |
   | phone | 0.20 | exact (digits-normalized) |
   | email | 0.20 | exact (lowercased) |
   | gender | 0.05 | exact |

   **Name fuzzy score (the core — Levenshtein-based):**
   ```
   nameScore = max(
     1 - damerauLevenshtein(a, b) / max(len(a), len(b)),   // Levenshtein distance (Damerau variant), normalized 0..1
     soundexEqual(a, b) ? 0.92 : 0                          // phonetic bonus
   )
   ```
   - `damerauLevenshtein` = Levenshtein distance (insert/delete/substitute) **+ adjacent transposition**. This is the **Levenshtein algorithm** at its core; Damerau adds transposition.
   - Strings normalized before compare: Unicode NFD (strip diacritics) + lowercase + trim.
   - `nameScore` is multiplied by the field weight (so a perfect name = full weight, a typo = high-but-<full, garbage = 0).
   - Multiple names handled: take the **max** nameScore across all `name[]`/`given[]` entries (official, nickname, maiden).

   `normalizedScore = Σ(weight × fieldScore) / Σ(weight of compared fields)`.
3. **Grade + output.** Map score → `certain / probable / possible` using thresholds from `Bot.secrets` (defaults **0.85 / 0.65 / 0.45**); below `possible` → dropped. Return a `Bundle` (searchset); each entry has `search.score` + `match-grade` extension — **same shape as `$match` and HAPI**.

## 3. Why each F1 row passes (projected; to be replaced by live numbers)

Target: Maria Garcia / 1985-03-12 (family len 6).

| F1 row | nameScore | Projected total | Grade | Pass |
|---|---|---|---|---|
| Exact name+DOB | 1.0 | ~1.0 | certain | ✅ |
| Typo `Garcis`+DOB | 1−1/6 = 0.833 | ~0.88 | certain/probable | ✅ name matched |
| Dropped `Garca`+DOB | 1−1/6 = 0.833 | ~0.88 | certain/probable | ✅ |
| Name-only (no DOB) | 0.833 | ~0.83 (name only) | probable | ✅ returns |
| Phonetic `Garsia` | Soundex G620 → 0.92 | ~0.92 | certain/probable | ✅ |
| Garbage `Zzzzzz`+DOB | 0 | dob-only ≈ 0.40 → below `possible` 0.45 | dropped | ✅ rejected |
| Scored+grade | — | yes | — | ✅ |

> Garbage rejection depends on threshold: with `possible=0.45`, a garbage-name + exact-DOB (name 0, dob full) normalizes to ~0.40 → dropped. Tunable via secrets; live test confirms.

## 4. Healthcare-integration nuances (baked in)

1. **Multiple names** (official + nickname + maiden) → score against best-matching entry, not `name[0]`.
2. **Diacritics/case** (`José`/`jose`) → NFD normalize + lowercase before distance.
3. **Transposition** (`Gracia`) → handled by Damerau variant (1 edit, not 2).
4. **Phone normalization** → compare digits only (`555-0201` == `5550201`).
5. **Read-only / no false-merge** → reports candidates only; never writes/links/merges.
6. **Configurable thresholds** → `Bot.secrets` (CERTAIN/PROBABLE/POSSIBLE), no redeploy to tune.
7. **Determinism** → no `Date.now()`/random in scoring; stable sort by score desc.

## 5. Deliverables & local-test flow

**I produce (unit-tested here — pure functions, no server):**
- `bots/patient-fuzzy-match.ts` — the Bot (inlined Damerau-Levenshtein + Soundex + gathering + scoring + `$match`-shaped output).
- `bots/patient-fuzzy-match.test.ts` — Vitest tests asserting each F1 case scores correctly (real green/red before deploy).
- `bots/deploy-and-test.sh` — one script **you** run after `docker compose up`: create Bot → upload code → create test Patient (Maria Garcia) → run full F1 battery vs `http://localhost:8103` → print results table.
- `bots/LOCAL-TEST.md` — exact steps + how to point the same script at prod later.

**You run (Docker available on your machine):**
`docker compose up` → `./bots/deploy-and-test.sh` → paste output → I fill the live **"Medplum + Bot"** column in `docs/medplum-vs-hapi-feature-matrix.md`. Repeat against prod when satisfied.

**Note:** Docker isn't runnable in the authoring environment, so server-integration proof happens on your machine; the matching *logic* is proven here via unit tests first.

## 6. Invocation contract

- **Endpoint:** `POST {base}/fhir/R4/Bot/{id}/$execute`, `Content-Type: application/fhir+json`, Bearer token.
- **Body:** `$match`-shaped `Parameters` (above).
- **Response:** `Bundle` searchset; `entry.search.score` (0–1) + `match-grade` extension. Below-threshold dropped. `onlyCertainMatches=true` → only `certain`. `count` caps results.

## 7. Success criteria

All six F1 rows live-verified against a local Medplum (then prod):
1. Exact → certain. 2. `Garcis`+DOB → name-scored match (not DOB-only). 3. `Garca`+DOB → match. 4. name-only typo (no DOB) → returns a candidate. 5. `Garsia` → phonetic match. 6. `Zzzzzz`+DOB → **no** match (rejected). Plus scored+graded output on all.

## 8. Risks / open items

- **Candidate gathering for trailing-char typos** via `:contains` substring — mitigated by stem-prefix seeding (§2.1); if insufficient, add a Soundex custom SearchParameter (requires definitions reload — out of scope for v1, noted as fallback).
- **Threshold tuning** — garbage-rejection vs typo-acceptance is threshold-sensitive; defaults chosen to pass F1, tunable via secrets.
- **Performance** — multiple searches per call; fine for interactive intake volume; not a bulk re-match engine.
- **Not config-driven like HAPI** — logic is code the team owns; thresholds are config, algorithm choice is not.
