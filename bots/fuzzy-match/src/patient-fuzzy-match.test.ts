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
    (e) => e.search?.extension?.find((x) => x.url === 'http://hl7.org/fhir/StructureDefinition/match-grade')?.valueCode ?? ''
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
      expect(e.search?.extension?.some((x) => x.url === 'http://hl7.org/fhir/StructureDefinition/match-grade')).toBe(true);
    }
  });

  test('count param caps results; onlyCertainMatches filters to certain', async () => {
    // add a second exact-DOB Garcia so two candidates exist
    await medplum.createResource<Patient>({
      resourceType: 'Patient',
      name: [{ family: 'Garcia', given: ['Maria'] }],
      birthDate: '1985-03-12',
    });
    const params: Parameters = {
      resourceType: 'Parameters',
      parameter: [
        { name: 'resource', resource: { resourceType: 'Patient', name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' } as Patient },
        { name: 'count', valueInteger: 1 },
      ],
    };
    const capped = (await handler(medplum, { bot, input: params, contentType: ContentType.FHIR_JSON, secrets })) as Bundle;
    expect(capped.entry?.length).toBe(1);

    const onlyCertainParams: Parameters = {
      resourceType: 'Parameters',
      parameter: [
        { name: 'resource', resource: { resourceType: 'Patient', name: [{ family: 'Garca', given: ['Maria'] }] } as Patient },
        { name: 'onlyCertainMatches', valueBoolean: true },
      ],
    };
    const onlyCertain = (await handler(medplum, { bot, input: onlyCertainParams, contentType: ContentType.FHIR_JSON, secrets })) as Bundle;
    // name-only Garca scores high (~0.94 certain) so it should still appear; assert all returned are 'certain'
    for (const e of onlyCertain.entry ?? []) {
      const g = e.search?.extension?.find((x) => x.url === 'http://hl7.org/fhir/StructureDefinition/match-grade')?.valueCode;
      expect(g).toBe('certain');
    }
  });
});
