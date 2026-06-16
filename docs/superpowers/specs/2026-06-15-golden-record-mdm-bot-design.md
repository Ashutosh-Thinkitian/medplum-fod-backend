# Golden-Record MDM Bot (F2) — Design Spec

**Date:** 2026-06-15
**Author:** Ashutosh (with Claude)
**Goal:** Implement a Medplum **Bot-based MDM subsystem** that satisfies the CalMHSA F2 (golden-record / link-management) criteria — the spec-sanctioned path for Medplum (§3.2/§1.4: *"Medplum requires custom Bot-based MDM"*). All 10 F2 criteria must be **testable via curl**; destructive operations are **propose-only** (human-gated), so testing is safe.

**Requirements source:** `CalMHSA-FOD: FHIR-Platform-Requirements-Specification.md` §3.2 (Cross-Agency Patient Matching / MDM) + §1.4 (Patient Identity Across Agencies).
**Prior art reused:** the F1 fuzzy-match bot's matching algorithm ([bots/fuzzy-match/](../../../bots/fuzzy-match/)).
**Feasibility analysis:** [docs/medplum-bots-f2-mdm-feasibility.md](../../medplum-bots-f2-mdm-feasibility.md).

---

## 1. Scope

**In scope (user choice = "test all 10 criteria; merge/override propose-only"):**
- Golden record creation (separate Patient, `GOLDEN_RECORD` tag + EID) — F2.1
- Auto-link on ingest with survivorship (MATCH→link, POSSIBLE→review queue) — F2.2
- Query links (source↔golden) — F2.3
- Manual link create (MANUAL) — F2.4
- Manual link override / re-grade — **propose-only** (creates Task) — F2.5
- Link history / audit (AuditEvent per change) — F2.6
- Duplicate-golden detection (scan + score pairs, no merge) — F2.7
- Resolve duplicate goldens: merge **propose-only** (Task) + not-duplicate marker — F2.8
- Config-driven thresholds + SoR priority via `Bot.secrets` — F2.9
- Works live on deployed server (vmcontext deploy) — F2.10

**Out of scope (explicit):**
- **Executing** a merge or override (only proposals/Tasks are created — a human approves later). No record is tombstoned or re-pointed automatically.
- `:mdm` search qualifier (Medplum has none; `query-links` is the equivalent).
- Runtime custom SearchParameters / `$reindex` (Medplum platform gap, §3.1).
- Cross-county linking (MDM links across **agencies** only; county is via Coverage — §1.4).
- Any change to the F1 fuzzy-match bot (it stays byte-for-byte untouched).

---

## 2. Architecture

One multi-operation Bot `golden-record-mdm`, invoked `POST /Bot/{id}/$execute` with a `Parameters` body whose `operation` param selects behavior. A thin dispatcher routes to one handler per operation. Read-mostly; the only writes are: create/update golden Patient, write `Patient.link` on a source, create RiskAssessment/Task/AuditEvent, write a not-duplicate marker. **No deletes, no merges executed.**

### File structure
```
bots/golden-record-mdm/
├── package.json, tsconfig.json, vitest.config.ts, esbuild-script.mjs   (same toolchain as fuzzy-match; CJS + vmcontext footer)
├── src/
│   ├── text-distance.ts        COPIED verbatim from fuzzy-match (zero F1 risk)
│   ├── scoring.ts              COPIED verbatim from fuzzy-match
│   ├── survivorship.ts         pure per-field survivorship rules
│   ├── golden.ts               golden helpers: tag/EID constants, findGoldenFor, createGolden, applySurvivorship
│   ├── audit.ts                writeLinkAuditEvent(medplum, action, golden, source)
│   ├── operations/
│   │   ├── link.ts             auto-link on ingest
│   │   ├── query-links.ts
│   │   ├── create-link.ts
│   │   ├── update-link.ts      propose-only
│   │   ├── merge.ts            propose-only
│   │   ├── not-duplicate.ts
│   │   └── find-duplicates.ts
│   ├── golden-record-mdm.ts    handler + operation dispatcher
│   └── *.test.ts               Vitest + MockClient per module
├── scripts/
│   ├── deploy-and-test-local.sh   create bot + seed data + run all-operation battery
│   └── deploy-bot-dev.sh          idempotent deploy (no battery)
└── LOCAL-TEST.md
```
> **DRY note:** `text-distance.ts` + `scoring.ts` are **copied** from fuzzy-match (user choice: zero F1 risk). If the matching algorithm changes later, both copies must be updated. Accepted tradeoff.

### Resource model (per design decisions)
- **Golden record** = a separate `Patient` resource:
  - `meta.tag`: `{system: 'http://hapifhir.io/fhir/NamingSystem/mdm-record-status', code: 'GOLDEN_RECORD'}` **and** `{system: 'https://calmhsa-works.dev/mdm/managing-system', code: 'CALMHSA-MDM'}`
  - `identifier`: EID `{system: 'https://calmhsa-works.dev/mdm-eid', value: <uuid-from-args/deterministic>}`
  - demographics = survivorship-aggregated from linked sources
  > **Tag systems:** we reuse HAPI's `mdm-record-status|GOLDEN_RECORD` tag so the same `_tag` query works (F2.1 parity), plus a CalMHSA managing-system tag.
- **Source link** = on each source Patient: `Patient.link { type: 'seealso', other: Reference(golden) }`. (Direction: source→golden, per §1.4.)
- **Link metadata** (grade/score/AUTO-MANUAL): stored in a companion `Basic` resource per link (since `Patient.link` has no score/source fields): `Basic { code: mdm-link, subject: source, ... extensions: golden, matchResult, linkSource, score }`. `query-links` reads these.
- **Review queue**: `RiskAssessment { status: final, code: duplicate-patient, subject: source, basis: [golden], probabilityDecimal, prediction.qualitativeRisk }` + `Task { status: requested, code: mdm-review, focus: RiskAssessment, for: source }`.
- **Audit**: `AuditEvent { type: rest, subtype: mdm-link/mdm-unlink/mdm-propose, entity: [golden, source], outcome }`.
- **Not-duplicate marker**: a `Basic { code: mdm-not-duplicate }` referencing both goldens, so `find-duplicates` skips the pair.
- **Reverse lookup**: `Patient?link=Patient/<golden>` finds all sources.

### Matching (reused from F1, copied)
`scoreCandidate` + grade classification (Damerau-Levenshtein + Soundex, family-dominant weighting, name/identifier anchor, BH-friendly low address weight). Thresholds from `Bot.secrets` (CERTAIN/PROBABLE/POSSIBLE), defaults 0.85/0.65/0.45.

### Survivorship rules (`survivorship.ts`, pure + heavily tested)
| Golden field | Rule | Implementation |
|---|---|---|
| name | most recent | name from source with latest `meta.lastUpdated`; tie → first |
| identifiers (SSN/Medi-Cal/MRN) | system-of-record priority | per system, take value from highest-priority source that has it. Priority = config list, default `['<medi-cal/CIN system>', '<ssn system>', '<mrn system>']` |
| address | most complete | score by # populated of {line,city,state,postalCode}; highest wins; tie → most recent |
| birthDate, gender | mode (most frequent) | majority across sources; tie → most-recent source |
| telecom (phone/email) | union | distinct values across sources, normalized (phone digits, email lowercase) |

Config (`Bot.secrets`): `CERTAIN`, `PROBABLE`, `POSSIBLE`, `SOR_PRIORITY` (comma-separated identifier systems), `EID_SYSTEM` (default `https://calmhsa-works.dev/mdm-eid`).

---

## 3. Operation contracts

All: `POST {BASE}/fhir/R4/Bot/{id}/$execute`, body `Parameters` with `operation` param. Returns `Parameters` (or `Bundle` where natural). Below, "source"/"golden" are Patient refs like `Patient/<id>`.

| `operation` | Input params | Behavior | Output (Parameters) |
|---|---|---|---|
| `link` | `resource` (Patient) | Run matcher vs existing source patients (exclude goldens). Best grade: **MATCH** → find-or-create golden, write `seealso` link on source, write link `Basic` (AUTO), recompute+save survivorship, AuditEvent. **POSSIBLE** → RiskAssessment + Task (no link). **NO_MATCH** → nothing. | `action` (linked\|review-queued\|no-match), `goldenRecord` (ref, if any), `score`, `linkedSources` (refs) |
| `query-links` | `goldenResourceId` **or** `resourceId` | If golden: reverse-search sources (`Patient?link=`) + their link `Basic`s. If source: read its link. | repeated `link` parts: `goldenResourceId`, `sourceResourceId`, `linkType`, `linkSource`, `matchResult`, `score` |
| `create-link` | `goldenResourceId`, `resourceId` | Write `seealso` link on source + link `Basic` (linkSource=MANUAL), AuditEvent. (Recompute survivorship.) | `outcome: linked`, `goldenResourceId`, `sourceResourceId`, `linkSource: MANUAL` |
| `update-link` | `goldenResourceId`, `resourceId`, `matchResult` (MATCH\|NO_MATCH) | **PROPOSE-ONLY:** create `Task` (code mdm-update-link, status requested) describing the requested re-grade. **No link change.** | `proposed: true`, `taskId`, `note` |
| `merge` | `sourceGolden`, `targetGolden` | **PROPOSE-ONLY:** create `Task` (code mdm-merge, status requested) proposing the merge. **No merge.** | `proposed: true`, `taskId`, `note` |
| `not-duplicate` | `goldenA`, `goldenB` | Write a `Basic` (code mdm-not-duplicate) referencing both; AuditEvent. `find-duplicates` will skip this pair. | `outcome: marked-distinct`, `markerId` |
| `find-duplicates` | optional `_count` | Search goldens (`_tag=GOLDEN_RECORD`), score pairs with matcher, exclude not-duplicate-marked pairs, return pairs ≥ POSSIBLE. **No merge.** | repeated `duplicatePair` parts: `goldenA`, `goldenB`, `score`, `grade` |

**Native (documented as curls, no bot):**
- F2.1 golden search: `GET {BASE}/fhir/R4/Patient?_tag=http://hapifhir.io/fhir/NamingSystem/mdm-record-status|GOLDEN_RECORD`
- F2.6 audit read: `GET {BASE}/fhir/R4/AuditEvent?entity=Patient/<golden>` (or `_sort=-_lastUpdated`)

**Errors:** unknown `operation` → OperationOutcome (`code: invalid`); missing required param → clear OperationOutcome; no candidates in `link` → `action: no-match` (200, not an error).

**Idempotency:** `link` finds existing golden via EID/tag (never mints a 2nd for the same cluster); re-linking an already-linked source is a no-op; survivorship recompute is deterministic.

---

## 4. Testing (Vitest + MockClient, run locally like F1)

- **`survivorship.test.ts`** — each rule independently: most-recent name; SoR-priority identifier (incl. config order); most-complete address; mode birthDate/gender with tie-break; telecom union + normalization; empty/missing fields.
- **`text-distance.test.ts` / `scoring.test.ts`** — copied tests from F1 (sanity that the copy is intact).
- **Per-operation tests** (seed MockClient patients, call `handler` with each `operation`):
  - `link`: MATCH → golden created + `seealso` link + Basic(AUTO) + survivorship correct; POSSIBLE → Task+RiskAssessment created, **no** link; NO_MATCH → nothing; second matching source → attaches to **same** golden (idempotent, no 2nd golden); garbage name → no-match.
  - `query-links`: returns one entry per linked source with grade/source/score.
  - `create-link`: writes MANUAL link + Basic + AuditEvent.
  - `update-link`: returns `proposed: true` + Task exists; **link unchanged** (assert mutation-free).
  - `merge`: returns `proposed: true` + Task exists; **both goldens unchanged**.
  - `not-duplicate`: marker written; `find-duplicates` then **excludes** that pair.
  - `find-duplicates`: planted dup golden pair is returned; non-dup pair is not.
  - dispatcher: unknown operation → error; missing param → error.
- **Determinism:** no `Date.now()`/random in scoring/survivorship; stable sort.

Success = all unit tests green locally **and** (after user deploys to dev) every F2 curl returns the documented shape.

---

## 5. Deliverables

1. `bots/golden-record-mdm/` — full bot (source + tests), CJS bundle (vmcontext footer), mirroring the fuzzy-match toolchain.
2. `scripts/deploy-and-test-local.sh` — seeds patients + runs the **all-operation curl battery** locally.
3. `scripts/deploy-bot-dev.sh` — idempotent dev deploy (user runs the dev deploy manually).
4. `LOCAL-TEST.md` — local walkthrough + the full **curl set for all 10 F2 criteria** (the deliverable the user asked for).
5. Reuses the existing `bots/DEPLOYMENT.md` generic guide (this bot follows the same recipe).

**Git:** per standing user rule, **nothing is committed by the assistant** — all changes left in the working tree for the user to commit.

---

## 6. Risks / open items

- **Propose-only is a safety boundary, not a limitation we hide.** Curls for `update-link`/`merge` return `proposed: true` — the doc states clearly these don't execute. Executing them (with approval workflow + reversibility) is a deliberate future phase.
- **Link metadata in a `Basic` companion** (since `Patient.link` lacks score/source) — slightly more writes; alternative was a custom extension on the link. `Basic` chosen for queryability.
- **Survivorship config** — SoR identifier systems default to placeholders for Medi-Cal/SSN/MRN; the real system URIs must be set via `SOR_PRIORITY` secret for production correctness.
- **Performance** — `find-duplicates` is O(n²) over goldens; fine for dev/eval volume, not a bulk engine. `link` does several searches per call (interactive volume OK).
- **DRY** — scoring is copied from F1; if the algorithm changes, update both (noted in §2).
- **Not config-driven matching algorithm** — thresholds/SoR are config; the algorithm is code (the permanent HAPI gap, accepted).
