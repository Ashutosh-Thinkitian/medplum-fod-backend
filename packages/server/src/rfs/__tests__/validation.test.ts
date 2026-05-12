// SPDX-License-Identifier: Apache-2.0
import type { Patient, ServiceRequest } from '@medplum/fhirtypes';
import { validateForComplete } from '../validation';
import { RFS_CS, RFS_CATEGORY_CODE, SSN_SYSTEM } from '../codesystems';
import { RFS_EXT, PATIENT_EXT } from '../extensions';

const minimalSR = (overrides: Partial<ServiceRequest> = {}): ServiceRequest => ({
  resourceType: 'ServiceRequest',
  status: 'draft',
  intent: 'order',
  subject: { reference: 'Patient/p1' },
  performer: [{ reference: 'HealthcareService/h1' }],
  priority: 'routine',
  category: [{ coding: [{ system: RFS_CS.serviceRequestCategory, code: RFS_CATEGORY_CODE }] }],
  reasonCode: [{ coding: [{ system: RFS_CS.serviceType, code: 'mental-health' }] }],
  note: [{ text: 'Patient reports needing services' }],
  extension: [
    { url: RFS_EXT.requestMethod, valueCode: 'phone' },
    { url: RFS_EXT.languageUsed, valueCodeableConcept: { coding: [{ system: 'urn:ietf:bcp:47', code: 'en' }] } },
    { url: RFS_EXT.interpreterUsed, extension: [{ url: 'used', valueBoolean: false }] },
  ],
  ...overrides,
});

const minimalPatient = (overrides: Partial<Patient> = {}): Patient => ({
  resourceType: 'Patient',
  active: true,
  name: [{ family: 'Patient', given: ['Test'] }],
  birthDate: '1990-05-12',
  gender: 'unknown',
  communication: [{ preferred: true, language: { coding: [{ system: 'urn:ietf:bcp:47', code: 'en' }] } }],
  telecom: [{ system: 'phone', value: '5555555555' }],
  address: [{ line: ['1 Test St'], city: 'San Jose', state: 'CA', postalCode: '95112' }],
  identifier: [{ system: SSN_SYSTEM, value: '123-45-6789' }],
  ...overrides,
});

describe('validateForComplete', () => {
  test('passes a fully populated minimal RFS', () => {
    const result = validateForComplete(minimalSR(), minimalPatient());
    expect(result.ok).toBe(true);
  });

  test('fails when performer is missing', () => {
    const result = validateForComplete(minimalSR({ performer: undefined }), minimalPatient());
    expect(result.ok).toBe(false);
    expect(result.issues).toContain('performer');
  });

  test('accepts ssn-unknown extension in lieu of SSN identifier', () => {
    const patient = minimalPatient({
      identifier: [],
      extension: [{ url: PATIENT_EXT.ssnUnknown, valueBoolean: true }],
    });
    const result = validateForComplete(minimalSR(), patient);
    expect(result.ok).toBe(true);
  });

  test('accepts dob-unknown + estimated-age in lieu of birthDate', () => {
    const patient = minimalPatient({
      birthDate: undefined,
      extension: [
        { url: PATIENT_EXT.dobUnknown, valueBoolean: true },
        { url: PATIENT_EXT.estimatedAge, valueInteger: 30 },
      ],
    });
    const result = validateForComplete(minimalSR(), patient);
    expect(result.ok).toBe(true);
  });

  test('fails when Patient is still a stub (active=false)', () => {
    const patient = minimalPatient({ active: false });
    const result = validateForComplete(minimalSR(), patient);
    expect(result.ok).toBe(false);
    expect(result.issues.join(',')).toMatch(/active/);
  });
});
