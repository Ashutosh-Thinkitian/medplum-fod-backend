# Feature Comparison Matrix — Medplum vs HAPI FHIR

**Scope:** Client search/match (F1) + MDM golden-record & link-management lifecycle (F2).
**Servers (both LIVE-VERIFIED 2026-06-08):**
- Medplum `medplum/medplum-server:5.1.13` @ `https://medplum-api.calmhsa-works.dev/fhir/R4`
- HAPI FHIR `8.10.0` (MDM enabled) @ `https://hapi-fhir-api.calmhsa-works.dev/fhir`

**Scoring:** 2 = full support / wins, 1 = partial, 0 = absent. Winner = higher score (Tie if equal).

---

## F1 — Client / Patient Search & Match

| Feature ID | Feature | Criterion / Capability | What It Evaluates | Test Scenario / Evidence | Medplum — Behaviour | Medplum Score | HAPI FHIR — Behaviour | HAPI Score | Winner | Importance | Technical Comment | Last Verified |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F1.1 | Client/Patient Search | Exact match (name+DOB / +identifier) | Deterministic match on full name+DOB or known identifier | Scenarios 1 & 5 | 1.0 / certain | 2 | 1.0 / certain | 2 | Tie | High | Baseline deterministic match; identical behaviour | 08-06-2026 |
| F1.2 | | Typo tolerance (single-char, "Garcis"→"Garcia") | Misspelled surname still matches on the name itself | Scenario 2: Garcis+DOB | Name scores 0; 0.636/possible only because DOB carries it | 0 | 0.639/possible — surname itself fuzzy-matched | 2 | HAPI FHIR | High | Medplum has no fuzzy name scoring; HAPI applies fuzzy/similarity matching on the name | 08-06-2026 |
| F1.3 | | Dropped-letter tolerance ("Garca") | Match when a char is missing from surname | Scenario 3: Garca+DOB | Name scores 0; 0.636/possible (DOB-carried) | 0 | 0.639/possible — surname matched | 2 | HAPI FHIR | High | Same root cause — no name-level fuzzy match in Medplum | 08-06-2026 |
| F1.4 | | Name-only fuzzy match (no DOB) | Can a fuzzy/partial name find a record with no DOB | Scenario 4: typo/dropped name, no DOB | 0 results | 0 | 0.472/possible — still surfaces candidate | 2 | HAPI FHIR | High | Decisive gap: no DOB → Medplum returns nothing; HAPI still finds likely matches | 08-06-2026 |
| F1.5 | | Phonetic matching ("Garsia"→"Garcia") | Match on names that sound alike | Soundex G620 hit, name-only = 0.639 | No phonetic algorithm | 0 | Yes — Soundex (G620) | 2 | HAPI FHIR | Medium | HAPI ships Soundex/Metaphone/Cologne matchers; Medplum has none | 08-06-2026 |
| F1.6 | | Rejects garbage name (false-positive control) | Wrong surname + correct DOB must NOT match | Control: "Zzzzzz"+correct DOB | Returns 0.636/possible — name ignored, DOB drives false-ish positive | 0 | 0 results — correctly rejects | 2 | HAPI FHIR | High | Critical for dedup integrity; Medplum over-matches (name contributes nothing) | 08-06-2026 |
| F1.7 | | Confidence: scored + match-grade output | Returns numeric score + grade, not a bare boolean | All scenarios | Yes — score + certain/possible | 2 | Yes — score + match-grade | 2 | Tie | Medium | Both expose graded output for a human review queue | 08-06-2026 |
| F1.8 | | Configurable thresholds / algorithms | Tune thresholds/algorithms without code | Medplum 0.90/0.65/0.40 hard-coded | Hard-coded in source (`patientmatch.ts:26-29`) | 0 | `mdm-rules.json` — tunable matchers + thresholds | 2 | HAPI FHIR | High | HAPI externalises rules to config; Medplum needs code edit + redeploy | 08-06-2026 |
| F1.9 | | Works out-of-the-box on deployed server | Capability live without extra build | Both live 08-06-2026 | Yes — `$match` works on deployment | 2 | Yes — with MDM module enabled (it is) | 2 | Tie | Medium | Both live-verified; HAPI needs MDM switched on (it is) | 08-06-2026 |

**F1 subtotal:** Medplum **6** / HAPI **18** → **HAPI wins F1.**

---

## F1-BOT — Client / Patient Search & Match: **Medplum + Fuzzy-Match Bot** vs HAPI FHIR

> This section is **additive** — it does NOT replace the F1 comparison above (which is Medplum's *built-in* `$match`). Here we add a custom Medplum **Bot** ([bots/fuzzy-match/](../bots/fuzzy-match/)) that does its own broad candidate gathering + Levenshtein/Damerau + Soundex scoring, then re-run the identical F1 battery to see whether Medplum can reach HAPI parity with a Bot.
>
> **Live-verified 2026-06-11** against a local Medplum (`medplum/medplum-server:5.1.13` via `docker compose`), target patient **Maria Elena Garcia / 1985-03-12** in project CalMHSA-FOD. The "Medplum + Bot" values below are the actual `POST /Bot/{id}/$execute` responses.

| Feature ID | Feature | Criterion / Capability | Test Scenario / Evidence | Medplum + Bot — Behaviour (live) | M+Bot Score | HAPI FHIR — Behaviour | HAPI Score | Winner | Importance | Technical Comment | Last Verified |
|---|---|---|---|---|---|---|---|---|---|---|---|
| F1.1 | Client/Patient Search (Bot) | Exact match (name+DOB / +identifier) | Garcia/Maria/1985-03-12 | 1.0 / certain | 2 | 1.0 / certain | 2 | Tie | High | Identical to built-in for exact case | 11-06-2026 |
| F1.2 | | Typo tolerance ("Garcis"→"Garcia") | Garcis + DOB | **0.9063 / certain — surname scored via edit-distance** | 2 | 0.639 / possible | 2 | Tie* | High | Bot fixes the built-in gap (was name=0); *Bot returns `certain` vs HAPI `possible` — higher confidence | 11-06-2026 |
| F1.3 | | Dropped-letter tolerance ("Garca") | Garca + DOB | **0.955 / certain** | 2 | 0.639 / possible | 2 | Tie* | High | Damerau-Levenshtein dist 1 + Soundex; *higher score than HAPI | 11-06-2026 |
| F1.4 | | Name-only fuzzy match (no DOB) | Garca, no DOB | **0.94 / certain — returns candidate** | 2 | 0.472 / possible | 2 | Tie* | High | Bot does its own name-token candidate search (built-in returned 0); *higher score than HAPI | 11-06-2026 |
| F1.5 | | Phonetic matching ("Garsia"→"Garcia") | Garsia, no DOB | **0.94 / certain (Soundex G620)** | 2 | Yes — Soundex (G620) | 2 | Tie | Medium | Bot adds Soundex; built-in had none | 11-06-2026 |
| F1.6 | | Rejects garbage name (false-positive control) | "Zzzzzz" + correct DOB | **total 0 — correctly rejects** | 2 | 0 results — rejects | 2 | Tie | High | Bot's family-dominant weighting drops garbage below threshold (built-in over-matched) | 11-06-2026 |
| F1.7 | | Confidence: scored + match-grade output | All scenarios | Yes — `search.score` + `match-grade` extension | 2 | Yes — score + match-grade | 2 | Tie | Medium | Bot returns `$match`-shaped Bundle | 11-06-2026 |
| F1.8 | | Configurable thresholds / algorithms | thresholds tuning | Partial — thresholds via `Bot.secrets` (no redeploy); matching algorithm is code you own | 1 | `mdm-rules.json` — fully config-driven | 2 | HAPI FHIR | High | Bot externalises thresholds but not the algorithm; HAPI externalises both | 11-06-2026 |
| F1.9 | | Works out-of-the-box on deployed server | live | Requires building + deploying the Bot, the project's `bots` feature enabled, and an admin client | 1 | with MDM module enabled (it is) | 2 | HAPI FHIR | Medium | Bot is custom code to deploy/maintain; HAPI MDM is a built-in module toggle | 11-06-2026 |

**F1-BOT subtotal:** Medplum + Bot **14** / HAPI **18** → **near-parity** (was 6/18 for built-in Medplum).

### Verdict for F1 with the Bot
- **On the actual matching rows (F1.1–F1.7): parity, and the Bot equals or beats HAPI.** Where built-in Medplum lost (typo, dropped-letter, name-only, phonetic, garbage), the Bot now matches at `certain` — in F1.2/F1.3/F1.4 it returns a *higher* confidence than HAPI's `possible`, because it scores the surname with Damerau-Levenshtein + Soundex and anchors on the family name.
- **Remaining gaps vs HAPI (F1.8, F1.9):** the Bot's thresholds are tunable via `Bot.secrets`, but the algorithm is code you own and maintain (HAPI tunes everything via `mdm-rules.json`); and the Bot is not out-of-the-box — it must be built, deployed, and the project's `bots` feature enabled.
- **Net:** A Medplum Bot **can make Medplum competitive with HAPI on client search** (14/18 vs 18/18). The residual 4-point gap is "config-vs-code" and "deploy effort," not matching capability. (This section is F1 only — golden-record/MDM lifecycle (F2 below) is still a large custom build on Medplum.)

### How it was verified (reproducible)
- Bot source + 37 unit tests: [bots/fuzzy-match/](../bots/fuzzy-match/) (`npm test`).
- Deploy + live battery: `BASE=http://localhost:8103 TOKEN=<token> ./bots/fuzzy-match/scripts/deploy-and-test.sh` (see [LOCAL-TEST.md](../bots/fuzzy-match/LOCAL-TEST.md)).
- Live output 2026-06-11 (target Maria Garcia, 3 duplicate copies in the test data, all scoring identically): F1.1 → 1.0 certain; F1.2 → 0.9063 certain; F1.3 → 0.955 certain; F1.4 → 0.94 certain; F1.5 → 0.94 certain; F1.6 → total 0.

---

## F2 — MDM Golden-Record & Link Management

| Feature ID | Feature | Criterion / Capability | What It Evaluates | Test Scenario / Evidence | Medplum — Behaviour | Medplum Score | HAPI FHIR — Behaviour | HAPI Score | Winner | Importance | Technical Comment | Last Verified |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F2.1 | Golden-Record MDM | Golden/master record concept | System-managed survivorship master per real person | Golden `_tag` search | None — no golden-record concept | 0 | 10 golden records w/ `GOLDEN_RECORD` tag + EID | 2 | HAPI FHIR | High | HAPI auto-creates managed masters; Medplum has no such resource type/tag (absent in v5.1.13 source + live metadata) | 08-06-2026 |
| F2.2 | | Golden-record `_tag` search | Find all masters via `Patient?_tag=…\|GOLDEN_RECORD` | `Patient?_tag=…mdm-record-status\|GOLDEN_RECORD` | 0 — tag never created | 0 | `total: 10` golden records | 2 | HAPI FHIR | High | The MDM record-status tag is a HAPI construct; Medplum emits nothing comparable | 08-06-2026 |
| F2.3 | | Auto-link on ingest | Duplicates auto-linked to a golden record on create | `$mdm-query-links` for Patient/1011 | Duplicates stay separate (3 unlinked Aiden Garcia rows) | 0 | 3 sources auto-linked, `linkSource=AUTO`, score 1.0 | 2 | HAPI FHIR | High | HAPI does automatic survivorship; Medplum requires Bot + `Patient.link` | 08-06-2026 |
| F2.4 | | Enterprise ID (EID) | Stable cross-record enterprise identifier on master | Golden records carry EID | None | 0 | Each golden has an EID (e.g. 088ab05e-…) | 2 | HAPI FHIR | Medium | EID anchors a person across source systems; not present in Medplum | 08-06-2026 |
| F2.5 | | Inspect links — `$mdm-query-links` | Query links by golden/source/grade/source-type | `?goldenResourceId=Patient/1011` | No links concept; no operation | 0 | Returns links w/ matchResult, linkSource, score, timestamps | 2 | HAPI FHIR | High | Full link visibility; Medplum can only read `Patient.link` you wrote yourself | 08-06-2026 |
| F2.6 | | Manual link create — `$mdm-create-link` | Manually link a source to a golden record | Op advertised in metadata | Not available | 0 | Available | 2 | HAPI FHIR | Medium | Operator can force a link; Medplum = custom code | 08-06-2026 |
| F2.7 | | Manual re-grade — `$mdm-update-link` | Override a link to MATCH/NO_MATCH (AUTO→MANUAL) | Advertised; AUTO/MANUAL distinction seen in links | Not available | 0 | Available (MANUAL overrides survive auto-matcher) | 2 | HAPI FHIR | High | Human-in-the-loop review; verified present (not executed — mutating) | 08-06-2026 |
| F2.8 | | Link audit — `$mdm-link-history` | Audit trail of link grade changes | Op advertised | Not available | 0 | Available | 2 | HAPI FHIR | Medium | Compliance/audit of merge decisions; Medplum = build your own | 08-06-2026 |
| F2.9 | | Duplicate-golden detection — `$mdm-duplicate-golden-resources` | Find duplicate master records | Ran live → `total: 0` | Not available | 0 | Works (`total: 0` currently) | 2 | HAPI FHIR | High | Surfaces over-split masters for merge; Medplum has no masters to dedupe | 08-06-2026 |
| F2.10 | | Merge masters — `$mdm-merge-golden-resources` | Merge two golden records into one | Op advertised | Not available | 0 | Available | 2 | HAPI FHIR | High | Resolves duplicate masters; Medplum = custom merge logic | 08-06-2026 |
| F2.11 | | Declare distinct — `$mdm-not-duplicate` | Mark two goldens as genuinely different people | Op advertised | Not available | 0 | Available | 2 | HAPI FHIR | Medium | Prevents repeat false-merge suggestions | 08-06-2026 |
| F2.12 | | Batch/reset — `$mdm-submit` / `$mdm-clear` | Bulk (re)run MDM / clear links | Ops advertised | Not available | 0 | Available | 2 | HAPI FHIR | Medium | Bulk re-matching after rule changes; Medplum = batch Bot job | 08-06-2026 |
| F2.13 | | Config-driven MDM rules | Candidate search + matchers + result map in config | `mdm-rules.json` | Code/Bots only | 0 | `mdm-rules.json` (tunable) | 2 | HAPI FHIR | High | Rules externalised; Medplum requires code | 08-06-2026 |

**F2 subtotal:** Medplum **0** / HAPI **26** → **HAPI wins F2 (clean sweep).**

---

## FINAL VERDICT

| Area | Medplum Score | HAPI Score | Winner |
|---|---|---|---|
| **F1 — Client Search & Match** | 6 / 18 | 18 / 18 | **HAPI FHIR** |
| **F2 — MDM Golden-Record & Links** | 0 / 26 | 26 / 26 | **HAPI FHIR** |
| **TOTAL** | **6 / 44** | **44 / 44** | **🏆 HAPI FHIR** |

| Final Verdict | Detail |
|---|---|
| **Overall winner** | **HAPI FHIR** (44/44 vs 6/44) |
| **Where they tie** | Exact match, scored/graded output, out-of-the-box availability (F1.1, F1.7, F1.9) |
| **Where Medplum is adequate** | Exact name+DOB / +identifier matching, graded `$match` output — fine when an exact DOB/identifier is always entered |
| **Where Medplum fails outright** | All fuzzy/phonetic name matching, false-positive rejection, configurability, and the **entire** golden-record/MDM lifecycle (F2) |
| **Fit for CalMHSA §3.1 (typo-tolerant, name-led dedup + one golden record per person)** | **HAPI meets it natively; Medplum does not** |
| **Effort to reach parity** | HAPI: already there (tune `mdm-rules.json`). Medplum: large custom build — fork `patientmatch.ts` for fuzzy match **and** build the full MDM lifecycle (Bots + `Patient.link` + custom link/audit store + dedup jobs) |

**One-line:** On client search HAPI matches the actual name (fuzzy/phonetic, name-only, rejects garbage) while Medplum's `$match` is exact-only with a DOB crutch; on MDM HAPI ships a complete golden-record subsystem while Medplum ships nothing. **HAPI FHIR is the clear platform for CalMHSA identity management.**

---

### Verification status
✅ **All rows live-verified 2026-06-08.** HAPI (no auth): F1 match battery + controls; F2 golden `_tag` (`total:10`), `$mdm-query-links?goldenResourceId=Patient/1011` (3 AUTO links), `$mdm-duplicate-golden-resources` (`total:0`), 10-op MDM suite in `/metadata`. `$mdm-update-link`/`-create-link`/`-merge`/`-not-duplicate`/`-link-history`/`-submit`/`-clear` confirmed **advertised** (not all executed — several are mutating). Medplum absence verified via live `/metadata` (empty ops) **and** git tag `v5.1.13` source scan (no `mdm-*`/`GOLDEN_RECORD`/golden-resource/link-merge files). Detail docs: `medplum-vs-hapi-match-comparison.md`, `medplum-vs-hapi-mdm-golden-record-comparison.md`.

> Note: "fuzzy/similarity matching on the name" describes the deployed HAPI's observed behaviour. The exact configured matcher (Levenshtein vs Jaro-Winkler vs Cologne/Soundex blend) on the *deployed* server was not byte-confirmed — the committed repo `mdm-rules.json` used COLOGNE+SOUNDEX, but the deployed rules differ. Behaviour is verified; the precise algorithm name is not asserted.
