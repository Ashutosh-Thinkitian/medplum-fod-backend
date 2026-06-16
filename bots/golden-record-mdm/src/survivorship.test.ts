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
    expect(phones).toEqual(['5550001']);
    expect(emails.sort()).toEqual(['a@x.com', 'b@x.com']);
  });

  test('empty sources → empty golden demographics (no crash)', () => {
    expect(computeSurvivorship([], SOR)).toEqual({});
  });
});
