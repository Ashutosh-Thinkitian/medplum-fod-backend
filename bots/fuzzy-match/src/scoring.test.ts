import { describe, expect, test } from 'vitest';
import type { Patient } from '@medplum/fhirtypes';
import { classifyGrade, scoreCandidate, DEFAULT_THRESHOLDS, nameSimilarity } from './scoring';

describe('nameSimilarity (0..1, Levenshtein-based + Soundex bonus)', () => {
  test('exact = 1', () => expect(nameSimilarity('Garcia', 'Garcia')).toBe(1));
  test('typo Garcis ~0.83', () => expect(nameSimilarity('Garcis', 'Garcia')).toBeCloseTo(0.833, 2));
  test('dropped Garca = 0.92 (Soundex ignores vowels, G620 == G620)', () =>
    expect(nameSimilarity('Garca', 'Garcia')).toBeCloseTo(0.92, 2));
  test('phonetic Garsia gets Soundex bonus 0.92', () => {
    // Garsia vs Garcia: lev dist 1 / 6 = 0.833; soundex equal -> 0.92; max = 0.92
    expect(nameSimilarity('Garsia', 'Garcia')).toBeCloseTo(0.92, 2);
  });
  test('garbage Zzzzzz ~0', () => expect(nameSimilarity('Zzzzzz', 'Garcia')).toBeLessThan(0.2));
  test('empty inputs = 0', () => expect(nameSimilarity('', 'Garcia')).toBe(0));
});

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

  test('DOB-only query (no name/identifier) cannot reach certain', () => {
    const r = scoreCandidate({ resourceType: 'Patient', birthDate: '1985-03-12' }, target);
    // exact DOB would naively be 1.0; without a name/identifier anchor it must be capped below certain
    expect(classifyGrade(r.score, DEFAULT_THRESHOLDS)).not.toBe('certain');
  });
  test('gender-only query cannot reach certain', () => {
    const r = scoreCandidate({ resourceType: 'Patient', gender: 'female' }, target);
    expect(classifyGrade(r.score, DEFAULT_THRESHOLDS)).not.toBe('certain');
  });
  test('family-name present keeps strong matches at certain (anchor present)', () => {
    const r = scoreCandidate({ resourceType: 'Patient', name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' }, target);
    expect(classifyGrade(r.score, DEFAULT_THRESHOLDS)).toBe('certain');
  });
  test('identifier-only exact match is allowed to be certain (strong anchor)', () => {
    const r = scoreCandidate({ resourceType: 'Patient', identifier: [{ system: 'urn:mrn', value: 'MRN-2001' }] }, target);
    expect(classifyGrade(r.score, DEFAULT_THRESHOLDS)).toBe('certain');
  });
});
