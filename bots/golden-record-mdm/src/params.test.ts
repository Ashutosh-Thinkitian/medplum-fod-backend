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
    expect(t.probable).toBe(0.65);
  });
});
