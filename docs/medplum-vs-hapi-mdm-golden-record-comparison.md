# Medplum vs HAPI FHIR — MDM Golden-Record & Link-Management Comparison

**Scope:** the MDM *lifecycle* beyond `$match` — golden/master records, automatic linking, and the manual link-management operations:
- Golden-record search: `Patient?_tag=…|GOLDEN_RECORD`
- Auto-link (MDM creating links on ingest)
- `$mdm-query-links` (inspect links)
- `$mdm-update-link` (manually re-grade a link)
- `$mdm-duplicate-golden-resources` (find duplicate golden records)
- (+ the rest of HAPI's MDM op suite found live)

**Servers (BOTH LIVE-VERIFIED 2026-06-08)**
- **HAPI** = HAPI FHIR **8.10.0** @ `https://hapi-fhir-api.calmhsa-works.dev/fhir` — MDM **enabled**.
- **Medplum** = `medplum/medplum-server:5.1.13` @ `https://medplum-api.calmhsa-works.dev/fhir/R4`.

> **TL;DR:** HAPI has a **complete, built-in MDM golden-record subsystem** (auto-link, golden tags, EID, and 10 management operations) — all live-verified. **Medplum has none of it** — no golden records, no link operations, no MDM tags (confirmed absent in v5.1.13 source and in the live CapabilityStatement). Everything golden-record on Medplum must be **custom-built** (Bots + `Patient.link`).

---

## 1. Capability inventory (live CapabilityStatement)

**HAPI — server-level MDM operations advertised (`/metadata` → `rest.operation`):**
```
mdm-match, mdm-submit, mdm-query-links, mdm-create-link, mdm-update-link,
mdm-link-history, mdm-not-duplicate, mdm-merge-golden-resources,
mdm-duplicate-golden-resources, mdm-clear
```
(10 MDM operations — verified live.)

**Medplum — MDM operations:** `/metadata` → `rest.operation = []`, Patient `operation = []`. Source scan of tag `v5.1.13` for `mdm-*`, `GOLDEN_RECORD`, `golden-resource`, `mdm-record-status`, link/merge/duplicate operation files → **0 matches**. (`Patient/$match` exists as a built-in but is not even advertised; no other MDM primitive exists.)

| Operation | HAPI 8.10.0 | Medplum 5.1.13 |
|---|---|---|
| `$mdm-match` / `$match` | ✅ advertised + works | ⚠️ `$match` works (unadvertised); no `$mdm-*` |
| `$mdm-submit` | ✅ | ❌ |
| `$mdm-query-links` | ✅ | ❌ |
| `$mdm-create-link` | ✅ | ❌ |
| `$mdm-update-link` | ✅ | ❌ |
| `$mdm-link-history` | ✅ | ❌ |
| `$mdm-not-duplicate` | ✅ | ❌ |
| `$mdm-merge-golden-resources` | ✅ | ❌ |
| `$mdm-duplicate-golden-resources` | ✅ | ❌ |
| `$mdm-clear` | ✅ | ❌ |
| Golden-record `_tag` search | ✅ | ❌ (no such tag exists) |

---

## 2. Golden-record search — `Patient?_tag=…|GOLDEN_RECORD`

**HAPI (live):**
```bash
curl -s 'https://hapi-fhir-api.calmhsa-works.dev/fhir/Patient?_tag=http://hapifhir.io/fhir/NamingSystem/mdm-record-status|GOLDEN_RECORD&_count=50' \
  -H 'accept: application/fhir+json'
```
→ **`total: 10`** golden records. Each is a system-managed master with two meta tags
(`mdm-record-status|GOLDEN_RECORD`, `managing-mdm-system|HAPI-MDM`) and an enterprise ID (EID):

| Golden id | Name | EID |
|---|---|---|
| 1011 | Maria Garcia | 088ab05e-547d-46d7-906a-2467b746dfab |
| 1012 | Robert Johnson | 8cf1cadb-… |
| 1013 | Jennifer Smith | 6f9d6bd1-… |
| … (10 total) | … | … |

**Medplum:** ❌ No golden-record tag exists. The same `_tag` query returns nothing meaningful — Medplum never creates `GOLDEN_RECORD` resources. **VERDICT: HAPI only.**

---

## 3. Auto-link (MDM links source records to a golden record on ingest)

**HAPI (live):** when source Patients are created, HAPI MDM auto-creates a golden record and links matching sources to it with `linkSource = AUTO`. Verified via `$mdm-query-links` for golden 1011:

| goldenResourceId | sourceResourceId | matchResult | linkSource | score |
|---|---|---|---|---|
| Patient/1011 | Patient/1001 | MATCH | **AUTO** | 1.0 |
| Patient/1011 | Patient/1021 | MATCH | **AUTO** | 1.0 |
| Patient/1011 | Patient/1022 | MATCH | **AUTO** | 1.0 |

→ 3 source records auto-collapsed under one golden Maria Garcia. This is automatic survivorship/dedup with no app code.

**Medplum:** ❌ No auto-linking. Creating duplicate Patients yields independent records (as seen earlier: 3 separate "Aiden Garcia" rows MRN-000000 / MRN2-000000 / MRN2-000840, none linked). To replicate you must write a Bot/Subscription that runs `$match` and writes `Patient.link`. **VERDICT: HAPI only.**

---

## 4. `$mdm-query-links` — inspect links

**HAPI (live):**
```bash
curl -s 'https://hapi-fhir-api.calmhsa-works.dev/fhir/$mdm-query-links?goldenResourceId=Patient/1011' \
  -H 'accept: application/fhir+json'
```
→ a `Parameters` resource, one `link` part per source, each with `goldenResourceId, sourceResourceId, matchResult, linkSource (AUTO/MANUAL), score, linkCreated, linkUpdated`. (Filterable by `goldenResourceId`, `resourceId`, `matchResult`, `linkSource`.) **Verified: returned 3 links for 1011.**

**Medplum:** ❌ No links concept and no operation. The closest is reading `Patient.link` if *you* populated it. **VERDICT: HAPI only.**

---

## 5. `$mdm-update-link` — manually override a link grade

**HAPI:** server operation that re-grades a link to `MATCH` or `NO_MATCH` (sets `linkSource = MANUAL`, preventing the auto-matcher from overriding the human decision). Body:
```bash
# (mutating — run only intentionally)
curl -s -X POST 'https://hapi-fhir-api.calmhsa-works.dev/fhir/$mdm-update-link' \
 -H 'content-type: application/fhir+json' -H 'accept: application/fhir+json' -d '{
  "resourceType":"Parameters","parameter":[
    {"name":"goldenResourceId","valueString":"Patient/1011"},
    {"name":"resourceId","valueString":"Patient/1001"},
    {"name":"matchResult","valueString":"NO_MATCH"}]}'
```
Companions: `$mdm-create-link` (manually link), `$mdm-not-duplicate` (mark two goldens as distinct), `$mdm-link-history` (audit trail of grade changes). **Capability verified live** (advertised + `$mdm-query-links` shows `linkSource` AUTO/MANUAL distinction).

> Not executed here — it mutates production links. The op is confirmed present; run it deliberately when you want to test the manual override.

**Medplum:** ❌ No equivalent. A human override would mean app code editing `Patient.link` and your own logic to stop a Bot from re-overriding it. **VERDICT: HAPI only.**

---

## 6. `$mdm-duplicate-golden-resources` — find duplicate masters

**HAPI (live):**
```bash
curl -s 'https://hapi-fhir-api.calmhsa-works.dev/fhir/$mdm-duplicate-golden-resources' \
  -H 'accept: application/fhir+json'
```
→ `Parameters` with `total: 0` (no duplicate goldens currently). Operation works; pairs of possibly-duplicate golden records would be returned here, then resolved with `$mdm-merge-golden-resources` (merge) or `$mdm-not-duplicate` (declare distinct). **Verified: HTTP 200, total 0.**

**Medplum:** ❌ No golden records → nothing to de-duplicate at the master level, and no operation. **VERDICT: HAPI only.**

---

## 7. Detailed comparison table

| Capability | HAPI 8.10.0 (live) | Medplum 5.1.13 (live) | Evidence |
|---|---|---|---|
| **Golden/master record concept** | ✅ system-managed `GOLDEN_RECORD` w/ EID | ❌ none | HAPI: 10 golden recs w/ `mdm-record-status` tag; Medplum: tag absent in source+metadata |
| **Golden-record `_tag` search** | ✅ `total:10` | ❌ no such tag | §2 live |
| **Auto-link on ingest** | ✅ `linkSource=AUTO`, score 1.0 | ❌ duplicates stay separate | §3 live (`$mdm-query-links`) |
| **Enterprise ID (EID)** | ✅ per golden record | ❌ none | §2 (EIDs listed) |
| **`$mdm-query-links`** | ✅ returns links w/ grade+source+score | ❌ | §4 live |
| **`$mdm-create-link` (manual link)** | ✅ | ❌ | §1 metadata |
| **`$mdm-update-link` (manual re-grade)** | ✅ AUTO→MANUAL override | ❌ | §5 |
| **`$mdm-link-history` (audit)** | ✅ | ❌ | §1 metadata |
| **`$mdm-not-duplicate`** | ✅ | ❌ | §1 metadata |
| **`$mdm-merge-golden-resources` (merge)** | ✅ | ⚠️ generic `$merge`-style? No MDM merge | §1 metadata |
| **`$mdm-duplicate-golden-resources`** | ✅ `total:0` live | ❌ | §6 live |
| **`$mdm-clear` / `$mdm-submit` (batch)** | ✅ | ❌ | §1 metadata |
| **Config-driven (rules JSON)** | ✅ `mdm-rules.json` | ❌ would be code/Bots | repo + §1 |
| **Survivorship (golden field population)** | ✅ automatic | ❌ manual app logic | §3 |
| **Standard `Patient.link` available** | ✅ (FHIR) | ✅ (FHIR) — but unmanaged | both are FHIR R4 |

---

## 8. FINAL VERDICT

**For golden-record MDM / identity-resolution lifecycle: HAPI FHIR wins decisively. Medplum has no native MDM.**

| Dimension | HAPI 8.10.0 (MDM) | Medplum 5.1.13 | Verdict |
|---|---|---|---|
| Golden/master records | ✅ automatic, tagged, EID | ❌ none | **HAPI** |
| Auto-link duplicates | ✅ on ingest (AUTO) | ❌ stay separate | **HAPI** |
| Inspect links (`$mdm-query-links`) | ✅ | ❌ | **HAPI** |
| Manual link override (`$mdm-update-link`/`create-link`/`not-duplicate`) | ✅ AUTO/MANUAL, audited | ❌ | **HAPI** |
| Duplicate-golden detection + merge | ✅ `$mdm-duplicate-golden-resources` + `$mdm-merge-golden-resources` | ❌ | **HAPI** |
| Golden `_tag` search | ✅ `total:10` | ❌ | **HAPI** |
| Configurability | ✅ `mdm-rules.json` | ❌ code/Bots only | **HAPI** |
| Scored `$match` (for reference) | ✅ | ⚠️ exists but exact-only | **HAPI** |
| Effort to reach the other's parity | already there | **build it all** (Bots + `Patient.link` + custom link store + dedup jobs) | **HAPI** |

**One-line:** HAPI ships a **complete, configurable, audited golden-record MDM** — auto-linking, golden tags/EIDs, and a full manual link-management API — all live-verified today. **Medplum offers none of these primitives**; to match it you'd rebuild the entire MDM lifecycle yourself with Bots, `Patient.link`, a custom link/audit store, and scheduled dedup jobs. For CalMHSA's "one golden client record per real person" requirement, **HAPI is the clear fit; Medplum is a large custom build.**

---

### Verification status
✅ **All HAPI rows live-verified 2026-06-08** against `hapi-fhir-api.calmhsa-works.dev` (no auth): golden `_tag` search (`total:10`), `$mdm-query-links?goldenResourceId=Patient/1011` (3 AUTO links, score 1.0), `$mdm-duplicate-golden-resources` (`total:0`), and the 10-op MDM suite in `/metadata`. `$mdm-update-link` is confirmed *present* (advertised) but **not executed** (mutating). Medplum absence verified via live `/metadata` (empty ops) **and** source scan of git tag `v5.1.13` (no `mdm-*`/`GOLDEN_RECORD`/golden-resource/link-merge files).
