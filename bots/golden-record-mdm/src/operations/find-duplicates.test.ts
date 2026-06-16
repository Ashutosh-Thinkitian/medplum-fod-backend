import { indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { SEARCH_PARAMETER_BUNDLE_FILES, readJson } from '@medplum/definitions';
import type { Bundle, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../scoring';
import { createGolden } from '../golden';
import { runNotDuplicate } from './not-duplicate';
import { runFindDuplicates } from './find-duplicates';

describe('find-duplicates', () => {
  let medplum: MockClient;
  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    for (const f of SEARCH_PARAMETER_BUNDLE_FILES) indexSearchParameterBundle(readJson(f) as Bundle<SearchParameter>);
  });
  beforeEach(() => { medplum = new MockClient(); });

  test('returns a duplicate pair of similar goldens; excludes not-duplicate-marked pairs', async () => {
    const g1 = await createGolden(medplum, { name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' }, 'eA');
    const g2 = await createGolden(medplum, { name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' }, 'eB');
    const g3 = await createGolden(medplum, { name: [{ family: 'Wilson', given: ['Bob'] }], birthDate: '1950-01-01' }, 'eC');

    let out = await runFindDuplicates(medplum, DEFAULT_THRESHOLDS, 100);
    let pairs = (out.parameter ?? []).filter((p) => p.name === 'duplicatePair');
    expect(pairs.length).toBeGreaterThanOrEqual(1); // g1/g2 dup; g3 not

    await runNotDuplicate(medplum, `Patient/${g1.id}`, `Patient/${g2.id}`);
    out = await runFindDuplicates(medplum, DEFAULT_THRESHOLDS, 100);
    pairs = (out.parameter ?? []).filter((p) => p.name === 'duplicatePair');
    const stillFlagged = pairs.some((p) => {
      const ids = (p.part ?? []).map((x) => x.valueString);
      return ids.includes(`Patient/${g1.id}`) && ids.includes(`Patient/${g2.id}`);
    });
    expect(stillFlagged).toBe(false);
  });
});
