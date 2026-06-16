import { indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { SEARCH_PARAMETER_BUNDLE_FILES, readJson } from '@medplum/definitions';
import type { Bundle, Patient, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { createGolden, linkSourceToGolden } from '../golden';
import { runQueryLinks } from './query-links';
import { runCreateLink } from './create-link';

describe('query-links + create-link', () => {
  let medplum: MockClient;
  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    for (const f of SEARCH_PARAMETER_BUNDLE_FILES) indexSearchParameterBundle(readJson(f) as Bundle<SearchParameter>);
  });
  beforeEach(() => { medplum = new MockClient(); });

  test('create-link writes MANUAL link + Basic; query-links returns it', async () => {
    const golden = await createGolden(medplum, { name: [{ family: 'Garcia' }] }, 'eid-q');
    const src = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Garcia' }] });

    const created = await runCreateLink(medplum, `Patient/${golden.id}`, `Patient/${src.id}`);
    expect(created.parameter?.find((p) => p.name === 'outcome')?.valueString).toBe('linked');

    const q = await runQueryLinks(medplum, `Patient/${golden.id}`, undefined);
    const links = (q.parameter ?? []).filter((p) => p.name === 'link');
    expect(links.length).toBe(1);
    const parts = links[0].part ?? [];
    const get = (n: string): string | undefined => parts.find((x) => x.name === n)?.valueString;
    expect(get('sourceResourceId')).toBe(`Patient/${src.id}`);
    expect(get('linkSource')).toBe('MANUAL');
  });

  test('query-links by goldenResourceId returns AUTO link created by helper', async () => {
    const golden = await createGolden(medplum, { name: [{ family: 'Lee' }] }, 'eid-q2');
    const src = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Lee' }] });
    await linkSourceToGolden(medplum, src, golden, 'AUTO', 'MATCH', 0.99);
    const q = await runQueryLinks(medplum, `Patient/${golden.id}`, undefined);
    expect((q.parameter ?? []).filter((p) => p.name === 'link').length).toBe(1);
  });
});
