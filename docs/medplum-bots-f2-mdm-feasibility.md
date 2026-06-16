# F2 — Golden-Record MDM via Medplum Bots: Feasibility vs CalMHSA Requirements

**Question:** HAPI wins F2 (golden-record MDM) out of the box. **Can Medplum reach it with Bots?**
**Method:** mapped against the **actual CalMHSA requirements** — `CalMHSA-FOD: FHIR-Platform-Requirements-Specification.md` **§3.2 (Cross-Agency Patient Matching / MDM)** and **§1.4 (Patient Identity Across Agencies)** — not against HAPI's feature list. Medplum primitives verified present in `medplum/medplum-server:5.1.13`.

> **Headline:** **Yes — and the spec itself prescribes the Bot path for Medplum.** §3.2 states *"Medplum: no built-in engine; requires custom implementation"* and §1.4 says *"Medplum requires custom Bot-based MDM."* A Bot-based F2 is therefore the **intended** route, not a workaround. Bots can satisfy the *functional* acceptance criteria; the residual gaps vs HAPI are narrow and specific (`:mdm` qualifier, config-driven rules, runtime custom SearchParameters). It is a **substantially larger build than F1** (a stateful subsystem, not one read-only bot), and the merge/override path carries clinical-safety weight.

---

## 1. The actual requirements (verbatim acceptance criteria)

From **§3.2** and **§1.4** combined, CalMHSA requires:

| # | Requirement | Source |
|---|---|---|
| R1 | Golden record aggregating best demographics; **source records linked via `Patient.link` (type `seealso`)** | §1.4 |
| R2 | **Survivorship rules:** most recent name; system-of-record priority for SSN/Medi-Cal ID; most complete address; most frequent demographic | §3.2, §1.4 |
| R3 | **MATCH / POSSIBLE_MATCH / NO_MATCH** workflow with a **manual review queue** | §3.2 |
| R4 | **Configurable matching algorithms** (phonetic, fuzzy, nickname) | §3.2 |
| R5 | **BH-specific tuning:** de-emphasized address (unstable housing), placeholder/alias detection, conservative auto-match thresholds, inconsistent Medi-Cal IDs | §3.2, §1.4 |
| R6 | **`:mdm` search qualifier or equivalent** for cross-org clinical queries across linked source records | §3.2, §1.4 |
| R7 | **Matching rules configurable without code changes (JSON/YAML)** | §3.2 |
| R8 | **Auto-match on ingest** (cross-agency, since Patient is per-agency) | §3.2, §1.4 |
| (dep) | **Custom SearchParameters + `$reindex` at runtime** (needed to query matching/extension fields at scale) | §3.1 |

> Note the scope: MDM links patients **across agencies, not across counties** (Patient is per-agency, `managingOrganization` = treating agency; county is via Coverage). §1.4.

---

## 2. Can Bots do it? — per-requirement verdict

Legend: ✅ Yes (functional parity) · ⚠️ Partial / equivalent-not-identical · ❌ Gap.
Medplum primitives used (all verified in v5.1.13): **Bots** (vmcontext), **Subscriptions** (`workers/subscription.ts`), **Bot cron** (`workers/cron.ts`), standard R4 `Patient.link` / `RiskAssessment` / `Task` / `AuditEvent`, and the deployed `Patient/$match` + the [fuzzy-match Bot](../bots/fuzzy-match/) (Levenshtein/Soundex).

| # | Requirement | Bot verdict | How (and the honest catch) |
|---|---|---|---|
| **R1** | Golden record + `Patient.link seealso` | ✅ | A Bot creates a golden Patient (tag `mdm-record-status\|GOLDEN_RECORD`, EID identifier) and writes `Patient.link{ type: 'seealso', other: source }`. **This is exactly the mechanism §1.4 specifies.** |
| **R2** | Survivorship rules | ✅ (code) | Bot recomputes golden fields on each link/update: most-recent name (by `meta.lastUpdated`/period), SoR priority for SSN/Medi-Cal ID (rank by `identifier.system`), most-complete address, modal demographic. Pure logic; testable. |
| **R3** | MATCH/POSSIBLE/NO_MATCH + review queue | ✅ | Reuse the grade from the matcher. POSSIBLE_MATCH → create a `RiskAssessment` (probability/grade) + a `Task` (status `requested`) = the review queue. A reviewer app resolves the Task → Bot finalizes the link. |
| **R4** | Configurable algorithms (phonetic/fuzzy/nickname) | ✅ | Already in the F1 bot: Damerau-Levenshtein (fuzzy) + Soundex (phonetic). Nickname = add a nickname table lookup (small). |
| **R5** | **BH-specific tuning** | ✅ **— Bot ADVANTAGE** | This is bespoke logic HAPI's generic matchers don't fully express either. A Bot encodes it directly: de-weight `address` (the F1 bot already family-dominant, address low), detect placeholders (`Unknown`, `Doe`, `999-99-9999`, repeated chars) and skip/penalize, conservative thresholds via secrets, tolerate inconsistent Medi-Cal IDs. **Medplum+Bot can match BH needs more precisely than HAPI's config.** |
| **R8** | Auto-match on ingest | ✅ | `Subscription` (criteria `Patient`) → Bot on create/update → run matcher → create/attach golden + links + survivorship. Cross-agency by design (search spans the project's agencies). |
| **R6** | `:mdm` search qualifier | ⚠️ **Equivalent, not identical** | Medplum has **no `:mdm` modifier**. Equivalent: a Bot/endpoint that, given a golden (or any source), follows `Patient.link` and returns clinical data across all linked sources (e.g. wraps `$everything` per source). Works, but callers use **your endpoint**, not `Patient?...:mdm`. Permanent shape gap. |
| **R7** | Rules configurable without code (JSON/YAML) | ⚠️ **Partial** | Thresholds + field weights + placeholder lists → a config resource (`Basic`/JSON in `Bot.secrets` or a project setting) the Bot reads at runtime. But the **matching algorithm itself is code** — changing Levenshtein→Jaro means a redeploy. HAPI externalises the whole rule set in `mdm-rules.json`. **Permanent gap.** |
| **(dep)** | Runtime custom SearchParameters + `$reindex` | ❌ **Medplum platform gap** | §3.1 confirms **Medplum does not support custom SearchParameters (Dec 2024)**. A Bot cannot fully substitute: matching/extension fields that need server-side indexed search aren't queryable at scale. Affects how efficiently candidate-gathering and `:mdm`-style queries scale. Not a Bot problem — a platform limitation that bounds the Bot. |

### Merge / steward lifecycle (implied by R3, present in HAPI's op suite)
Achievable as Bots, but **highest effort + highest risk**:
- `$mdm-merge-golden-resources` → a Bot that re-points links, recomputes survivorship, tombstones the loser. **Clinical-safety sensitive** (wrong merge = two real people conflated). Needs human approval + reversibility.
- `$mdm-update-link` (manual override, AUTO→MANUAL lock) → a Bot writes a MANUAL flag; the **ingest Bot must honor it** and never re-override. Careful state logic.
- `$mdm-link-history` (audit) → `AuditEvent`/`Provenance` on every link change. ✅ easy.
- `$mdm-duplicate-golden-resources` → a **cron Bot** (`workers/cron.ts`) scanning goldens for possible dups. ✅ medium.

---

## 3. Scorecard — all 10 F2 rows (1:1 with the comparison matrix)

Every row from the F2 "Golden Records" sheet, each with a **Medplum + Bots** verdict + score + effort, and the CalMHSA spec criterion it satisfies (R1–R8 from §1). Score: 2 = functional parity, 1 = partial / equivalent-not-identical, 0 = not achievable with Bots. (Built-in Medplum is 0 for all 10 — that's the existing matrix.)

| # | F2 row (matrix wording) | HAPI | Medplum built-in | **Medplum + Bots — verdict** | **M+Bot score** | Effort | Spec criterion |
|---|---|---|---|---|---|---|---|
| F2.1 | Golden / master record + `_tag` search (GOLDEN_RECORD) | 2 | 0 | ✅ Bot creates golden Patient tagged `mdm-record-status\|GOLDEN_RECORD` + EID; `_tag` search works natively | **2** | Low | R1 |
| F2.2 | Auto-link source records on patient creation (survivorship) | 2 | 0 | ✅ Subscription→Bot runs matcher, writes `Patient.link seealso` + recomputes survivorship at `linkSource`-equivalent | **2** | Med–High | R8, R2 |
| F2.3 | Inspect links — `$mdm-query-links` | 2 | 0 | ⚠️ Links live in `Patient.link` (+optional grade/score store); query via FHIR search or a read-Bot — **custom endpoint, not the `$mdm-query-links` op** | **1** | Low–Med | R1, R6 |
| F2.4 | Manual link creation — `$mdm-create-link` | 2 | 0 | ⚠️ A Bot endpoint writes a MANUAL link — functional, **custom contract, not the standard op** | **1** | Low–Med | R3 |
| F2.5 | Manual link override / re-grade — `$mdm-update-link` | 2 | 0 | ⚠️ Bot flips a link to MATCH/NO_MATCH + marks MANUAL; **ingest Bot must honor the MANUAL lock** (careful state logic). Functional, custom op | **1** | Med–High | R3 |
| F2.6 | Link history / audit trail — `$mdm-link-history` | 2 | 0 | ✅ Write `AuditEvent`/`Provenance` on every link change; searchable history | **2** | Low | R3 (audit) |
| F2.7 | Duplicate-golden detection — `$mdm-duplicate-golden-resources` | 2 | 0 | ✅ Scheduled **cron Bot** (`workers/cron.ts`) scans goldens, flags possible-dup pairs (reuses fuzzy matcher) | **2** | Med | R3 |
| F2.8 | Resolve duplicate goldens — `$mdm-merge-golden-resources` / `$mdm-not-duplicate` | 2 | 0 | ⚠️ Bot merges goldens (re-point links, survivorship, tombstone loser) / records "distinct" — **highest clinical-safety risk; needs human approval + reversibility**; custom op | **1** | High | R3 |
| F2.9 | Config-driven MDM rules (mdm-rules.json) | 2 | 0 | ⚠️ Thresholds/weights/placeholder-lists → config resource (Bot reads at runtime), but the **matching algorithm stays code** (HAPI externalises the whole rule set) | **1** | Med | R7 |
| F2.10 | Works live on deployed server | 2 | 0 | ✅ Same vmcontext deploy path as F1, **plus** a Subscription + a cron Bot (proven primitives in v5.1.13) | **2** | — | R8 |

**Totals — F2:** HAPI **20/20** · Medplum built-in **0/20** · **Medplum + Bots ≈ 15/20** (5 rows full ✅, 5 rows partial ⚠️, 0 rows impossible).

**Plus a hard dependency the rows assume (§3.1):** runtime **custom SearchParameters + `$reindex`** — **❌ a Medplum platform gap** (confirmed Dec 2024), not fixable by a Bot. It bounds how efficiently candidate-gathering and `:mdm`-style queries scale, but doesn't block the core MDM lifecycle.

**Reading it:** Bots move every F2 row off zero. **5 rows reach full functional parity** (golden+tag, auto-link/survivorship, audit, dup-detection, works-live). **5 rows reach functional-but-not-drop-in** parity — they work, but as **custom Bot endpoints** instead of HAPI's standard `$mdm-*` operations (query-links, create-link, update-link, merge/not-duplicate) and config-driven rules. **0 rows are impossible.** The irreducible HAPI advantages: the **standard `$mdm-*` operation API + `:mdm` qualifier**, **fully config-driven rules**, and (dependency) **runtime custom SearchParameters**.

---

## 4. Two caveats that affect the "HAPI wins F2" conclusion

1. **HAPI MDM is incompatible with Database Partition Mode (v8.0.0+)** — stated **twice** in the spec (§3.2, §1.4). CalMHSA is fundamentally multi-tenant (agency/county boundaries, §1.1). **If CalMHSA runs HAPI in partition mode for tenant isolation, HAPI's MDM module may be unavailable** — which would force a custom/third-party MDM on HAPI too, neutralizing much of its F2 edge. This needs verification against the chosen HAPI tenancy design before treating HAPI's F2 win as decisive.
2. **BH-tuning (R5) favors Bots.** The spec's BH requirements (unstable-housing address de-emphasis, placeholder/alias detection, conservative thresholds, inconsistent Medi-Cal IDs) are bespoke. HAPI offers generic similarity matchers; a Bot encodes the exact BH rules. So even where HAPI "has MDM," meeting R5 well may require custom rule work on **either** platform.

---

## 5. Effort & risk (if you decide to build it)

| Slice | Effort | Risk | Notes |
|---|---|---|---|
| Golden record + `Patient.link seealso` + `_tag`/EID | Low | Low | Foundation; reuses tag/identifier search |
| Auto-link on ingest (Subscription + matcher + survivorship) | **Med–High** | Med | The core; reuses the F1 fuzzy matcher |
| Review queue (RiskAssessment + Task) + reviewer resolution Bot | Med | Low | Standard FHIR workflow |
| BH tuning (placeholder/alias/address-deweight/nickname) | Med | Low | Bot advantage; pure logic + tables |
| Audit (`AuditEvent` per link change) | Low | Low | — |
| Duplicate-golden detection (cron Bot) | Med | Low | `workers/cron.ts` |
| **Merge + manual override (AUTO→MANUAL lock, reversible)** | **High** | **High** | Clinical-safety; needs approval + undo |
| `:mdm`-equivalent cross-source query endpoint | Med | Low | Custom contract, not `:mdm` |

F1 was ~1 read-only bot. **F2 is a subsystem**: ingest-link Bot + Subscription, survivorship engine, link/audit model, review workflow, dedup cron, merge Bot. Recommend a **phased build** (foundation → auto-link → review/audit → dedup → merge last, behind human approval).

---

## 6. Bottom line

- **Can Bots achieve F2? Yes — functionally, and it's the spec-sanctioned path for Medplum.** A Bot-based MDM can meet R1–R5, R8 (golden records, survivorship, review queue, BH tuning, auto-link) and the merge/audit/dedup lifecycle.
- **Permanent gaps vs HAPI:** `:mdm` search qualifier (R6 → custom endpoint), config-driven rules (R7 → thresholds-only), and runtime custom SearchParameters (§3.1 → a Medplum platform limitation a Bot can't fix).
- **But "HAPI wins F2" deserves an asterisk:** HAPI MDM may not run under the partition-mode tenancy CalMHSA needs (§3.2/§1.4), and BH-specific tuning is custom work on either platform.
- **Cost:** materially larger and riskier than F1. Sensible as a **phased proof-of-capability** (foundation + auto-link first; merge/override last, gated by human review).

> **Verification status:** Requirements quoted from `CalMHSA-FOD: FHIR-Platform-Requirements-Specification.md` §3.1/§3.2/§1.4. Medplum primitives (Bots, Subscriptions `workers/subscription.ts`, cron `workers/cron.ts`, `Patient/$match`) verified present in git tag `v5.1.13`. The `Patient.link seealso` golden mechanism and "Medplum requires custom Bot-based MDM" are the spec's own words. No F2 code has been built — this is feasibility analysis only.
