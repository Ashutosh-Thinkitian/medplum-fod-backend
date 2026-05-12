// SPDX-License-Identifier: Apache-2.0
import type { Patient } from '@medplum/fhirtypes';
import { scoreMatch, type SearchInput } from '../match';

function patient(p: Partial<Patient>): Patient {
  return { resourceType: 'Patient', ...p };
}

describe('rfs/match scoring', () => {
  test('exact: lastName + DOB + SSN last 4 + phone all match', () => {
    const input: SearchInput = {
      firstName: 'John',
      lastName: 'Doe',
      dob: '1990-05-12',
      ssnLast4: '6789',
      phone: '9876543210',
    };
    const p = patient({
      name: [{ family: 'Doe', given: ['John'] }],
      birthDate: '1990-05-12',
      identifier: [{ system: 'http://hl7.org/fhir/sid/us-ssn', value: '123-45-6789' }],
      telecom: [{ system: 'phone', value: '9876543210' }],
    });
    expect(scoreMatch(input, p).confidence).toBe('exact');
  });

  test('possible: lastName + DOB only', () => {
    const input: SearchInput = { lastName: 'Doe', dob: '1990-05-12' };
    const p = patient({
      name: [{ family: 'Doe' }],
      birthDate: '1990-05-12',
    });
    expect(scoreMatch(input, p).confidence).toBe('possible');
  });

  test('none: only one field matches', () => {
    const input: SearchInput = { lastName: 'Doe' };
    const p = patient({ name: [{ family: 'Smith' }], birthDate: '1980-01-01' });
    expect(scoreMatch(input, p).confidence).toBe('none');
  });

  test('lastName comparison is case-insensitive and trimmed', () => {
    const input: SearchInput = { lastName: '  doe ', dob: '1990-05-12' };
    const p = patient({ name: [{ family: 'DOE' }], birthDate: '1990-05-12' });
    expect(scoreMatch(input, p).confidence).toBe('possible');
  });
});
