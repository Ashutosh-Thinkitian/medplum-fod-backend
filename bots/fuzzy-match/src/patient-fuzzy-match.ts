// SPDX-License-Identifier: Apache-2.0
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Bundle, BundleEntry, Parameters, Patient } from '@medplum/fhirtypes';
import { normalizeName } from './text-distance';
import { classifyGrade, DEFAULT_THRESHOLDS, scoreCandidate, type Thresholds } from './scoring';

const MATCH_GRADE_URL = 'http://hl7.org/fhir/StructureDefinition/match-grade';

/**
 * Minimum prefix length for name stem searches.
 * 3 chars ensures "Garsia" (stem "gar") still finds "Garcia" ("garcia" contains "gar").
 * 4 chars would miss this: "gars" is NOT a substring of "garcia".
 */
const NAME_STEM_LENGTH = 3;

/** Read thresholds from Bot.secrets (CERTAIN/PROBABLE/POSSIBLE), else defaults. */
function readThresholds(secrets: Record<string, { name: string; valueString?: string }>): Thresholds {
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
  // Guard against misconfigured secrets (e.g. inverted or out-of-range): fall back to defaults.
  const valid = t.certain > t.probable && t.probable > t.possible && t.possible > 0 && t.certain <= 1;
  return valid ? t : DEFAULT_THRESHOLDS;
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

/**
 * Broad candidate gathering via the FHIR API — name tokens, DOB, telecom, identifier.
 *
 * Name stems use NAME_STEM_LENGTH=3 chars so phonetic variants like "Garsia" (stem "gar")
 * still match "Garcia" ("garcia" contains "gar"). Using 4 chars would miss: "gars" is NOT
 * in "garcia". The MockClient's MemoryRepository uses substring matching for all string
 * search params (including :contains), so the stem approach works reliably in tests.
 */
async function gatherCandidates(medplum: MedplumClient, input: Patient): Promise<Patient[]> {
  const seen = new Map<string, Patient>();
  // Persisted Medplum resources always have an id; transient (id-less) results are ignored for dedup.
  const add = (list: Patient[]): void => {
    for (const p of list) if (p.id) seen.set(p.id, p);
  };

  const families = (input.name ?? []).map((n) => n.family ?? '').filter(Boolean);
  const givens = (input.name ?? []).flatMap((n) => n.given ?? []).filter(Boolean);

  // Family name stems — use short prefix to catch phonetic/spelling variants.
  // "Garsia"→stem "gar" finds "Garcia"; "Garca"→stem "gar" also finds "Garcia".
  const familyStems = new Set<string>();
  for (const f of families) {
    const nf = normalizeName(f);
    if (nf.length >= NAME_STEM_LENGTH) {
      familyStems.add(nf.slice(0, NAME_STEM_LENGTH));
    } else if (nf) {
      familyStems.add(nf);
    }
  }
  const familyResults = await Promise.all(
    [...familyStems].map((stem) => medplum.searchResources('Patient', { 'family:contains': stem, _count: '100' }))
  );
  for (const list of familyResults) add(list);

  // Given name stems — similarly short prefix.
  const givenStems = new Set<string>();
  for (const g of givens) {
    const ng = normalizeName(g);
    if (ng.length >= NAME_STEM_LENGTH) {
      givenStems.add(ng.slice(0, NAME_STEM_LENGTH));
    } else if (ng) {
      givenStems.add(ng);
    }
  }
  const givenResults = await Promise.all(
    [...givenStems].map((stem) => medplum.searchResources('Patient', { 'given:contains': stem, _count: '100' }))
  );
  for (const list of givenResults) add(list);

  // DOB exact match.
  if (input.birthDate) {
    add(await medplum.searchResources('Patient', { birthdate: input.birthDate, _count: '100' }));
  }

  // Identifier exact match.
  for (const id of input.identifier ?? []) {
    if (id.value) {
      const v = id.system ? `${id.system}|${id.value}` : id.value;
      add(await medplum.searchResources('Patient', { identifier: v, _count: '100' }));
    }
  }

  // Telecom (phone/email).
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
