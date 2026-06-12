# Medplum Fuzzy Patient-Match Bot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only Medplum Bot that brings client/patient search-match to F1 parity with HAPI FHIR MDM, using Levenshtein distance (Damerau-Levenshtein) + Soundex, and live-verify it.

**Architecture:** A standalone bot project (mirrors `examples/medplum-demo-bots`, Vitest + `@medplum/mock`). One Bot `handler(medplum, event)` takes a `$match`-shaped `Parameters` input, gathers candidates via the FHIR API (broad name/DOB/telecom/identifier searches), scores each candidate with inlined Damerau-Levenshtein + Soundex on names + exact on other fields, and returns a `$match`-shaped `Bundle` (searchset with `search.score` + `match-grade`). Pure scoring functions are unit-tested here; server integration is proven by a deploy-and-test script the user runs locally against `docker compose`.

**Tech Stack:** TypeScript, `@medplum/core`, `@medplum/fhirtypes`, `@medplum/mock`, `@medplum/cli`, Vitest. No external runtime deps (Levenshtein + Soundex inlined so the Bot runs in Medplum's vmcontext sandbox with no module resolution).

**Spec:** `docs/superpowers/specs/2026-06-10-medplum-fuzzy-match-bot-design.md`

**Working directory:** project root `bots/fuzzy-match/` inside the medplum repo.

---

## File Structure

- `bots/fuzzy-match/package.json` — standalone bot project (Vitest, build via esbuild, deploy via `@medplum/cli`).
- `bots/fuzzy-match/tsconfig.json` — TS config.
- `bots/fuzzy-match/vitest.config.ts` — Vitest config.
- `bots/fuzzy-match/src/text-distance.ts` — `damerauLevenshtein`, `normalizeName`, `soundex` (pure functions).
- `bots/fuzzy-match/src/text-distance.test.ts` — unit tests for the above.
- `bots/fuzzy-match/src/scoring.ts` — `nameSimilarity`, `scoreCandidate`, `classifyGrade` (pure functions; the matching brain).
- `bots/fuzzy-match/src/scoring.test.ts` — unit tests proving each F1 row's score.
- `bots/fuzzy-match/src/patient-fuzzy-match.ts` — the Bot `handler` (candidate gathering + scoring + Bundle output).
- `bots/fuzzy-match/src/patient-fuzzy-match.test.ts` — integration tests with `MockClient` (full F1 battery in-memory).
- `bots/fuzzy-match/scripts/deploy-and-test.sh` — user-run: create test patient + invoke bot live + print results.
- `bots/fuzzy-match/LOCAL-TEST.md` — exact local steps.

---

## Task 1: Scaffold the bot project

**Files:**
- Create: `bots/fuzzy-match/package.json`
- Create: `bots/fuzzy-match/tsconfig.json`
- Create: `bots/fuzzy-match/vitest.config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "medplum-fuzzy-match-bot",
  "version": "1.0.0",
  "description": "Levenshtein+Soundex fuzzy Patient $match Bot for Medplum (F1 parity with HAPI MDM)",
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
    "target": "ES2021",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2021", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
  },
});
```

- [ ] **Step 4: Install deps**

Run: `cd bots/fuzzy-match && npm install`
Expected: installs without error; `node_modules` created.

- [ ] **Step 5: Commit**

```bash
git add bots/fuzzy-match/package.json bots/fuzzy-match/tsconfig.json bots/fuzzy-match/vitest.config.ts bots/fuzzy-match/package-lock.json
git commit -m "chore(fuzzy-bot): scaffold bot project (vitest + medplum mock)"
```

---

## Task 2: Text-distance primitives (Damerau-Levenshtein, normalize, Soundex)

**Files:**
- Create: `bots/fuzzy-match/src/text-distance.ts`
- Test: `bots/fuzzy-match/src/text-distance.test.ts`

- [ ] **Step 1: Write the failing test**

`bots/fuzzy-match/src/text-distance.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { damerauLevenshtein, normalizeName, soundex } from './text-distance';

describe('normalizeName', () => {
  test('lowercases, trims, strips diacritics', () => {
    expect(normalizeName('  José ')).toBe('jose');
    expect(normalizeName('GARCIA')).toBe('garcia');
  });
});

describe('damerauLevenshtein', () => {
  test('identical = 0', () => expect(damerauLevenshtein('garcia', 'garcia')).toBe(0));
  test('substitution = 1 (Garcis)', () => expect(damerauLevenshtein('garcis', 'garcia')).toBe(1));
  test('deletion = 1 (Garca)', () => expect(damerauLevenshtein('garca', 'garcia')).toBe(1));
  test('transposition = 1 (Gracia)', () => expect(damerauLevenshtein('gracia', 'garcia')).toBe(1));
  test('garbage is large', () => expect(damerauLevenshtein('zzzzzz', 'garcia')).toBe(6));
});

describe('soundex', () => {
  test('Garcia = G620', () => expect(soundex('Garcia')).toBe('G620'));
  test('Garsia = G620 (phonetic match)', () => expect(soundex('Garsia')).toBe('G620'));
  test('Garca = G620', () => expect(soundex('Garca')).toBe('G620'));
  test('Zzzzzz != G620', () => expect(soundex('Zzzzzz')).not.toBe('G620'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bots/fuzzy-match && npx vitest run src/text-distance.test.ts`
Expected: FAIL — "Cannot find module './text-distance'".

- [ ] **Step 3: Write the implementation**

`bots/fuzzy-match/src/text-distance.ts`:
```ts
// SPDX-License-Identifier: Apache-2.0
// Self-contained text-distance primitives (no external deps — runs in Medplum vmcontext).

/** Lowercase, trim, strip combining diacritics (NFD). */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/** Damerau-Levenshtein edit distance (Levenshtein + adjacent transposition). */
export function damerauLevenshtein(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const d: number[][] = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1, // deletion
        d[i][j - 1] + 1, // insertion
        d[i - 1][j - 1] + cost // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1); // transposition
      }
    }
  }
  return d[al][bl];
}

/** American Soundex (4-char code). Empty string for empty/non-alpha input. */
export function soundex(input: string): string {
  const s = normalizeName(input).replace(/[^a-z]/g, '');
  if (!s) return '';
  const codes: Record<string, string> = {
    b: '1', f: '1', p: '1', v: '1',
    c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
    d: '3', t: '3',
    l: '4',
    m: '5', n: '5',
    r: '6',
  };
  const first = s[0].toUpperCase();
  let prev = codes[s[0]] ?? '';
  let out = first;
  for (let i = 1; i < s.length && out.length < 4; i++) {
    const ch = s[i];
    const code = codes[ch] ?? '';
    if (code && code !== prev) out += code;
    if (ch !== 'h' && ch !== 'w') prev = code;
  }
  return (out + '000').slice(0, 4);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bots/fuzzy-match && npx vitest run src/text-distance.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add bots/fuzzy-match/src/text-distance.ts bots/fuzzy-match/src/text-distance.test.ts
git commit -m "feat(fuzzy-bot): add Damerau-Levenshtein + Soundex + normalize primitives"
```

---

## Task 3: Name similarity (Levenshtein-normalized + Soundex bonus)

**Files:**
- Create: `bots/fuzzy-match/src/scoring.ts` (partial — `nameSimilarity` only this task)
- Test: `bots/fuzzy-match/src/scoring.test.ts` (partial)

- [ ] **Step 1: Write the failing test**

`bots/fuzzy-match/src/scoring.test.ts`:
```ts
import { describe, expect, test } from 'vitest';
import { nameSimilarity } from './scoring';

describe('nameSimilarity (0..1, Levenshtein-based + Soundex bonus)', () => {
  test('exact = 1', () => expect(nameSimilarity('Garcia', 'Garcia')).toBe(1));
  test('typo Garcis ~0.83', () => expect(nameSimilarity('Garcis', 'Garcia')).toBeCloseTo(0.833, 2));
  test('dropped Garca ~0.83', () => expect(nameSimilarity('Garca', 'Garcia')).toBeCloseTo(0.833, 2));
  test('phonetic Garsia gets Soundex bonus 0.92', () => {
    // Garsia vs Garcia: lev dist 1 / 6 = 0.833; soundex equal -> 0.92; max = 0.92
    expect(nameSimilarity('Garsia', 'Garcia')).toBeCloseTo(0.92, 2);
  });
  test('garbage Zzzzzz ~0', () => expect(nameSimilarity('Zzzzzz', 'Garcia')).toBeLessThan(0.2));
  test('empty inputs = 0', () => expect(nameSimilarity('', 'Garcia')).toBe(0));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bots/fuzzy-match && npx vitest run src/scoring.test.ts`
Expected: FAIL — "Cannot find module './scoring'" or "nameSimilarity is not a function".

- [ ] **Step 3: Write the implementation**

`bots/fuzzy-match/src/scoring.ts`:
```ts
// SPDX-License-Identifier: Apache-2.0
import { damerauLevenshtein, normalizeName, soundex } from './text-distance';

const SOUNDEX_BONUS = 0.92;

/** 0..1 name similarity: max(normalized Levenshtein distance, Soundex-equal bonus). */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = damerauLevenshtein(na, nb);
  const editScore = 1 - dist / Math.max(na.length, nb.length);
  const phoneticScore = soundex(na) === soundex(nb) ? SOUNDEX_BONUS : 0;
  return Math.max(editScore, phoneticScore);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bots/fuzzy-match && npx vitest run src/scoring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add bots/fuzzy-match/src/scoring.ts bots/fuzzy-match/src/scoring.test.ts
git commit -m "feat(fuzzy-bot): add nameSimilarity (Levenshtein + Soundex)"
```

---

## Task 4: Candidate scoring + grade classification

**Files:**
- Modify: `bots/fuzzy-match/src/scoring.ts` (add `scoreCandidate`, `classifyGrade`, `Thresholds`)
- Modify: `bots/fuzzy-match/src/scoring.test.ts` (add tests)

- [ ] **Step 1: Write the failing test (append)**

Append to `bots/fuzzy-match/src/scoring.test.ts`:
```ts
import type { Patient } from '@medplum/fhirtypes';
import { classifyGrade, scoreCandidate, DEFAULT_THRESHOLDS } from './scoring';

const target: Patient = {
  resourceType: 'Patient',
  name: [{ family: 'Garcia', given: ['Maria', 'Elena'] }, { use: 'nickname', given: ['Mary'] }],
  birthDate: '1985-03-12',
  identifier: [{ system: 'urn:mrn', value: 'MRN-2001' }],
  telecom: [{ system: 'phone', value: '555-0201' }, { system: 'email', value: 'maria.garcia@example.com' }],
  gender: 'female',
};

describe('scoreCandidate', () => {
  test('exact name+dob -> ~1.0 certain', () => {
    const r = scoreCandidate({ resourceType: 'Patient', name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' }, target);
    expect(r.score).toBeGreaterThan(0.95);
    expect(classifyGrade(r.score, DEFAULT_THRESHOLDS)).toBe('certain');
  });
  test('typo Garcis+dob -> name actually scored (>0.8), graded', () => {
    const r = scoreCandidate({ resourceType: 'Patient', name: [{ family: 'Garcis', given: ['Maria'] }], birthDate: '1985-03-12' }, target);
    expect(r.score).toBeGreaterThan(0.8);
    expect(['certain', 'probable']).toContain(classifyGrade(r.score, DEFAULT_THRESHOLDS));
  });
  test('name only (no dob) typo -> still a probable/possible', () => {
    const r = scoreCandidate({ resourceType: 'Patient', name: [{ family: 'Garca', given: ['Maria'] }] }, target);
    expect(r.score).toBeGreaterThan(0.45);
  });
  test('phonetic Garsia -> high', () => {
    const r = scoreCandidate({ resourceType: 'Patient', name: [{ family: 'Garsia', given: ['Maria'] }] }, target);
    expect(r.score).toBeGreaterThan(0.85);
  });
  test('garbage name + correct dob -> below possible threshold', () => {
    const r = scoreCandidate({ resourceType: 'Patient', name: [{ family: 'Zzzzzz', given: ['Maria'] }], birthDate: '1985-03-12' }, target);
    expect(r.score).toBeLessThan(DEFAULT_THRESHOLDS.possible);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bots/fuzzy-match && npx vitest run src/scoring.test.ts`
Expected: FAIL — `scoreCandidate`/`classifyGrade`/`DEFAULT_THRESHOLDS` not exported.

- [ ] **Step 3: Write the implementation (append to `scoring.ts`)**

Append to `bots/fuzzy-match/src/scoring.ts`:
```ts
import type { Patient } from '@medplum/fhirtypes';

export type MatchGrade = 'certain' | 'probable' | 'possible' | 'certainly-not';

export interface Thresholds {
  certain: number;
  probable: number;
  possible: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { certain: 0.85, probable: 0.65, possible: 0.45 };

export interface ScoredCandidate {
  patient: Patient;
  score: number;
}

const WEIGHTS = {
  identifier: 0.35,
  family: 0.3,
  given: 0.2,
  birthDate: 0.2,
  phone: 0.2,
  email: 0.2,
  gender: 0.05,
};

function digits(s: string): string {
  return s.replace(/\D/g, '');
}

function bestFamily(p: Patient): string[] {
  return (p.name ?? []).map((n) => n.family ?? '').filter(Boolean);
}
function allGiven(p: Patient): string[] {
  return (p.name ?? []).flatMap((n) => n.given ?? []).filter(Boolean);
}
function telecom(p: Patient, system: 'phone' | 'email'): string[] {
  return (p.telecom ?? []).filter((t) => t.system === system && t.value).map((t) => t.value as string);
}

/** Best name similarity across all of input's vs candidate's name parts. */
function bestNameSim(inputs: string[], cands: string[]): number {
  let best = 0;
  for (const i of inputs) for (const c of cands) best = Math.max(best, nameSimilarity(i, c));
  return best;
}

/** Weighted score over fields present on BOTH input and candidate; normalized to 0..1. */
export function scoreCandidate(input: Patient, candidate: Patient): ScoredCandidate {
  let score = 0;
  let total = 0;

  // identifier — exact (value + system)
  const inIds = input.identifier ?? [];
  const cIds = candidate.identifier ?? [];
  if (inIds.length && cIds.length) {
    total += WEIGHTS.identifier;
    const hit = inIds.some((a) => cIds.some((b) => a.value === b.value && (!a.system || a.system === b.system)));
    if (hit) score += WEIGHTS.identifier;
  }

  // family — fuzzy
  const inFam = bestFamily(input);
  const cFam = bestFamily(candidate);
  if (inFam.length && cFam.length) {
    total += WEIGHTS.family;
    score += WEIGHTS.family * bestNameSim(inFam, cFam);
  }

  // given — fuzzy
  const inGiv = allGiven(input);
  const cGiv = allGiven(candidate);
  if (inGiv.length && cGiv.length) {
    total += WEIGHTS.given;
    score += WEIGHTS.given * bestNameSim(inGiv, cGiv);
  }

  // birthDate — exact
  if (input.birthDate && candidate.birthDate) {
    total += WEIGHTS.birthDate;
    if (input.birthDate === candidate.birthDate) score += WEIGHTS.birthDate;
  }

  // phone — exact (digits)
  const inPhone = telecom(input, 'phone').map(digits);
  const cPhone = telecom(candidate, 'phone').map(digits);
  if (inPhone.length && cPhone.length) {
    total += WEIGHTS.phone;
    if (inPhone.some((p) => cPhone.includes(p))) score += WEIGHTS.phone;
  }

  // email — exact (lowercased)
  const inEmail = telecom(input, 'email').map((e) => e.toLowerCase());
  const cEmail = telecom(candidate, 'email').map((e) => e.toLowerCase());
  if (inEmail.length && cEmail.length) {
    total += WEIGHTS.email;
    if (inEmail.some((e) => cEmail.includes(e))) score += WEIGHTS.email;
  }

  // gender — exact
  if (input.gender && candidate.gender) {
    total += WEIGHTS.gender;
    if (input.gender === candidate.gender) score += WEIGHTS.gender;
  }

  return { patient: candidate, score: total > 0 ? score / total : 0 };
}

export function classifyGrade(score: number, t: Thresholds): MatchGrade {
  if (score >= t.certain) return 'certain';
  if (score >= t.probable) return 'probable';
  if (score >= t.possible) return 'possible';
  return 'certainly-not';
}
```

> Note: the `import type { Patient }` line in the test was added in Step 1; the implementation re-imports it. Keep a single `import type { Patient } from '@medplum/fhirtypes';` at the top of `scoring.ts` (move it up if the linter complains about import position).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bots/fuzzy-match && npx vitest run src/scoring.test.ts`
Expected: PASS (all F1 scoring assertions).

- [ ] **Step 5: Commit**

```bash
git add bots/fuzzy-match/src/scoring.ts bots/fuzzy-match/src/scoring.test.ts
git commit -m "feat(fuzzy-bot): add weighted scoreCandidate + grade classification"
```

---

## Task 5: The Bot handler (candidate gathering + $match-shaped output)

**Files:**
- Create: `bots/fuzzy-match/src/patient-fuzzy-match.ts`
- Test: `bots/fuzzy-match/src/patient-fuzzy-match.test.ts`

- [ ] **Step 1: Write the failing test (full F1 battery with MockClient)**

`bots/fuzzy-match/src/patient-fuzzy-match.test.ts`:
```ts
import { ContentType, indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { SEARCH_PARAMETER_BUNDLE_FILES, readJson } from '@medplum/definitions';
import type { Bundle, Parameters, Patient, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { handler } from './patient-fuzzy-match';

function matchParams(resource: Partial<Patient>): Parameters {
  return {
    resourceType: 'Parameters',
    parameter: [{ name: 'resource', resource: { resourceType: 'Patient', ...resource } as Patient }],
  };
}
function grades(b: Bundle): string[] {
  return (b.entry ?? []).map(
    (e) => e.search?.extension?.find((x) => x.url.endsWith('match-grade'))?.valueCode ?? ''
  );
}

describe('patient-fuzzy-match Bot (F1 battery)', () => {
  let medplum: MockClient;
  const bot = { reference: 'Bot/123' };
  const secrets = {};

  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    for (const f of SEARCH_PARAMETER_BUNDLE_FILES) {
      indexSearchParameterBundle(readJson(f) as Bundle<SearchParameter>);
    }
  });

  beforeEach(async () => {
    medplum = new MockClient();
    await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ family: 'Garcia', given: ['Maria', 'Elena'] }],
      birthDate: '1985-03-12',
      gender: 'female',
      identifier: [{ system: 'urn:mrn', value: 'MRN-2001' }],
      telecom: [{ system: 'phone', value: '555-0201' }],
    });
  });

  async function run(resource: Partial<Patient>): Promise<Bundle> {
    return (await handler(medplum, {
      bot,
      input: matchParams(resource),
      contentType: ContentType.FHIR_JSON,
      secrets,
    })) as Bundle;
  }

  test('F1.1 exact name+DOB -> certain', async () => {
    const b = await run({ name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' });
    expect(b.entry?.length).toBe(1);
    expect(grades(b)[0]).toBe('certain');
  });

  test('F1.2 typo Garcis+DOB -> matched (name scored), graded', async () => {
    const b = await run({ name: [{ family: 'Garcis', given: ['Maria'] }], birthDate: '1985-03-12' });
    expect(b.entry?.length).toBe(1);
    expect(['certain', 'probable']).toContain(grades(b)[0]);
  });

  test('F1.3 dropped Garca+DOB -> matched', async () => {
    const b = await run({ name: [{ family: 'Garca', given: ['Maria'] }], birthDate: '1985-03-12' });
    expect(b.entry?.length).toBe(1);
  });

  test('F1.4 name-only typo (no DOB) -> still returns a candidate', async () => {
    const b = await run({ name: [{ family: 'Garca', given: ['Maria'] }] });
    expect(b.entry?.length).toBeGreaterThanOrEqual(1);
  });

  test('F1.5 phonetic Garsia (name only) -> matches', async () => {
    const b = await run({ name: [{ family: 'Garsia', given: ['Maria'] }] });
    expect(b.entry?.length).toBeGreaterThanOrEqual(1);
  });

  test('F1.6 garbage Zzzzzz + correct DOB -> rejected (0 results)', async () => {
    const b = await run({ name: [{ family: 'Zzzzzz', given: ['Maria'] }], birthDate: '1985-03-12' });
    expect(b.entry?.length ?? 0).toBe(0);
  });

  test('F1.7 every entry has score + match-grade', async () => {
    const b = await run({ name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' });
    for (const e of b.entry ?? []) {
      expect(typeof e.search?.score).toBe('number');
      expect(e.search?.extension?.some((x) => x.url.endsWith('match-grade'))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd bots/fuzzy-match && npx vitest run src/patient-fuzzy-match.test.ts`
Expected: FAIL — "Cannot find module './patient-fuzzy-match'".

- [ ] **Step 3: Write the implementation**

`bots/fuzzy-match/src/patient-fuzzy-match.ts`:
```ts
// SPDX-License-Identifier: Apache-2.0
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Bundle, BundleEntry, Parameters, Patient } from '@medplum/fhirtypes';
import { normalizeName } from './text-distance';
import { classifyGrade, DEFAULT_THRESHOLDS, scoreCandidate, type Thresholds } from './scoring';

const MATCH_GRADE_URL = 'http://hl7.org/fhir/StructureDefinition/match-grade';

/** Read thresholds from Bot.secrets (CERTAIN/PROBABLE/POSSIBLE), else defaults. */
function readThresholds(secrets: Record<string, { name: string; valueString?: string }>): Thresholds {
  const num = (k: string, d: number): number => {
    const v = secrets?.[k]?.valueString;
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : d;
  };
  return {
    certain: num('CERTAIN', DEFAULT_THRESHOLDS.certain),
    probable: num('PROBABLE', DEFAULT_THRESHOLDS.probable),
    possible: num('POSSIBLE', DEFAULT_THRESHOLDS.possible),
  };
}

function getInputPatient(input: Parameters): Patient {
  const p = input.parameter?.find((x) => x.name === 'resource')?.resource;
  if (!p || p.resourceType !== 'Patient') {
    throw new Error('Input Parameters must include a "resource" of type Patient');
  }
  return p as Patient;
}
function getIntParam(input: Parameters, name: string): number | undefined {
  return input.parameter?.find((x) => x.name === name)?.valueInteger;
}
function getBoolParam(input: Parameters, name: string): boolean | undefined {
  return input.parameter?.find((x) => x.name === name)?.valueBoolean;
}

/** Broad candidate gathering via the FHIR API — name tokens, DOB, telecom, identifier. */
async function gatherCandidates(medplum: MedplumClient, input: Patient): Promise<Patient[]> {
  const seen = new Map<string, Patient>();
  const add = (list: Patient[]): void => {
    for (const p of list) if (p.id) seen.set(p.id, p);
  };

  const families = (input.name ?? []).map((n) => n.family ?? '').filter(Boolean);
  const givens = (input.name ?? []).flatMap((n) => n.given ?? []).filter(Boolean);

  // Name tokens — substring + stem-prefix (first 4 normalized chars) to catch trailing-char typos.
  const tokens = new Set<string>();
  for (const f of families) {
    const nf = normalizeName(f);
    if (nf) {
      tokens.add(nf);
      tokens.add(nf.slice(0, Math.min(4, nf.length)));
    }
  }
  for (const stem of tokens) {
    add(await medplum.searchResources('Patient', { 'family:contains': stem, _count: '100' }));
  }
  const givenTokens = new Set<string>();
  for (const g of givens) {
    const ng = normalizeName(g);
    if (ng) givenTokens.add(ng.slice(0, Math.min(4, ng.length)));
  }
  for (const stem of givenTokens) {
    add(await medplum.searchResources('Patient', { 'given:contains': stem, _count: '100' }));
  }

  if (input.birthDate) {
    add(await medplum.searchResources('Patient', { birthdate: input.birthDate, _count: '100' }));
  }
  for (const id of input.identifier ?? []) {
    if (id.value) {
      const v = id.system ? `${id.system}|${id.value}` : id.value;
      add(await medplum.searchResources('Patient', { identifier: v, _count: '100' }));
    }
  }
  for (const t of input.telecom ?? []) {
    if (t.value && (t.system === 'phone' || t.system === 'email')) {
      add(await medplum.searchResources('Patient', { telecom: t.value, _count: '100' }));
    }
  }

  return Array.from(seen.values());
}

function buildBundle(scored: { patient: Patient; score: number; grade: string }[]): Bundle {
  const entry: BundleEntry[] = scored.map((s) => ({
    resource: s.patient,
    search: {
      mode: 'match',
      score: s.score,
      extension: [{ url: MATCH_GRADE_URL, valueCode: s.grade }],
    },
  }));
  return { resourceType: 'Bundle', type: 'searchset', total: entry.length, entry };
}

export async function handler(medplum: MedplumClient, event: BotEvent<Parameters>): Promise<Bundle> {
  const input = getInputPatient(event.input);
  const thresholds = readThresholds(event.secrets as Record<string, { name: string; valueString?: string }>);
  const onlyCertain = getBoolParam(event.input, 'onlyCertainMatches') ?? false;
  const maxCount = getIntParam(event.input, 'count') ?? 100;

  const candidates = await gatherCandidates(medplum, input);

  const scored = candidates
    .map((c) => {
      const { score } = scoreCandidate(input, c);
      return { patient: c, score, grade: classifyGrade(score, thresholds) };
    })
    .filter((s) => s.grade !== 'certainly-not')
    .filter((s) => (onlyCertain ? s.grade === 'certain' : true))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCount);

  return buildBundle(scored);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd bots/fuzzy-match && npx vitest run src/patient-fuzzy-match.test.ts`
Expected: PASS — all 7 F1 cases. **If F1.4/F1.5 return 0** (candidate not gathered), the stem-prefix seeding needs widening: lower the stem length to 3, or add a `name:contains` token search. Adjust `gatherCandidates`, re-run until green. Do NOT relax the assertions.

- [ ] **Step 5: Run the whole suite**

Run: `cd bots/fuzzy-match && npx vitest run`
Expected: PASS — text-distance, scoring, and bot tests all green.

- [ ] **Step 6: Commit**

```bash
git add bots/fuzzy-match/src/patient-fuzzy-match.ts bots/fuzzy-match/src/patient-fuzzy-match.test.ts
git commit -m "feat(fuzzy-bot): add handler with FHIR candidate gathering + \$match-shaped output"
```

---

## Task 6: Build config (esbuild → single deployable file)

**Files:**
- Create: `bots/fuzzy-match/esbuild-script.mjs`

- [ ] **Step 1: Create the esbuild bundler**

`bots/fuzzy-match/esbuild-script.mjs` (bundles the bot + its local imports into one ESM file Medplum can deploy):
```mjs
import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/patient-fuzzy-match.ts'],
  bundle: true,
  platform: 'node',
  target: 'es2021',
  format: 'esm',
  // @medplum/core is provided by the bot runtime; everything else (our files) is inlined.
  external: ['@medplum/*'],
  outfile: 'dist/patient-fuzzy-match.mjs',
});
console.log('Built dist/patient-fuzzy-match.mjs');
```

- [ ] **Step 2: Run the build**

Run: `cd bots/fuzzy-match && npm run build`
Expected: `dist/patient-fuzzy-match.mjs` created; `tsc --noEmit` reports no type errors.

- [ ] **Step 3: Verify the bundle inlined our helpers (no `./text-distance` import remains)**

Run: `cd bots/fuzzy-match && grep -c "damerauLevenshtein" dist/patient-fuzzy-match.mjs`
Expected: ≥1 (function inlined). And: `grep "from './text-distance'" dist/patient-fuzzy-match.mjs` → no output (bundled, not imported).

- [ ] **Step 4: Commit**

```bash
git add bots/fuzzy-match/esbuild-script.mjs
git commit -m "build(fuzzy-bot): add esbuild bundler producing single deployable file"
```

---

## Task 7: Deploy-and-test script + local instructions

**Files:**
- Create: `bots/fuzzy-match/scripts/deploy-and-test.sh`
- Create: `bots/fuzzy-match/LOCAL-TEST.md`

- [ ] **Step 1: Create `scripts/deploy-and-test.sh`**

`bots/fuzzy-match/scripts/deploy-and-test.sh`:
```bash
#!/usr/bin/env bash
# Deploy the fuzzy-match Bot to a Medplum server and run the F1 battery.
# Usage: BASE=http://localhost:8103 TOKEN=<bearer> ./scripts/deploy-and-test.sh
set -euo pipefail

BASE="${BASE:?set BASE, e.g. http://localhost:8103}"
TOKEN="${TOKEN:?set TOKEN (bearer access token)}"
FHIR="$BASE/fhir/R4"
AUTH=(-H "Authorization: Bearer $TOKEN")
JSON=(-H 'Content-Type: application/fhir+json' -H 'Accept: application/fhir+json')

echo "==> Building bot bundle"
npm run build >/dev/null

echo "==> Creating Bot resource"
BOT_ID=$(curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot" -d '{
  "resourceType":"Bot","name":"patient-fuzzy-match",
  "runtimeVersion":"vmcontext","description":"Levenshtein+Soundex fuzzy Patient match"
}' | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "    Bot/$BOT_ID"

echo "==> Uploading bot code (\$deploy)"
CODE=$(python3 -c "import json;print(json.dumps(open('dist/patient-fuzzy-match.mjs').read()))")
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot/$BOT_ID/\$deploy" \
  -d "{\"code\": $CODE}" >/dev/null
echo "    deployed"

echo "==> Creating target test Patient (Maria Garcia / 1985-03-12)"
curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Patient" -d '{
  "resourceType":"Patient","active":true,
  "identifier":[{"system":"urn:calmhsa:mrn","value":"MRN-FZ-2001"}],
  "name":[{"use":"official","family":"Garcia","given":["Maria","Elena"]}],
  "gender":"female","birthDate":"1985-03-12",
  "telecom":[{"system":"phone","value":"555-0201"},{"system":"email","value":"maria.garcia.fz@example.com"}]
}' >/dev/null
echo "    created"

run() {  # $1 = label, $2 = resource JSON
  echo "--- $1 ---"
  curl -s "${AUTH[@]}" "${JSON[@]}" -X POST "$FHIR/Bot/$BOT_ID/\$execute" \
    -d "{\"resourceType\":\"Parameters\",\"parameter\":[{\"name\":\"resource\",\"resource\":$2}]}" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
es=d.get('entry',[])
print('  total:',len(es))
for e in es:
  r=e['resource']; s=e.get('search',{}); nm=(r.get('name') or [{}])[0]
  g=[x.get('valueCode') for x in (s.get('extension') or []) if 'match-grade' in x.get('url','')]
  print('   -',nm.get('given'),nm.get('family'),r.get('birthDate'),'| score',round(s.get('score',0),4),'grade',g)"
}

echo "==> F1 battery"
run "F1.1 exact name+DOB"        '{"resourceType":"Patient","name":[{"family":"Garcia","given":["Maria"]}],"birthDate":"1985-03-12"}'
run "F1.2 typo Garcis+DOB"       '{"resourceType":"Patient","name":[{"family":"Garcis","given":["Maria"]}],"birthDate":"1985-03-12"}'
run "F1.3 dropped Garca+DOB"     '{"resourceType":"Patient","name":[{"family":"Garca","given":["Maria"]}],"birthDate":"1985-03-12"}'
run "F1.4 name-only typo no DOB" '{"resourceType":"Patient","name":[{"family":"Garca","given":["Maria"]}]}'
run "F1.5 phonetic Garsia"       '{"resourceType":"Patient","name":[{"family":"Garsia","given":["Maria"]}]}'
run "F1.6 garbage Zzzzzz+DOB"    '{"resourceType":"Patient","name":[{"family":"Zzzzzz","given":["Maria"]}],"birthDate":"1985-03-12"}'
echo "==> done. Bot/$BOT_ID"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x bots/fuzzy-match/scripts/deploy-and-test.sh`
Expected: no output.

- [ ] **Step 3: Create `LOCAL-TEST.md`**

`bots/fuzzy-match/LOCAL-TEST.md`:
```markdown
# Local test — Medplum Fuzzy Match Bot

## 0. Prereqs
- Docker running locally. Node 22+.

## 1. Start a local Medplum (same prebuilt images as prod)
From the medplum repo root:
```bash
docker compose up -d        # postgres + redis + medplum-server:latest + app
# wait ~30s, then:
curl -s http://localhost:8103/healthcheck
```

## 2. Get an access token (client_credentials)
- Log into the local app (http://localhost:3000), create a ClientApplication, copy id+secret. Then:
```bash
TOKEN=$(curl -s -X POST http://localhost:8103/oauth2/token \
  -d 'grant_type=client_credentials' -d "client_id=$CID" -d "client_secret=$CSECRET" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
```

## 3. Run unit tests (no server needed)
```bash
cd bots/fuzzy-match && npm install && npm test
```

## 4. Deploy + run F1 battery against local
```bash
cd bots/fuzzy-match
BASE=http://localhost:8103 TOKEN=$TOKEN ./scripts/deploy-and-test.sh
```
Paste the F1 output back to fill the "Medplum + Bot" matrix column.

## 5. Against prod (when satisfied)
Same script with BASE=https://medplum-api.calmhsa-works.dev and a prod token.
```

- [ ] **Step 4: Commit**

```bash
git add bots/fuzzy-match/scripts/deploy-and-test.sh bots/fuzzy-match/LOCAL-TEST.md
git commit -m "chore(fuzzy-bot): add deploy-and-test script + local instructions"
```

---

## Task 8: Update the comparison matrix with the (now-built) Medplum+Bot column

**Files:**
- Modify: `docs/medplum-vs-hapi-feature-matrix.md`

- [ ] **Step 1: Add a "Medplum + Bot" column to the F1 table**

After live results come back from `deploy-and-test.sh`, add a `Medplum + Bot (live)` column to the F1 table with the measured score/grade per row, and a note that parity is achieved via the Bot (code-owned, not config). Keep the original "Medplum only" column for contrast.

- [ ] **Step 2: Add a short verdict line**

Add under the F1 table: "With the fuzzy-match Bot, Medplum reaches functional F1 parity with HAPI (typo/dropped/name-only/phonetic all matched; garbage rejected). Residual gap vs HAPI: code-owned logic vs `mdm-rules.json` config; no golden-record lifecycle (F2)."

- [ ] **Step 3: Commit**

```bash
git add docs/medplum-vs-hapi-feature-matrix.md
git commit -m "docs: add live Medplum+Bot F1 results to comparison matrix"
```

---

## Self-Review notes (for the implementer)
- **Spec coverage:** Tasks 2–5 cover all 6 F1 rows + scored/graded output (success criteria §7). Task 7 = local-test flow (§5). Task 8 = matrix update (deliverable).
- **Threshold dependency (spec §3/§8):** garbage rejection relies on `possible=0.45`. If F1.6 returns a match in live testing, raise `POSSIBLE` via Bot.secrets (no redeploy) until garbage drops — documented in `deploy-and-test` notes.
- **Candidate-gathering risk (spec §8):** if F1.4/F1.5 miss live (substring seeding), widen stems in `gatherCandidates` (Task 5 Step 4 note). The unit tests catch this before deploy.
- **No golden records:** handler is read-only; never writes/links. Matches scope.
- **Type consistency:** `Thresholds`, `MatchGrade`, `scoreCandidate`, `classifyGrade`, `nameSimilarity`, `damerauLevenshtein`, `soundex`, `normalizeName`, `handler` names are identical across all tasks.
