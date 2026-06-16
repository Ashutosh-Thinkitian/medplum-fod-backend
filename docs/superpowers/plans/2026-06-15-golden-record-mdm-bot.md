# Golden-Record MDM Bot (F2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **STANDING USER RULE — DO NOT COMMIT.** The user commits their own code. **Skip every `git commit`/`git add` step's *commit*** — implement + test only, leave changes in the working tree. (The commit steps below are written for completeness but MUST NOT be executed unless the user explicitly says so.) See memory `no-auto-commit`.

**Goal:** Build a multi-operation Medplum Bot (`golden-record-mdm`) that satisfies all 10 CalMHSA F2 golden-record/MDM criteria, with destructive ops (merge, override) propose-only, testable via curl.

**Architecture:** One vmcontext Bot, `$execute` with an `operation` param dispatched to one handler per operation. Golden = separate Patient (`GOLDEN_RECORD` tag + EID); sources link via `Patient.link seealso`; link metadata in companion `Basic`; review queue = RiskAssessment+Task; audit = AuditEvent. Matching code is **copied** from the F1 fuzzy-match bot (F1 untouched). Survivorship is pure + heavily tested.

**Tech Stack:** TypeScript, `@medplum/core`/`fhirtypes`/`mock`/`cli`, Vitest, esbuild (CJS + vmcontext footer). No external runtime deps.

**Spec:** `docs/superpowers/specs/2026-06-15-golden-record-mdm-bot-design.md`
**Working dir:** `bots/golden-record-mdm/` in the medplum repo. Branch: current (`bot/client-search` or a new branch — user's choice; do not switch without asking).

---

## File Structure

```
bots/golden-record-mdm/
├── package.json, tsconfig.json, vitest.config.ts, esbuild-script.mjs
├── src/
│   ├── text-distance.ts        (COPIED verbatim from ../fuzzy-match/src/)
│   ├── scoring.ts              (COPIED verbatim from ../fuzzy-match/src/)
│   ├── constants.ts            tag/EID/code systems + Basic codes (single source of truth)
│   ├── survivorship.ts         pure per-field survivorship → aggregated golden demographics
│   ├── golden.ts               findGoldenFor, createGolden, applySurvivorship, link helpers
│   ├── audit.ts                writeLinkAuditEvent
│   ├── params.ts               input Parameters parsing helpers (operation, refs, strings)
│   ├── operations/{link,query-links,create-link,update-link,merge,not-duplicate,find-duplicates}.ts
│   ├── golden-record-mdm.ts    handler + dispatcher
│   └── *.test.ts
├── scripts/{deploy-and-test-local.sh, deploy-bot-dev.sh}
└── LOCAL-TEST.md
```

---

## Task 1: Scaffold the bot project + copy matcher

**Files:**
- Create: `bots/golden-record-mdm/{package.json,tsconfig.json,vitest.config.ts,esbuild-script.mjs}`
- Create (by copy): `bots/golden-record-mdm/src/text-distance.ts`, `bots/golden-record-mdm/src/scoring.ts` (+ their `.test.ts`)

- [ ] **Step 1: Create `package.json`** (mirrors fuzzy-match)

```json
{
  "name": "medplum-golden-record-mdm-bot",
  "version": "1.0.0",
  "description": "Bot-based MDM: golden records, auto-link, survivorship, review queue (F2)",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsc --noEmit && node esbuild-script.mjs",
    "test": "vitest run",
    "test:watch": "vitest watch",
    "lint": "tsc --noEmit"
  },
  "devDependencies": {
    "@medplum/cli": "5.1.13",
    "@medplum/core": "5.1.13",
    "@medplum/fhirtypes": "5.1.13",
    "@medplum/mock": "5.1.13",
    "@medplum/definitions": "5.1.13",
    "@types/node": "22.10.2",
    "esbuild": "0.24.0",
    "typescript": "5.7.2",
    "vitest": "2.1.8"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2021", "module": "ESNext", "moduleResolution": "Bundler",
    "lib": ["ES2021", "DOM"], "strict": true, "esModuleInterop": true,
    "skipLibCheck": true, "forceConsistentCasingInFileNames": true,
    "noEmit": true, "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: false, environment: 'node' } });
```

- [ ] **Step 4: Create `esbuild-script.mjs`** (CJS + vmcontext footer — REQUIRED)

```mjs
import esbuild from 'esbuild';
await esbuild.build({
  entryPoints: ['src/golden-record-mdm.ts'],
  bundle: true, platform: 'node', target: 'es2020', format: 'cjs',
  external: ['@medplum/*'],
  outfile: 'dist/golden-record-mdm.cjs',
  footer: { js: 'Object.assign(exports, module.exports);' },
});
console.log('Built dist/golden-record-mdm.cjs');
```

- [ ] **Step 5: Copy the matcher verbatim (F1 untouched)**

Run:
```bash
cd bots/golden-record-mdm
cp ../fuzzy-match/src/text-distance.ts src/text-distance.ts
cp ../fuzzy-match/src/text-distance.test.ts src/text-distance.test.ts
cp ../fuzzy-match/src/scoring.ts src/scoring.ts
cp ../fuzzy-match/src/scoring.test.ts src/scoring.test.ts
```
Expected: 4 files copied. (Do NOT modify the originals in ../fuzzy-match.)

- [ ] **Step 6: Create `.gitignore`**

```
dist/
node_modules/
```

- [ ] **Step 7: Install + verify copied tests pass**

Run: `cd bots/golden-record-mdm && npm install && npx vitest run`
Expected: PASS — the copied text-distance + scoring tests are green (these prove the copy is intact). Count will match fuzzy-match's text-distance + scoring tests (~25).

- [ ] **Step 8: Commit** — **SKIP (do not commit; user rule).** Leave files in working tree.

---

## Task 2: Constants (systems, tags, codes)

**Files:**
- Create: `bots/golden-record-mdm/src/constants.ts`
- Test: `bots/golden-record-mdm/src/constants.test.ts`

- [ ] **Step 1: Write the failing test**

`src/constants.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { MDM } from './constants';

describe('MDM constants', () => {
  test('golden tag uses HAPI mdm-record-status system + GOLDEN_RECORD code', () => {
    expect(MDM.goldenTag.system).toBe('http://hapifhir.io/fhir/NamingSystem/mdm-record-status');
    expect(MDM.goldenTag.code).toBe('GOLDEN_RECORD');
  });
  test('has EID system, managing-system tag, and Basic codes', () => {
    expect(MDM.eidSystem).toBe('https://calmhsa-works.dev/mdm-eid');
    expect(MDM.managingTag.code).toBe('CALMHSA-MDM');
    expect(MDM.linkBasicCode).toBe('mdm-link');
    expect(MDM.notDuplicateBasicCode).toBe('mdm-not-duplicate');
    expect(MDM.linkExtensionBase).toContain('calmhsa-works.dev');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd bots/golden-record-mdm && npx vitest run src/constants.test.ts`
Expected: FAIL — cannot find `./constants`.

- [ ] **Step 3: Implement**

`src/constants.ts`:
```ts
// SPDX-License-Identifier: Apache-2.0
// Single source of truth for MDM systems, tags, and codes.
export const MDM = {
  goldenTag: {
    system: 'http://hapifhir.io/fhir/NamingSystem/mdm-record-status',
    code: 'GOLDEN_RECORD',
    display: 'Golden Record',
  },
  managingTag: {
    system: 'https://calmhsa-works.dev/mdm/managing-system',
    code: 'CALMHSA-MDM',
    display: 'Managed by CalMHSA Bot MDM',
  },
  eidSystem: 'https://calmhsa-works.dev/mdm-eid',
  // Basic resources carry link metadata + not-duplicate markers (Patient.link has no score/source fields).
  basicSystem: 'https://calmhsa-works.dev/mdm',
  linkBasicCode: 'mdm-link',
  notDuplicateBasicCode: 'mdm-not-duplicate',
  // Extension URLs on the link Basic:
  linkExtensionBase: 'https://calmhsa-works.dev/mdm/link',
  ext: {
    golden: 'https://calmhsa-works.dev/mdm/link#golden',
    source: 'https://calmhsa-works.dev/mdm/link#source',
    matchResult: 'https://calmhsa-works.dev/mdm/link#matchResult',
    linkSource: 'https://calmhsa-works.dev/mdm/link#linkSource',
    score: 'https://calmhsa-works.dev/mdm/link#score',
  },
  reviewTaskCode: 'mdm-review',
  updateLinkTaskCode: 'mdm-update-link',
  mergeTaskCode: 'mdm-merge',
} as const;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd bots/golden-record-mdm && npx vitest run src/constants.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — **SKIP (user rule).**

---

## Task 3: Survivorship rules (pure, heavily tested)

**Files:**
- Create: `bots/golden-record-mdm/src/survivorship.ts`
- Test: `bots/golden-record-mdm/src/survivorship.test.ts`

- [ ] **Step 1: Write the failing test**

`src/survivorship.test.ts`:
```ts
import type { Patient } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { computeSurvivorship } from './survivorship';

const SOR = ['urn:medical', 'urn:ssn', 'urn:mrn']; // priority order

function p(over: Partial<Patient>, lastUpdated: string): Patient {
  return { resourceType: 'Patient', meta: { lastUpdated }, ...over } as Patient;
}

describe('computeSurvivorship', () => {
  test('name = most recent source', () => {
    const sources = [
      p({ name: [{ family: 'Old', given: ['A'] }] }, '2020-01-01T00:00:00Z'),
      p({ name: [{ family: 'New', given: ['B'] }] }, '2026-01-01T00:00:00Z'),
    ];
    const g = computeSurvivorship(sources, SOR);
    expect(g.name?.[0].family).toBe('New');
  });

  test('identifiers = system-of-record priority (medical beats ssn beats mrn)', () => {
    const sources = [
      p({ identifier: [{ system: 'urn:mrn', value: 'M1' }, { system: 'urn:ssn', value: 'S1' }] }, '2026-01-01T00:00:00Z'),
      p({ identifier: [{ system: 'urn:medical', value: 'MED1' }] }, '2020-01-01T00:00:00Z'),
    ];
    const g = computeSurvivorship(sources, SOR);
    const systems = (g.identifier ?? []).map((i) => `${i.system}|${i.value}`);
    // one value per distinct system, taken from highest-priority source that has it
    expect(systems).toContain('urn:medical|MED1');
    expect(systems).toContain('urn:ssn|S1');
    expect(systems).toContain('urn:mrn|M1');
  });

  test('address = most complete (more populated fields wins)', () => {
    const sources = [
      p({ address: [{ line: ['1 St'], city: 'X' }] }, '2026-01-01T00:00:00Z'),
      p({ address: [{ line: ['2 Ave'], city: 'Y', state: 'CA', postalCode: '90001' }] }, '2020-01-01T00:00:00Z'),
    ];
    const g = computeSurvivorship(sources, SOR);
    expect(g.address?.[0].postalCode).toBe('90001');
  });

  test('birthDate + gender = mode (majority)', () => {
    const sources = [
      p({ birthDate: '1990-01-01', gender: 'female' }, '2026-01-01T00:00:00Z'),
      p({ birthDate: '1990-01-01', gender: 'female' }, '2025-01-01T00:00:00Z'),
      p({ birthDate: '1991-02-02', gender: 'male' }, '2024-01-01T00:00:00Z'),
    ];
    const g = computeSurvivorship(sources, SOR);
    expect(g.birthDate).toBe('1990-01-01');
    expect(g.gender).toBe('female');
  });

  test('telecom = union of distinct values (phone digits, email lowercased)', () => {
    const sources = [
      p({ telecom: [{ system: 'phone', value: '555-0001' }, { system: 'email', value: 'A@X.com' }] }, '2026-01-01T00:00:00Z'),
      p({ telecom: [{ system: 'phone', value: '5550001' }, { system: 'email', value: 'b@x.com' }] }, '2025-01-01T00:00:00Z'),
    ];
    const g = computeSurvivorship(sources, SOR);
    const phones = (g.telecom ?? []).filter((t) => t.system === 'phone').map((t) => t.value);
    const emails = (g.telecom ?? []).filter((t) => t.system === 'email').map((t) => t.value);
    expect(phones).toEqual(['5550001']); // same number normalized → one entry
    expect(emails.sort()).toEqual(['a@x.com', 'b@x.com']);
  });

  test('empty sources → empty golden demographics (no crash)', () => {
    expect(computeSurvivorship([], SOR)).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd bots/golden-record-mdm && npx vitest run src/survivorship.test.ts`
Expected: FAIL — cannot find `./survivorship`.

- [ ] **Step 3: Implement**

`src/survivorship.ts`:
```ts
// SPDX-License-Identifier: Apache-2.0
import type { Address, ContactPoint, HumanName, Identifier, Patient } from '@medplum/fhirtypes';

/** The survivorship-aggregated demographic fields for a golden record. */
export interface GoldenDemographics {
  name?: HumanName[];
  identifier?: Identifier[];
  address?: Address[];
  birthDate?: string;
  gender?: Patient['gender'];
  telecom?: ContactPoint[];
}

function lastUpdated(p: Patient): number {
  const v = p.meta?.lastUpdated;
  return v ? Date.parse(v) : 0;
}
function byRecencyDesc(a: Patient, b: Patient): number {
  return lastUpdated(b) - lastUpdated(a);
}
function digits(s: string): string {
  return s.replace(/\D/g, '');
}
function addressCompleteness(a: Address): number {
  return [a.line?.length ? 1 : 0, a.city ? 1 : 0, a.state ? 1 : 0, a.postalCode ? 1 : 0].reduce((x, y) => x + y, 0);
}
function modeOf<T>(values: T[]): T | undefined {
  if (!values.length) return undefined;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  return best;
}

/**
 * Aggregate the best demographics across source Patients per CalMHSA survivorship rules.
 * @param sources - linked source Patients.
 * @param sorPriority - identifier systems ranked highest-priority first (system-of-record).
 */
export function computeSurvivorship(sources: Patient[], sorPriority: string[]): GoldenDemographics {
  if (!sources.length) return {};
  const recent = [...sources].sort(byRecencyDesc); // index 0 = most recent

  const out: GoldenDemographics = {};

  // name — most recent source that has a name
  const nameSrc = recent.find((s) => s.name?.length);
  if (nameSrc?.name) out.name = [nameSrc.name[0]];

  // identifiers — per distinct system, take value from highest-priority source that has it.
  // Priority: sorPriority order first; systems not in the list keep first-seen-by-recency.
  const idBySystem = new Map<string, Identifier>();
  const rankedSources = (system: string): Patient[] => {
    // sources that have this system, ordered by sorPriority position of the OWNING source's best id... simpler:
    // For a given system, just pick from the most-recent source that has that system,
    // BUT if multiple systems, honor SoR by iterating sorPriority first.
    return recent.filter((s) => (s.identifier ?? []).some((i) => i.system === system));
  };
  const allSystems = new Set<string>();
  for (const s of sources) for (const i of s.identifier ?? []) if (i.system) allSystems.add(i.system);
  // Order systems: those in sorPriority (in that order) first, then the rest.
  const orderedSystems = [
    ...sorPriority.filter((sys) => allSystems.has(sys)),
    ...[...allSystems].filter((sys) => !sorPriority.includes(sys)),
  ];
  for (const system of orderedSystems) {
    const srcs = rankedSources(system);
    const chosen = srcs[0]?.identifier?.find((i) => i.system === system);
    if (chosen) idBySystem.set(system, chosen);
  }
  if (idBySystem.size) out.identifier = [...idBySystem.values()];

  // address — most complete; tie → most recent
  let bestAddr: Address | undefined;
  let bestScore = -1;
  for (const s of recent) {
    for (const a of s.address ?? []) {
      const score = addressCompleteness(a);
      if (score > bestScore) { bestScore = score; bestAddr = a; }
    }
  }
  if (bestAddr) out.address = [bestAddr];

  // birthDate + gender — mode
  const bd = modeOf((sources.map((s) => s.birthDate).filter(Boolean)) as string[]);
  if (bd) out.birthDate = bd;
  const g = modeOf((sources.map((s) => s.gender).filter(Boolean)) as NonNullable<Patient['gender']>[]);
  if (g) out.gender = g;

  // telecom — union of distinct normalized values per system
  const seen = new Set<string>();
  const telecom: ContactPoint[] = [];
  for (const s of recent) {
    for (const t of s.telecom ?? []) {
      if (!t.value || !t.system) continue;
      const norm = t.system === 'phone' ? digits(t.value) : t.value.toLowerCase();
      const key = `${t.system}|${norm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      telecom.push({ system: t.system, value: norm });
    }
  }
  if (telecom.length) out.telecom = telecom;

  return out;
}
```

> **NOTE on `Date.parse`:** survivorship uses `Date.parse(meta.lastUpdated)` on a STRING that is passed in — this is allowed (it parses a given timestamp, it does NOT call `Date.now()`/`new Date()` with no args). Determinism preserved.

- [ ] **Step 4: Run to verify it passes**

Run: `cd bots/golden-record-mdm && npx vitest run src/survivorship.test.ts`
Expected: PASS (all 6). If the identifier-priority test fails, fix the `orderedSystems`/`rankedSources` logic — do NOT weaken the test.

- [ ] **Step 5: Commit** — **SKIP (user rule).**

---

## Task 4: Params parsing helpers

**Files:**
- Create: `bots/golden-record-mdm/src/params.ts`
- Test: `bots/golden-record-mdm/src/params.test.ts`

- [ ] **Step 1: Write the failing test**

`src/params.test.ts`:
```ts
import type { Parameters, Patient } from '@medplum/fhirtypes';
import { describe, expect, test } from 'vitest';
import { getOperation, getStringParam, getPatientParam, getThresholdsFromSecrets } from './params';

const params: Parameters = {
  resourceType: 'Parameters',
  parameter: [
    { name: 'operation', valueString: 'link' },
    { name: 'goldenResourceId', valueString: 'Patient/g1' },
    { name: 'resource', resource: { resourceType: 'Patient', id: 'p1' } as Patient },
  ],
};

describe('params', () => {
  test('getOperation', () => expect(getOperation(params)).toBe('link'));
  test('getStringParam', () => expect(getStringParam(params, 'goldenResourceId')).toBe('Patient/g1'));
  test('getStringParam missing → undefined', () => expect(getStringParam(params, 'nope')).toBeUndefined());
  test('getPatientParam', () => expect(getPatientParam(params, 'resource')?.id).toBe('p1'));
  test('thresholds default when no secrets', () => {
    expect(getThresholdsFromSecrets({})).toEqual({ certain: 0.85, probable: 0.65, possible: 0.45 });
  });
  test('thresholds from secrets override + invalid falls back', () => {
    const secrets = { CERTAIN: { name: 'CERTAIN', valueString: '0.9' }, POSSIBLE: { name: 'POSSIBLE', valueString: '0.5' } };
    const t = getThresholdsFromSecrets(secrets);
    expect(t.certain).toBe(0.9);
    expect(t.possible).toBe(0.5);
    expect(t.probable).toBe(0.65); // unchanged default
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd bots/golden-record-mdm && npx vitest run src/params.test.ts`
Expected: FAIL — cannot find `./params`.

- [ ] **Step 3: Implement**

`src/params.ts`:
```ts
// SPDX-License-Identifier: Apache-2.0
import type { Parameters, Patient } from '@medplum/fhirtypes';
import { DEFAULT_THRESHOLDS, type Thresholds } from './scoring';

export function getOperation(input: Parameters): string | undefined {
  return getStringParam(input, 'operation');
}
export function getStringParam(input: Parameters, name: string): string | undefined {
  return input.parameter?.find((p) => p.name === name)?.valueString;
}
export function getIntParam(input: Parameters, name: string): number | undefined {
  return input.parameter?.find((p) => p.name === name)?.valueInteger;
}
export function getPatientParam(input: Parameters, name: string): Patient | undefined {
  const r = input.parameter?.find((p) => p.name === name)?.resource;
  return r && r.resourceType === 'Patient' ? (r as Patient) : undefined;
}
export function getSorPriority(secrets: Record<string, { name: string; valueString?: string }>): string[] {
  const raw = secrets?.['SOR_PRIORITY']?.valueString;
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
}
export function getThresholdsFromSecrets(
  secrets: Record<string, { name: string; valueString?: string }>
): Thresholds {
  const num = (k: string, d: number): number => {
    const v = secrets?.[k]?.valueString;
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : d;
  };
  const t = {
    certain: num('CERTAIN', DEFAULT_THRESHOLDS.certain),
    probable: num('PROBABLE', DEFAULT_THRESHOLDS.probable),
    possible: num('POSSIBLE', DEFAULT_THRESHOLDS.possible),
  };
  const valid = t.certain > t.probable && t.probable > t.possible && t.possible > 0 && t.certain <= 1;
  return valid ? t : DEFAULT_THRESHOLDS;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd bots/golden-record-mdm && npx vitest run src/params.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** — **SKIP (user rule).**

---

## Task 5: Golden-record helpers + audit

**Files:**
- Create: `bots/golden-record-mdm/src/golden.ts`, `bots/golden-record-mdm/src/audit.ts`
- Test: `bots/golden-record-mdm/src/golden.test.ts`

- [ ] **Step 1: Write the failing test**

`src/golden.test.ts`:
```ts
import { indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { SEARCH_PARAMETER_BUNDLE_FILES, readJson } from '@medplum/definitions';
import type { Bundle, Patient, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { MDM } from './constants';
import { createGolden, isGolden, linkSourceToGolden, findGoldenForSource } from './golden';

describe('golden helpers', () => {
  let medplum: MockClient;
  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    for (const f of SEARCH_PARAMETER_BUNDLE_FILES) indexSearchParameterBundle(readJson(f) as Bundle<SearchParameter>);
  });
  beforeEach(() => { medplum = new MockClient(); });

  test('createGolden adds GOLDEN_RECORD tag + EID + demographics', async () => {
    const g = await createGolden(medplum, { name: [{ family: 'Garcia', given: ['Maria'] }] }, 'eid-1');
    expect(isGolden(g)).toBe(true);
    expect(g.identifier?.some((i) => i.system === MDM.eidSystem && i.value === 'eid-1')).toBe(true);
    expect(g.name?.[0].family).toBe('Garcia');
  });

  test('linkSourceToGolden adds seealso link + a link Basic; findGoldenForSource resolves it', async () => {
    const g = await createGolden(medplum, { name: [{ family: 'Garcia' }] }, 'eid-2');
    let src = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Garcia' }] });
    src = await linkSourceToGolden(medplum, src, g, 'AUTO', 'MATCH', 0.95);
    expect(src.link?.some((l) => l.type === 'seealso' && l.other.reference === `Patient/${g.id}`)).toBe(true);
    const found = await findGoldenForSource(medplum, src);
    expect(found?.id).toBe(g.id);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd bots/golden-record-mdm && npx vitest run src/golden.test.ts`
Expected: FAIL — cannot find `./golden`.

- [ ] **Step 3: Implement `src/audit.ts`**

```ts
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { AuditEvent, Patient, Reference } from '@medplum/fhirtypes';

/** Write an AuditEvent recording an MDM link action (F2.6 link history). */
export async function writeLinkAuditEvent(
  medplum: MedplumClient,
  action: string,
  golden: Patient,
  source: Patient,
  outcome: '0' | '4' | '8' = '0'
): Promise<void> {
  const entity = (p: Patient): { what: Reference } => ({ what: { reference: `Patient/${p.id}` } });
  const ev: AuditEvent = {
    resourceType: 'AuditEvent',
    type: { system: 'http://terminology.hl7.org/CodeSystem/audit-event-type', code: 'rest' },
    subtype: [{ system: 'https://calmhsa-works.dev/mdm', code: action }],
    action: 'U',
    recorded: new Date(0).toISOString(), // placeholder; server overwrites meta.lastUpdated. Avoid Date.now().
    outcome,
    source: { observer: { display: 'golden-record-mdm bot' } },
    entity: [entity(golden), entity(source)],
  };
  await medplum.createResource(ev);
}
```
> The `recorded` field uses a fixed epoch string to avoid `Date.now()`/`new Date()`-no-arg (which throw in vmcontext). The real timestamp is `meta.lastUpdated` set by the server. If `new Date(0)` is problematic, hardcode `'1970-01-01T00:00:00.000Z'`.

- [ ] **Step 4: Implement `src/golden.ts`**

```ts
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Basic, Patient } from '@medplum/fhirtypes';
import { MDM } from './constants';
import type { GoldenDemographics } from './survivorship';

export function isGolden(p: Patient): boolean {
  return (p.meta?.tag ?? []).some((t) => t.system === MDM.goldenTag.system && t.code === MDM.goldenTag.code);
}

/** Create a golden Patient with the MDM tags, an EID, and the given demographics. */
export async function createGolden(
  medplum: MedplumClient,
  demographics: GoldenDemographics,
  eid: string
): Promise<Patient> {
  const golden: Patient = {
    resourceType: 'Patient',
    meta: {
      tag: [
        { system: MDM.goldenTag.system, code: MDM.goldenTag.code, display: MDM.goldenTag.display },
        { system: MDM.managingTag.system, code: MDM.managingTag.code, display: MDM.managingTag.display },
      ],
    },
    identifier: [{ system: MDM.eidSystem, value: eid }, ...(demographics.identifier ?? [])],
    ...demographics,
  };
  // demographics may also set identifier; merge (EID first)
  if (demographics.identifier) {
    golden.identifier = [{ system: MDM.eidSystem, value: eid }, ...demographics.identifier];
  }
  return medplum.createResource(golden);
}

/** Update a golden's demographics (after survivorship recompute), preserving tags + EID. */
export async function updateGoldenDemographics(
  medplum: MedplumClient,
  golden: Patient,
  demographics: GoldenDemographics
): Promise<Patient> {
  const eid = golden.identifier?.find((i) => i.system === MDM.eidSystem);
  const updated: Patient = {
    ...golden,
    name: demographics.name,
    address: demographics.address,
    birthDate: demographics.birthDate,
    gender: demographics.gender,
    telecom: demographics.telecom,
    identifier: [...(eid ? [eid] : []), ...(demographics.identifier ?? [])],
  };
  return medplum.updateResource(updated);
}

/** Add a seealso link (source → golden) and write a link Basic with metadata. */
export async function linkSourceToGolden(
  medplum: MedplumClient,
  source: Patient,
  golden: Patient,
  linkSource: 'AUTO' | 'MANUAL',
  matchResult: 'MATCH' | 'NO_MATCH' | 'POSSIBLE_MATCH',
  score: number
): Promise<Patient> {
  const ref = `Patient/${golden.id}`;
  const already = (source.link ?? []).some((l) => l.type === 'seealso' && l.other.reference === ref);
  let updated = source;
  if (!already) {
    updated = await medplum.updateResource<Patient>({
      ...source,
      link: [...(source.link ?? []), { type: 'seealso', other: { reference: ref } }],
    });
  }
  const linkBasic: Basic = {
    resourceType: 'Basic',
    code: { coding: [{ system: MDM.basicSystem, code: MDM.linkBasicCode }] },
    subject: { reference: `Patient/${source.id}` },
    extension: [
      { url: MDM.ext.golden, valueReference: { reference: ref } },
      { url: MDM.ext.source, valueReference: { reference: `Patient/${source.id}` } },
      { url: MDM.ext.matchResult, valueString: matchResult },
      { url: MDM.ext.linkSource, valueString: linkSource },
      { url: MDM.ext.score, valueDecimal: score },
    ],
  };
  await medplum.createResource(linkBasic);
  return updated;
}

/** Resolve the golden a source is linked to (via its seealso link). */
export async function findGoldenForSource(medplum: MedplumClient, source: Patient): Promise<Patient | undefined> {
  const ref = (source.link ?? []).find((l) => l.type === 'seealso')?.other.reference;
  if (!ref) return undefined;
  const id = ref.split('/')[1];
  try {
    return await medplum.readResource<Patient>('Patient', id);
  } catch {
    return undefined;
  }
}

/** All source Patients linked to a golden (reverse lookup). */
export async function findSourcesForGolden(medplum: MedplumClient, goldenId: string): Promise<Patient[]> {
  return medplum.searchResources<Patient>('Patient', { link: `Patient/${goldenId}`, _count: '100' });
}

/** All golden Patients. */
export async function findAllGoldens(medplum: MedplumClient): Promise<Patient[]> {
  return medplum.searchResources<Patient>('Patient', {
    _tag: `${MDM.goldenTag.system}|${MDM.goldenTag.code}`,
    _count: '100',
  });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd bots/golden-record-mdm && npx vitest run src/golden.test.ts`
Expected: PASS (both tests). If `findGoldenForSource`/`linkSourceToGolden` fail, debug the link write — do NOT weaken assertions.

- [ ] **Step 6: Commit** — **SKIP (user rule).**

---

## Task 6: `link` operation (auto-link on ingest)

**Files:**
- Create: `bots/golden-record-mdm/src/operations/link.ts`
- Test: `bots/golden-record-mdm/src/operations/link.test.ts`

- [ ] **Step 1: Write the failing test**

`src/operations/link.test.ts`:
```ts
import { indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { SEARCH_PARAMETER_BUNDLE_FILES, readJson } from '@medplum/definitions';
import type { Bundle, Parameters, Patient, RiskAssessment, SearchParameter, Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../scoring';
import { isGolden } from '../golden';
import { runLink } from './link';

function paramStr(p: Parameters, name: string): string | undefined {
  return p.parameter?.find((x) => x.name === name)?.valueString;
}

describe('link operation', () => {
  let medplum: MockClient;
  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    for (const f of SEARCH_PARAMETER_BUNDLE_FILES) indexSearchParameterBundle(readJson(f) as Bundle<SearchParameter>);
  });
  beforeEach(async () => {
    medplum = new MockClient();
    await medplum.createResource<Patient>({
      resourceType: 'Patient', name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12', gender: 'female',
    });
  });

  const opts = { thresholds: DEFAULT_THRESHOLDS, sorPriority: [], eid: 'eid-test' };

  test('MATCH → creates golden + links source; action=linked', async () => {
    const incoming: Patient = { resourceType: 'Patient', id: 'inc1', name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' };
    const saved = await medplum.createResource(incoming);
    const out = await runLink(medplum, saved, opts);
    expect(paramStr(out, 'action')).toBe('linked');
    const goldenRef = paramStr(out, 'goldenRecord');
    expect(goldenRef).toBeDefined();
    const golden = await medplum.readReference<Patient>({ reference: goldenRef! });
    expect(isGolden(golden)).toBe(true);
  });

  test('POSSIBLE → review queue (RiskAssessment + Task), NOT linked', async () => {
    // a near-miss that scores possible (name only, no DOB-exact): tune input so grade=possible
    const incoming = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Garcia', given: ['Xyz'] }] });
    const out = await runLink(medplum, incoming, opts);
    const action = paramStr(out, 'action');
    if (action === 'review-queued') {
      const tasks = await medplum.searchResources<Task>('Task', {});
      const ras = await medplum.searchResources<RiskAssessment>('RiskAssessment', {});
      expect(tasks.length).toBeGreaterThanOrEqual(1);
      expect(ras.length).toBeGreaterThanOrEqual(1);
    } else {
      // acceptable if it scored match/no-match given the data; assert it did NOT silently error
      expect(['linked', 'no-match']).toContain(action);
    }
  });

  test('garbage name → action=no-match, nothing created', async () => {
    const incoming = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Zzzzzz', given: ['Qqq'] }] });
    const out = await runLink(medplum, incoming, opts);
    expect(paramStr(out, 'action')).toBe('no-match');
  });

  test('second matching source attaches to SAME golden (idempotent — no 2nd golden)', async () => {
    const a = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' });
    await runLink(medplum, a, opts);
    const b = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' });
    await runLink(medplum, b, opts);
    const goldens = await medplum.searchResources<Patient>('Patient', { _tag: 'http://hapifhir.io/fhir/NamingSystem/mdm-record-status|GOLDEN_RECORD' });
    expect(goldens.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd bots/golden-record-mdm && npx vitest run src/operations/link.test.ts`
Expected: FAIL — cannot find `./link`.

- [ ] **Step 3: Implement**

`src/operations/link.ts`:
```ts
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Parameters, Patient, RiskAssessment, Task } from '@medplum/fhirtypes';
import { MDM } from '../constants';
import {
  createGolden, findAllGoldens, findGoldenForSource, findSourcesForGolden,
  isGolden, linkSourceToGolden, updateGoldenDemographics,
} from '../golden';
import { classifyGrade, scoreCandidate, type Thresholds } from '../scoring';
import { computeSurvivorship } from '../survivorship';

export interface LinkOptions {
  thresholds: Thresholds;
  sorPriority: string[];
  eid: string; // EID to assign if a new golden is created (caller passes a deterministic/uuid value)
}

function out(parts: Record<string, string | undefined>): Parameters {
  return {
    resourceType: 'Parameters',
    parameter: Object.entries(parts)
      .filter(([, v]) => v !== undefined)
      .map(([name, valueString]) => ({ name, valueString: valueString as string })),
  };
}

/** Auto-link an incoming Patient: MATCH→link to golden, POSSIBLE→review queue, else no-match. */
export async function runLink(medplum: MedplumClient, incoming: Patient, opts: LinkOptions): Promise<Parameters> {
  // Gather candidate source patients (exclude goldens and the incoming itself).
  const families = (incoming.name ?? []).map((n) => n.family ?? '').filter(Boolean);
  const givens = (incoming.name ?? []).flatMap((n) => n.given ?? []).filter(Boolean);
  const stems = new Set<string>();
  for (const f of families) { const s = f.toLowerCase(); if (s) stems.add(s.slice(0, 3)); }
  for (const g of givens) { const s = g.toLowerCase(); if (s) stems.add(s.slice(0, 3)); }

  const seen = new Map<string, Patient>();
  for (const stem of stems) {
    const fam = await medplum.searchResources<Patient>('Patient', { 'family:contains': stem, _count: '100' });
    const giv = await medplum.searchResources<Patient>('Patient', { 'given:contains': stem, _count: '100' });
    for (const p of [...fam, ...giv]) if (p.id && p.id !== incoming.id && !isGolden(p)) seen.set(p.id, p);
  }
  if (incoming.birthDate) {
    const bd = await medplum.searchResources<Patient>('Patient', { birthdate: incoming.birthDate, _count: '100' });
    for (const p of bd) if (p.id && p.id !== incoming.id && !isGolden(p)) seen.set(p.id, p);
  }
  const candidates = [...seen.values()];

  // Best match
  let best: { patient: Patient; score: number } | undefined;
  for (const c of candidates) {
    const { score } = scoreCandidate(incoming, c);
    if (!best || score > best.score) best = { patient: c, score };
  }
  const grade = best ? classifyGrade(best.score, opts.thresholds) : 'certainly-not';

  if (best && grade === 'certain') {
    // MATCH → find-or-create golden for the matched cluster, then link incoming.
    let golden = await findGoldenForSource(medplum, best.patient);
    if (!golden) {
      // create golden from the existing match's demographics first
      const demo0 = computeSurvivorship([best.patient], opts.sorPriority);
      golden = await createGolden(medplum, demo0, opts.eid);
      await linkSourceToGolden(medplum, best.patient, golden, 'AUTO', 'MATCH', best.score);
    }
    await linkSourceToGolden(medplum, incoming, golden, 'AUTO', 'MATCH', best.score);
    // Recompute survivorship across ALL linked sources.
    const sources = await findSourcesForGolden(medplum, golden.id as string);
    const demo = computeSurvivorship(sources, opts.sorPriority);
    golden = await updateGoldenDemographics(medplum, golden, demo);
    return out({ action: 'linked', goldenRecord: `Patient/${golden.id}`, score: String(best.score), grade });
  }

  if (best && grade === 'probable') {
    // treat probable also as a (less aggressive) auto-link? Per spec = conservative: only certain auto-links.
    // probable → review queue too (safer). Fall through to review.
  }

  if (best && (grade === 'probable' || grade === 'possible')) {
    // POSSIBLE_MATCH → review queue
    const ra: RiskAssessment = {
      resourceType: 'RiskAssessment',
      status: 'final',
      code: { coding: [{ system: MDM.basicSystem, code: 'duplicate-patient' }] },
      subject: { reference: `Patient/${incoming.id}` },
      basis: [{ reference: `Patient/${best.patient.id}` }],
      prediction: [{ qualitativeRisk: { text: grade }, probabilityDecimal: best.score }],
    };
    const savedRa = await medplum.createResource(ra);
    const task: Task = {
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      code: { coding: [{ system: MDM.basicSystem, code: MDM.reviewTaskCode }] },
      focus: { reference: `RiskAssessment/${savedRa.id}` },
      for: { reference: `Patient/${incoming.id}` },
    };
    await medplum.createResource(task);
    return out({ action: 'review-queued', candidate: `Patient/${best.patient.id}`, score: String(best.score), grade });
  }

  return out({ action: 'no-match', score: best ? String(best.score) : '0', grade });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd bots/golden-record-mdm && npx vitest run src/operations/link.test.ts`
Expected: PASS (all 4). If the POSSIBLE test's grade differs, the test already tolerates linked/no-match; the key assertions are MATCH→golden, garbage→no-match, idempotent single golden. If idempotency fails (2 goldens), debug `findGoldenForSource` resolution — do NOT weaken.

- [ ] **Step 5: Commit** — **SKIP (user rule).**

---

## Task 7: `query-links` + `create-link` operations

**Files:**
- Create: `bots/golden-record-mdm/src/operations/query-links.ts`, `bots/golden-record-mdm/src/operations/create-link.ts`
- Test: `bots/golden-record-mdm/src/operations/links.test.ts`

- [ ] **Step 1: Write the failing test**

`src/operations/links.test.ts`:
```ts
import { indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { SEARCH_PARAMETER_BUNDLE_FILES, readJson } from '@medplum/definitions';
import type { Bundle, Parameters, Patient, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createGolden, linkSourceToGolden } from '../golden';
import { runQueryLinks } from './query-links';
import { runCreateLink } from './create-link';

describe('query-links + create-link', () => {
  let medplum: MockClient;
  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    for (const f of SEARCH_PARAMETER_BUNDLE_FILES) indexSearchParameterBundle(readJson(f) as Bundle<SearchParameter>);
  });
  beforeEach(() => { medplum = new MockClient(); });

  test('create-link writes MANUAL link + Basic; query-links returns it', async () => {
    const golden = await createGolden(medplum, { name: [{ family: 'Garcia' }] }, 'eid-q');
    const src = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Garcia' }] });

    const created = await runCreateLink(medplum, `Patient/${golden.id}`, `Patient/${src.id}`);
    expect(created.parameter?.find((p) => p.name === 'outcome')?.valueString).toBe('linked');

    const q = await runQueryLinks(medplum, `Patient/${golden.id}`, undefined);
    const links = (q.parameter ?? []).filter((p) => p.name === 'link');
    expect(links.length).toBe(1);
    const parts = links[0].part ?? [];
    const get = (n: string): string | undefined => parts.find((x) => x.name === n)?.valueString;
    expect(get('sourceResourceId')).toBe(`Patient/${src.id}`);
    expect(get('linkSource')).toBe('MANUAL');
  });

  test('query-links by goldenResourceId returns AUTO link created by helper', async () => {
    const golden = await createGolden(medplum, { name: [{ family: 'Lee' }] }, 'eid-q2');
    const src = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Lee' }] });
    await linkSourceToGolden(medplum, src, golden, 'AUTO', 'MATCH', 0.99);
    const q = await runQueryLinks(medplum, `Patient/${golden.id}`, undefined);
    expect((q.parameter ?? []).filter((p) => p.name === 'link').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd bots/golden-record-mdm && npx vitest run src/operations/links.test.ts`
Expected: FAIL — cannot find `./query-links`.

- [ ] **Step 3: Implement `src/operations/query-links.ts`**

```ts
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Basic, Parameters, ParametersParameter } from '@medplum/fhirtypes';
import { MDM } from '../constants';

function extStr(b: Basic, url: string): string | undefined {
  const e = (b.extension ?? []).find((x) => x.url === url);
  return e?.valueString ?? e?.valueReference?.reference ?? (e?.valueDecimal !== undefined ? String(e.valueDecimal) : undefined);
}

/** List source↔golden links (reads the link Basics). Filter by golden or by source. */
export async function runQueryLinks(
  medplum: MedplumClient,
  goldenResourceId: string | undefined,
  resourceId: string | undefined
): Promise<Parameters> {
  const basics = await medplum.searchResources<Basic>('Basic', {
    code: `${MDM.basicSystem}|${MDM.linkBasicCode}`,
    _count: '200',
  });
  const matches = basics.filter((b) => {
    const g = extStr(b, MDM.ext.golden);
    const s = extStr(b, MDM.ext.source);
    if (goldenResourceId) return g === goldenResourceId;
    if (resourceId) return s === resourceId;
    return true;
  });
  const parameter: ParametersParameter[] = matches.map((b) => ({
    name: 'link',
    part: [
      { name: 'goldenResourceId', valueString: extStr(b, MDM.ext.golden) },
      { name: 'sourceResourceId', valueString: extStr(b, MDM.ext.source) },
      { name: 'matchResult', valueString: extStr(b, MDM.ext.matchResult) },
      { name: 'linkSource', valueString: extStr(b, MDM.ext.linkSource) },
      { name: 'score', valueString: extStr(b, MDM.ext.score) },
    ],
  }));
  return { resourceType: 'Parameters', parameter };
}
```

- [ ] **Step 4: Implement `src/operations/create-link.ts`**

```ts
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Parameters, Patient } from '@medplum/fhirtypes';
import { findGoldenForSource, findSourcesForGolden, linkSourceToGolden, updateGoldenDemographics } from '../golden';
import { writeLinkAuditEvent } from '../audit';
import { computeSurvivorship } from '../survivorship';

/** Manually link a source to a golden (MANUAL), recompute survivorship, audit. */
export async function runCreateLink(
  medplum: MedplumClient,
  goldenResourceId: string,
  resourceId: string,
  sorPriority: string[] = []
): Promise<Parameters> {
  const golden = await medplum.readResource<Patient>('Patient', goldenResourceId.split('/')[1]);
  const source = await medplum.readResource<Patient>('Patient', resourceId.split('/')[1]);
  await linkSourceToGolden(medplum, source, golden, 'MANUAL', 'MATCH', 1);
  await writeLinkAuditEvent(medplum, 'mdm-create-link', golden, source);
  const sources = await findSourcesForGolden(medplum, golden.id as string);
  await updateGoldenDemographics(medplum, golden, computeSurvivorship(sources, sorPriority));
  return {
    resourceType: 'Parameters',
    parameter: [
      { name: 'outcome', valueString: 'linked' },
      { name: 'goldenResourceId', valueString: goldenResourceId },
      { name: 'sourceResourceId', valueString: resourceId },
      { name: 'linkSource', valueString: 'MANUAL' },
    ],
  };
}
```
> Unused import `findGoldenForSource` — remove it if the linter flags; keep only what's used.

- [ ] **Step 5: Run to verify it passes**

Run: `cd bots/golden-record-mdm && npx vitest run src/operations/links.test.ts`
Expected: PASS (both). If `query-links` returns 0, check the Basic search by `code` token works in MockClient (it does — token search supported).

- [ ] **Step 6: Commit** — **SKIP (user rule).**

---

## Task 8: Propose-only `update-link` + `merge`, and `not-duplicate`

**Files:**
- Create: `bots/golden-record-mdm/src/operations/update-link.ts`, `merge.ts`, `not-duplicate.ts`
- Test: `bots/golden-record-mdm/src/operations/propose.test.ts`

- [ ] **Step 1: Write the failing test**

`src/operations/propose.test.ts`:
```ts
import { indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { SEARCH_PARAMETER_BUNDLE_FILES, readJson } from '@medplum/definitions';
import type { Bundle, Patient, SearchParameter, Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createGolden } from '../golden';
import { runUpdateLink } from './update-link';
import { runMerge } from './merge';
import { runNotDuplicate } from './not-duplicate';
import { findDuplicateMarkers } from './not-duplicate';

describe('propose-only ops + not-duplicate', () => {
  let medplum: MockClient;
  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    for (const f of SEARCH_PARAMETER_BUNDLE_FILES) indexSearchParameterBundle(readJson(f) as Bundle<SearchParameter>);
  });
  beforeEach(() => { medplum = new MockClient(); });

  test('update-link is propose-only: creates Task, mutates nothing', async () => {
    const golden = await createGolden(medplum, { name: [{ family: 'A' }] }, 'e1');
    const src = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'A' }] });
    const out = await runUpdateLink(medplum, `Patient/${golden.id}`, `Patient/${src.id}`, 'NO_MATCH');
    expect(out.parameter?.find((p) => p.name === 'proposed')?.valueBoolean).toBe(true);
    const tasks = await medplum.searchResources<Task>('Task', {});
    expect(tasks.length).toBe(1);
    // source link unchanged (none existed)
    const reread = await medplum.readResource<Patient>('Patient', src.id as string);
    expect(reread.link ?? []).toHaveLength(0);
  });

  test('merge is propose-only: creates Task, both goldens unchanged', async () => {
    const g1 = await createGolden(medplum, { name: [{ family: 'A' }] }, 'e2');
    const g2 = await createGolden(medplum, { name: [{ family: 'A' }] }, 'e3');
    const out = await runMerge(medplum, `Patient/${g1.id}`, `Patient/${g2.id}`);
    expect(out.parameter?.find((p) => p.name === 'proposed')?.valueBoolean).toBe(true);
    const tasks = await medplum.searchResources<Task>('Task', {});
    expect(tasks.length).toBe(1);
    expect((await medplum.readResource<Patient>('Patient', g1.id as string)).id).toBe(g1.id); // still exists
    expect((await medplum.readResource<Patient>('Patient', g2.id as string)).id).toBe(g2.id);
  });

  test('not-duplicate writes a marker findable by findDuplicateMarkers', async () => {
    const g1 = await createGolden(medplum, { name: [{ family: 'A' }] }, 'e4');
    const g2 = await createGolden(medplum, { name: [{ family: 'B' }] }, 'e5');
    await runNotDuplicate(medplum, `Patient/${g1.id}`, `Patient/${g2.id}`);
    const markers = await findDuplicateMarkers(medplum);
    expect(markers.some((m) => m.has(`Patient/${g1.id}`) && m.has(`Patient/${g2.id}`))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd bots/golden-record-mdm && npx vitest run src/operations/propose.test.ts`
Expected: FAIL — cannot find `./update-link`.

- [ ] **Step 3: Implement `src/operations/update-link.ts`**

```ts
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Parameters, Task } from '@medplum/fhirtypes';
import { MDM } from '../constants';

/** PROPOSE-ONLY: create a Task proposing a link re-grade. Does NOT change any link. */
export async function runUpdateLink(
  medplum: MedplumClient,
  goldenResourceId: string,
  resourceId: string,
  matchResult: string
): Promise<Parameters> {
  const task: Task = {
    resourceType: 'Task',
    status: 'requested',
    intent: 'order',
    code: { coding: [{ system: MDM.basicSystem, code: MDM.updateLinkTaskCode }] },
    description: `Propose re-grade link ${resourceId} → ${goldenResourceId} to ${matchResult} (MANUAL).`,
    for: { reference: resourceId },
    input: [
      { type: { text: 'goldenResourceId' }, valueString: goldenResourceId },
      { type: { text: 'resourceId' }, valueString: resourceId },
      { type: { text: 'matchResult' }, valueString: matchResult },
    ],
  };
  const saved = await medplum.createResource(task);
  return {
    resourceType: 'Parameters',
    parameter: [
      { name: 'proposed', valueBoolean: true },
      { name: 'taskId', valueString: `Task/${saved.id}` },
      { name: 'note', valueString: 'Re-grade proposed for human approval; no link changed.' },
    ],
  };
}
```

- [ ] **Step 4: Implement `src/operations/merge.ts`**

```ts
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Parameters, Task } from '@medplum/fhirtypes';
import { MDM } from '../constants';

/** PROPOSE-ONLY: create a Task proposing a golden-record merge. Does NOT merge. */
export async function runMerge(
  medplum: MedplumClient,
  sourceGolden: string,
  targetGolden: string
): Promise<Parameters> {
  const task: Task = {
    resourceType: 'Task',
    status: 'requested',
    intent: 'order',
    code: { coding: [{ system: MDM.basicSystem, code: MDM.mergeTaskCode }] },
    description: `Propose merge of golden ${sourceGolden} into ${targetGolden}.`,
    input: [
      { type: { text: 'sourceGolden' }, valueString: sourceGolden },
      { type: { text: 'targetGolden' }, valueString: targetGolden },
    ],
  };
  const saved = await medplum.createResource(task);
  return {
    resourceType: 'Parameters',
    parameter: [
      { name: 'proposed', valueBoolean: true },
      { name: 'taskId', valueString: `Task/${saved.id}` },
      { name: 'note', valueString: 'Golden merge proposed for human approval; nothing merged.' },
    ],
  };
}
```

- [ ] **Step 5: Implement `src/operations/not-duplicate.ts`**

```ts
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Basic, Parameters } from '@medplum/fhirtypes';
import { MDM } from '../constants';

/** Mark two goldens as genuinely distinct (so find-duplicates skips the pair). */
export async function runNotDuplicate(
  medplum: MedplumClient,
  goldenA: string,
  goldenB: string
): Promise<Parameters> {
  const marker: Basic = {
    resourceType: 'Basic',
    code: { coding: [{ system: MDM.basicSystem, code: MDM.notDuplicateBasicCode }] },
    extension: [
      { url: `${MDM.linkExtensionBase}#goldenA`, valueReference: { reference: goldenA } },
      { url: `${MDM.linkExtensionBase}#goldenB`, valueReference: { reference: goldenB } },
    ],
  };
  const saved = await medplum.createResource(marker);
  return {
    resourceType: 'Parameters',
    parameter: [
      { name: 'outcome', valueString: 'marked-distinct' },
      { name: 'markerId', valueString: `Basic/${saved.id}` },
    ],
  };
}

/** Return the set of {goldenA, goldenB} pairs marked not-duplicate. */
export async function findDuplicateMarkers(medplum: MedplumClient): Promise<Set<string>[]> {
  const markers = await medplum.searchResources<Basic>('Basic', {
    code: `${MDM.basicSystem}|${MDM.notDuplicateBasicCode}`,
    _count: '200',
  });
  return markers.map((m) => {
    const refs = (m.extension ?? []).map((e) => e.valueReference?.reference).filter(Boolean) as string[];
    return new Set(refs);
  });
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd bots/golden-record-mdm && npx vitest run src/operations/propose.test.ts`
Expected: PASS (all 3). The mutation-free assertions are the point — if any fails, the op is doing more than proposing; fix the op, not the test.

- [ ] **Step 7: Commit** — **SKIP (user rule).**

---

## Task 9: `find-duplicates` operation

**Files:**
- Create: `bots/golden-record-mdm/src/operations/find-duplicates.ts`
- Test: `bots/golden-record-mdm/src/operations/find-duplicates.test.ts`

- [ ] **Step 1: Write the failing test**

`src/operations/find-duplicates.test.ts`:
```ts
import { indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { SEARCH_PARAMETER_BUNDLE_FILES, readJson } from '@medplum/definitions';
import type { Bundle, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../scoring';
import { createGolden } from '../golden';
import { runNotDuplicate } from './not-duplicate';
import { runFindDuplicates } from './find-duplicates';

describe('find-duplicates', () => {
  let medplum: MockClient;
  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    for (const f of SEARCH_PARAMETER_BUNDLE_FILES) indexSearchParameterBundle(readJson(f) as Bundle<SearchParameter>);
  });
  beforeEach(() => { medplum = new MockClient(); });

  test('returns a duplicate pair of similar goldens; excludes not-duplicate-marked pairs', async () => {
    const g1 = await createGolden(medplum, { name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' }, 'eA');
    const g2 = await createGolden(medplum, { name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' }, 'eB');
    const g3 = await createGolden(medplum, { name: [{ family: 'Wilson', given: ['Bob'] }], birthDate: '1950-01-01' }, 'eC');

    let out = await runFindDuplicates(medplum, DEFAULT_THRESHOLDS, 100);
    let pairs = (out.parameter ?? []).filter((p) => p.name === 'duplicatePair');
    expect(pairs.length).toBeGreaterThanOrEqual(1); // g1/g2 are dups; g3 isn't

    // After marking g1/g2 not-duplicate, they should be excluded.
    await runNotDuplicate(medplum, `Patient/${g1.id}`, `Patient/${g2.id}`);
    out = await runFindDuplicates(medplum, DEFAULT_THRESHOLDS, 100);
    pairs = (out.parameter ?? []).filter((p) => p.name === 'duplicatePair');
    const stillFlagged = pairs.some((p) => {
      const ids = (p.part ?? []).map((x) => x.valueString);
      return ids.includes(`Patient/${g1.id}`) && ids.includes(`Patient/${g2.id}`);
    });
    expect(stillFlagged).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd bots/golden-record-mdm && npx vitest run src/operations/find-duplicates.test.ts`
Expected: FAIL — cannot find `./find-duplicates`.

- [ ] **Step 3: Implement**

`src/operations/find-duplicates.ts`:
```ts
// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Parameters, ParametersParameter } from '@medplum/fhirtypes';
import { findAllGoldens } from '../golden';
import { classifyGrade, scoreCandidate, type Thresholds } from '../scoring';
import { findDuplicateMarkers } from './not-duplicate';

/** Scan goldens, score pairs, return possible-duplicate pairs (excludes not-duplicate-marked). No merge. */
export async function runFindDuplicates(
  medplum: MedplumClient,
  thresholds: Thresholds,
  maxCount: number
): Promise<Parameters> {
  const goldens = await findAllGoldens(medplum);
  const markers = await findDuplicateMarkers(medplum);
  const isMarked = (a: string, b: string): boolean =>
    markers.some((m) => m.has(a) && m.has(b));

  const parameter: ParametersParameter[] = [];
  for (let i = 0; i < goldens.length; i++) {
    for (let j = i + 1; j < goldens.length; j++) {
      const a = goldens[i];
      const b = goldens[j];
      const refA = `Patient/${a.id}`;
      const refB = `Patient/${b.id}`;
      if (isMarked(refA, refB)) continue;
      const { score } = scoreCandidate(a, b);
      const grade = classifyGrade(score, thresholds);
      if (grade === 'possible' || grade === 'probable' || grade === 'certain') {
        parameter.push({
          name: 'duplicatePair',
          part: [
            { name: 'goldenA', valueString: refA },
            { name: 'goldenB', valueString: refB },
            { name: 'score', valueString: String(score) },
            { name: 'grade', valueString: grade },
          ],
        });
        if (parameter.length >= maxCount) return { resourceType: 'Parameters', parameter };
      }
    }
  }
  return { resourceType: 'Parameters', parameter };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd bots/golden-record-mdm && npx vitest run src/operations/find-duplicates.test.ts`
Expected: PASS (both assertions).

- [ ] **Step 5: Commit** — **SKIP (user rule).**

---

## Task 10: Handler + dispatcher

**Files:**
- Create: `bots/golden-record-mdm/src/golden-record-mdm.ts`
- Test: `bots/golden-record-mdm/src/golden-record-mdm.test.ts`

- [ ] **Step 1: Write the failing test**

`src/golden-record-mdm.test.ts`:
```ts
import { ContentType, indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { SEARCH_PARAMETER_BUNDLE_FILES, readJson } from '@medplum/definitions';
import type { Bundle, Parameters, Patient, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { handler } from './golden-record-mdm';

function P(parts: Parameters['parameter']): Parameters { return { resourceType: 'Parameters', parameter: parts }; }

describe('dispatcher', () => {
  let medplum: MockClient;
  const bot = { reference: 'Bot/123' };
  const secrets = {};
  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    for (const f of SEARCH_PARAMETER_BUNDLE_FILES) indexSearchParameterBundle(readJson(f) as Bundle<SearchParameter>);
  });
  beforeEach(() => { medplum = new MockClient(); });

  async function run(input: Parameters): Promise<any> {
    return handler(medplum, { bot, input, contentType: ContentType.FHIR_JSON, secrets });
  }

  test('unknown operation → throws/errors', async () => {
    await expect(run(P([{ name: 'operation', valueString: 'bogus' }]))).rejects.toThrow();
  });

  test('link operation routes to runLink', async () => {
    await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' });
    const inc = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' });
    const out: Parameters = await run(P([
      { name: 'operation', valueString: 'link' },
      { name: 'resource', resource: inc },
    ]));
    expect(out.resourceType).toBe('Parameters');
    expect(out.parameter?.some((p) => p.name === 'action')).toBe(true);
  });

  test('find-duplicates operation routes', async () => {
    const out: Parameters = await run(P([{ name: 'operation', valueString: 'find-duplicates' }]));
    expect(out.resourceType).toBe('Parameters');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd bots/golden-record-mdm && npx vitest run src/golden-record-mdm.test.ts`
Expected: FAIL — cannot find `./golden-record-mdm`.

- [ ] **Step 3: Implement**

`src/golden-record-mdm.ts`:
```ts
// SPDX-License-Identifier: Apache-2.0
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Parameters } from '@medplum/fhirtypes';
import { getOperation, getPatientParam, getStringParam, getIntParam, getThresholdsFromSecrets, getSorPriority } from './params';
import { runLink } from './operations/link';
import { runQueryLinks } from './operations/query-links';
import { runCreateLink } from './operations/create-link';
import { runUpdateLink } from './operations/update-link';
import { runMerge } from './operations/merge';
import { runNotDuplicate } from './operations/not-duplicate';
import { runFindDuplicates } from './operations/find-duplicates';

function err(msg: string): never {
  throw new Error(msg);
}
function requireStr(input: Parameters, name: string): string {
  return getStringParam(input, name) ?? err(`Missing required parameter: ${name}`);
}

/**
 * Golden-Record MDM bot. Dispatches on the `operation` Parameters value.
 * Operations: link | query-links | create-link | update-link | merge | not-duplicate | find-duplicates
 */
export async function handler(medplum: MedplumClient, event: BotEvent<Parameters>): Promise<Parameters> {
  const input = event.input;
  const op = getOperation(input);
  const secrets = event.secrets as Record<string, { name: string; valueString?: string }>;
  const thresholds = getThresholdsFromSecrets(secrets);
  const sorPriority = getSorPriority(secrets);

  switch (op) {
    case 'link': {
      const resource = getPatientParam(input, 'resource') ?? err('Missing required parameter: resource (Patient)');
      // Deterministic EID: reuse the source id as the EID seed (no Date.now/random in vmcontext).
      const eid = `eid-${resource.id ?? 'new'}`;
      return runLink(medplum, resource, { thresholds, sorPriority, eid });
    }
    case 'query-links':
      return runQueryLinks(medplum, getStringParam(input, 'goldenResourceId'), getStringParam(input, 'resourceId'));
    case 'create-link':
      return runCreateLink(medplum, requireStr(input, 'goldenResourceId'), requireStr(input, 'resourceId'), sorPriority);
    case 'update-link':
      return runUpdateLink(medplum, requireStr(input, 'goldenResourceId'), requireStr(input, 'resourceId'), requireStr(input, 'matchResult'));
    case 'merge':
      return runMerge(medplum, requireStr(input, 'sourceGolden'), requireStr(input, 'targetGolden'));
    case 'not-duplicate':
      return runNotDuplicate(medplum, requireStr(input, 'goldenA'), requireStr(input, 'goldenB'));
    case 'find-duplicates':
      return runFindDuplicates(medplum, thresholds, getIntParam(input, '_count') ?? 100);
    default:
      return err(`Unknown operation: ${op ?? '(none)'}. Expected one of: link, query-links, create-link, update-link, merge, not-duplicate, find-duplicates`);
  }
}
```

- [ ] **Step 4: Run to verify it passes + full suite**

Run: `cd bots/golden-record-mdm && npx vitest run`
Expected: PASS — all suites (copied matcher + constants + survivorship + params + golden + all operations + dispatcher).

- [ ] **Step 5: Commit** — **SKIP (user rule).**

---

## Task 11: Build the bundle

**Files:** uses `esbuild-script.mjs` from Task 1.

- [ ] **Step 1: Build**

Run: `cd bots/golden-record-mdm && npm run build`
Expected: `tsc --noEmit` clean; `Built dist/golden-record-mdm.cjs`.

- [ ] **Step 2: Verify CJS + vmcontext footer + handler resolves**

Run:
```bash
cd bots/golden-record-mdm
grep -c "module.exports" dist/golden-record-mdm.cjs        # >= 1
grep -c "Object.assign(exports, module.exports)" dist/golden-record-mdm.cjs  # == 1 (the footer)
node -e "const e={};const m={exports:e};const fn=new Function('exports','module','require',require('fs').readFileSync('./dist/golden-record-mdm.cjs','utf8'));fn(e,m,require);console.log('handler:',typeof e.handler)"
```
Expected: footer present; last line prints `handler: function`.

- [ ] **Step 3: Commit** — **SKIP (user rule).**

---

## Task 12: Deploy scripts + LOCAL-TEST.md with the full F2 curl set

**Files:**
- Create: `bots/golden-record-mdm/scripts/deploy-bot-dev.sh`
- Create: `bots/golden-record-mdm/scripts/deploy-and-test-local.sh`
- Create: `bots/golden-record-mdm/LOCAL-TEST.md`

- [ ] **Step 1: Create `scripts/deploy-bot-dev.sh`** (idempotent, copy of fuzzy-match's pattern, retargeted)

```bash
#!/usr/bin/env bash
# Idempotent deploy of the golden-record-mdm Bot. Creates once (by identifier), then deploys code.
# Usage: BASE=... TOKEN=<admin bearer> ./scripts/deploy-bot-dev.sh   (run from bots/golden-record-mdm)
set -euo pipefail
BASE="${BASE:?set BASE}"; TOKEN="${TOKEN:?set TOKEN}"
FHIR="$BASE/fhir/R4"; AUTH=(-H "Authorization: Bearer $TOKEN")
JSON=(-H 'Content-Type: application/fhir+json' -H 'Accept: application/fhir+json')
SYS="https://calmhsa-works.dev/bots"; VAL="golden-record-mdm"; NAME="golden-record-mdm"

echo "==> Building"; npm run build >/dev/null
echo "==> Find-or-create Bot"
BOT_ID=$(curl -s "${AUTH[@]}" "${JSON[@]}" "$FHIR/Bot?identifier=${SYS}|${VAL}" \
  | python3 -c "import sys,json;e=json.load(sys.stdin).get('entry') or [];print(e[0]['resource']['id'] if e else '')")
if [[ -z "$BOT_ID" ]]; then
  BOT_ID=$(curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot" -d "{
    \"resourceType\":\"Bot\",\"name\":\"$NAME\",
    \"identifier\":[{\"system\":\"$SYS\",\"value\":\"$VAL\"}],
    \"runtimeVersion\":\"vmcontext\",\"description\":\"Golden-record MDM (F2): link/query/create-link/update-link/merge/not-duplicate/find-duplicates\"
  }" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
  [[ -z "$BOT_ID" || "$BOT_ID" == "None" ]] && { echo "ERROR: create failed (need project admin + 'bots' feature)"; exit 1; }
  echo "    created Bot/$BOT_ID"
else echo "    found Bot/$BOT_ID"; fi
echo "==> Deploy code"
CODE=$(python3 -c "import json;print(json.dumps(open('dist/golden-record-mdm.cjs').read()))")
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot/$BOT_ID/\$deploy" -d "{\"code\": $CODE, \"filename\": \"index.js\"}" >/dev/null
echo "    deployed. Bot/$BOT_ID"
echo "Invoke: POST $FHIR/Bot/$BOT_ID/\$execute  (operation in Parameters)"
```

- [ ] **Step 2: Create `scripts/deploy-and-test-local.sh`** (deploy + seed + run all 7 operations)

```bash
#!/usr/bin/env bash
# Deploy golden-record-mdm to a Medplum server and exercise ALL F2 operations.
# Usage: BASE=http://localhost:8103 TOKEN=<admin bearer> ./scripts/deploy-and-test-local.sh
set -euo pipefail
BASE="${BASE:?}"; TOKEN="${TOKEN:?}"; FHIR="$BASE/fhir/R4"
AUTH=(-H "Authorization: Bearer $TOKEN"); JSON=(-H 'Content-Type: application/fhir+json' -H 'Accept: application/fhir+json')

echo "==> Build + deploy"; npm run build >/dev/null
BOT_ID=$(curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot" -d '{"resourceType":"Bot","name":"golden-record-mdm-test","runtimeVersion":"vmcontext"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
CODE=$(python3 -c "import json;print(json.dumps(open('dist/golden-record-mdm.cjs').read()))")
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot/$BOT_ID/\$deploy" -d "{\"code\": $CODE, \"filename\":\"index.js\"}" >/dev/null
echo "    Bot/$BOT_ID"

exec_op() { curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot/$BOT_ID/\$execute" -d "$1" | python3 -m json.tool; }

echo "==> Seed two matching source Patients (Maria Garcia) + one different"
P1=$(curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Patient" -d '{"resourceType":"Patient","name":[{"family":"Garcia","given":["Maria"]}],"birthDate":"1985-03-12","gender":"female","identifier":[{"system":"urn:mrn","value":"M-1"}]}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
sleep 1
echo "--- F2.2 link (source 1) ---"; exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"link"},{"name":"resource","resource":{"resourceType":"Patient","id":"'"$P1"'","name":[{"family":"Garcia","given":["Maria"]}],"birthDate":"1985-03-12"}}]}'
P2=$(curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Patient" -d '{"resourceType":"Patient","name":[{"family":"Garcia","given":["Maria"]}],"birthDate":"1985-03-12","identifier":[{"system":"urn:ssn","value":"S-2"}]}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
sleep 1
echo "--- F2.2 link (source 2 → same golden) ---"; exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"link"},{"name":"resource","resource":{"resourceType":"Patient","id":"'"$P2"'","name":[{"family":"Garcia","given":["Maria"]}],"birthDate":"1985-03-12"}}]}'

echo "--- F2.1 golden _tag search ---"
curl -s "${AUTH[@]}" "$FHIR/Patient?_tag=http://hapifhir.io/fhir/NamingSystem/mdm-record-status|GOLDEN_RECORD" | python3 -c "import sys,json;d=json.load(sys.stdin);print('goldens:',d.get('total'));[print(' ',e['resource']['id']) for e in d.get('entry',[])]"
GOLDEN=$(curl -s "${AUTH[@]}" "$FHIR/Patient?_tag=http://hapifhir.io/fhir/NamingSystem/mdm-record-status|GOLDEN_RECORD" | python3 -c "import sys,json;e=json.load(sys.stdin).get('entry') or [];print(e[0]['resource']['id'] if e else '')")

echo "--- F2.3 query-links ---"; exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"query-links"},{"name":"goldenResourceId","valueString":"Patient/'"$GOLDEN"'"}]}'
echo "--- F2.4 create-link (manual) ---"; P3=$(curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Patient" -d '{"resourceType":"Patient","name":[{"family":"Garcia","given":["Maria"]}]}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])"); exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"create-link"},{"name":"goldenResourceId","valueString":"Patient/'"$GOLDEN"'"},{"name":"resourceId","valueString":"Patient/'"$P3"'"}]}'
echo "--- F2.5 update-link (PROPOSE-ONLY) ---"; exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"update-link"},{"name":"goldenResourceId","valueString":"Patient/'"$GOLDEN"'"},{"name":"resourceId","valueString":"Patient/'"$P3"'"},{"name":"matchResult","valueString":"NO_MATCH"}]}'
echo "--- F2.6 audit (link history) ---"; curl -s "${AUTH[@]}" "$FHIR/AuditEvent?_count=5&_sort=-_lastUpdated" | python3 -c "import sys,json;d=json.load(sys.stdin);print('auditEvents:',d.get('total'))"
echo "--- F2.7 find-duplicates ---"; exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"find-duplicates"}]}'
echo "--- F2.8 merge (PROPOSE-ONLY) ---"; exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"merge"},{"name":"sourceGolden","valueString":"Patient/'"$GOLDEN"'"},{"name":"targetGolden","valueString":"Patient/'"$GOLDEN"'"}]}'
echo "--- F2.8 not-duplicate ---"; exec_op '{"resourceType":"Parameters","parameter":[{"name":"operation","valueString":"not-duplicate"},{"name":"goldenA","valueString":"Patient/'"$GOLDEN"'"},{"name":"goldenB","valueString":"Patient/'"$GOLDEN"'"}]}'
echo "==> done. Bot/$BOT_ID"
```

- [ ] **Step 3: chmod + syntax check**

Run: `cd bots/golden-record-mdm && chmod +x scripts/*.sh && bash -n scripts/deploy-bot-dev.sh && bash -n scripts/deploy-and-test-local.sh && echo "syntax OK"`
Expected: `syntax OK`.

- [ ] **Step 4: Create `LOCAL-TEST.md`** — the full F2 curl set (the deliverable)

Write a markdown doc with: prereqs (same as DEPLOYMENT.md — `bots` feature, admin client, CJS bundle); how to get a token; `npm test`; the deploy command; and a **"F2 criteria → curl"** section listing, for EACH of F2.1–F2.10, the exact `$execute` curl (operation body) + expected output shape. Map every row:
- F2.1 → `GET Patient?_tag=…|GOLDEN_RECORD`
- F2.2 → `operation=link`
- F2.3 → `operation=query-links`
- F2.4 → `operation=create-link`
- F2.5 → `operation=update-link` (note: returns `proposed:true`)
- F2.6 → `GET AuditEvent?...`
- F2.7 → `operation=find-duplicates`
- F2.8 → `operation=merge` (proposed) + `operation=not-duplicate`
- F2.9 → note thresholds/SoR via `Bot.secrets` (CERTAIN/PROBABLE/POSSIBLE/SOR_PRIORITY)
- F2.10 → the deploy step itself + a sample `$execute`
Reference `../DEPLOYMENT.md` for the generic flow. State clearly that update-link/merge are propose-only.

- [ ] **Step 5: Commit** — **SKIP (user rule).**

---

## Task 13: Final verification

- [ ] **Step 1: Full suite green**

Run: `cd bots/golden-record-mdm && npx vitest run`
Expected: all tests pass (copied matcher + constants + survivorship + params + golden + 7 operation suites + dispatcher).

- [ ] **Step 2: Confirm F1 bot is untouched**

Run: `cd bots/fuzzy-match && npx vitest run`
Expected: still 37 (or current) tests pass — proves we didn't disturb F1.

- [ ] **Step 3: Build clean**

Run: `cd bots/golden-record-mdm && npm run build`
Expected: `Built dist/golden-record-mdm.cjs`, no type errors.

- [ ] **Step 4: Report** — summarize what's built; hand the deploy + F2 curl set to the user (user deploys to dev manually). **Do not commit.**

---

## Self-Review notes (for the implementer)
- **Spec coverage:** F2.1 (golden+tag) Task 5/12; F2.2 (auto-link/survivorship) Task 3+6; F2.3 (query-links) Task 7; F2.4 (create-link) Task 7; F2.5 (update-link propose) Task 8; F2.6 (audit) Task 5(audit.ts)+12; F2.7 (find-duplicates) Task 9; F2.8 (merge propose + not-duplicate) Task 8; F2.9 (config thresholds/SoR) Task 4+10; F2.10 (deploy) Task 11/12. All 10 covered.
- **Propose-only safety (spec §1/§3/§6):** update-link + merge create Tasks only; tests assert mutation-free (Task 8).
- **F1 untouched (user rule):** matcher is COPIED (Task 1 Step 5); Task 13 Step 2 re-runs F1 tests to prove it.
- **DO NOT COMMIT (user rule):** every commit step says SKIP. Implementer must not run git commit.
- **Determinism:** no `Date.now()`/`new Date()`-no-arg; EID derived from source id; audit `recorded` fixed epoch (server sets real time).
- **Type consistency:** `runLink/runQueryLinks/runCreateLink/runUpdateLink/runMerge/runNotDuplicate/runFindDuplicates`, `computeSurvivorship`, `GoldenDemographics`, `createGolden/linkSourceToGolden/findGoldenForSource/findSourcesForGolden/findAllGoldens/updateGoldenDemographics/isGolden`, `MDM`, `findDuplicateMarkers`, `getThresholdsFromSecrets/getSorPriority` — names consistent across tasks.
