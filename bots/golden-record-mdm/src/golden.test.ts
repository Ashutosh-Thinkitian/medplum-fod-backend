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
    let src: Patient = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Garcia' }] });
    src = await linkSourceToGolden(medplum, src, g, 'AUTO', 'MATCH', 0.95);
    expect(src.link?.some((l) => l.type === 'seealso' && l.other.reference === `Patient/${g.id}`)).toBe(true);
    const found = await findGoldenForSource(medplum, src);
    expect(found?.id).toBe(g.id);
  });
});
