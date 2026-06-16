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
