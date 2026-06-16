import { indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { SEARCH_PARAMETER_BUNDLE_FILES, readJson } from '@medplum/definitions';
import type { Bundle, Patient, SearchParameter, Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { MDM } from '../constants';
import { createGolden, linkSourceToGolden } from '../golden';
import { runUpdateLink } from './update-link';
import { runMerge } from './merge';
import { runNotDuplicate, findDuplicateMarkers } from './not-duplicate';

describe('propose-only ops + not-duplicate', () => {
  let medplum: MockClient;
  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    for (const f of SEARCH_PARAMETER_BUNDLE_FILES) indexSearchParameterBundle(readJson(f) as Bundle<SearchParameter>);
  });
  beforeEach(() => { medplum = new MockClient(); });

  test('update-link is propose-only: creates Task, mutates nothing', async () => {
    const golden = await createGolden(medplum, { name: [{ family: 'A' }] }, 'e1');
    const src = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'A' }] });
    const out = await runUpdateLink(medplum, `Patient/${golden.id}`, `Patient/${src.id}`, 'NO_MATCH');
    expect(out.parameter?.find((p) => p.name === 'proposed')?.valueBoolean).toBe(true);
    const tasks = await medplum.searchResources('Task', { code: 'https://calmhsa-works.dev/mdm|mdm-update-link' });
    expect(tasks.length).toBe(1);
    const reread = await medplum.readResource('Patient', src.id as string);
    expect(reread.link ?? []).toHaveLength(0);
  });

  test('merge is propose-only: creates Task, both goldens unchanged', async () => {
    const g1 = await createGolden(medplum, { name: [{ family: 'A' }] }, 'e2');
    const g2 = await createGolden(medplum, { name: [{ family: 'A' }] }, 'e3');
    const out = await runMerge(medplum, `Patient/${g1.id}`, `Patient/${g2.id}`);
    expect(out.parameter?.find((p) => p.name === 'proposed')?.valueBoolean).toBe(true);
    const tasks = await medplum.searchResources('Task', { code: 'https://calmhsa-works.dev/mdm|mdm-merge' });
    expect(tasks.length).toBe(1);
    expect((await medplum.readResource('Patient', g1.id as string)).id).toBe(g1.id);
    expect((await medplum.readResource('Patient', g2.id as string)).id).toBe(g2.id);
  });

  test('not-duplicate writes a marker findable by findDuplicateMarkers', async () => {
    const g1 = await createGolden(medplum, { name: [{ family: 'A' }] }, 'e4');
    const g2 = await createGolden(medplum, { name: [{ family: 'B' }] }, 'e5');
    await runNotDuplicate(medplum, `Patient/${g1.id}`, `Patient/${g2.id}`);
    const markers = await findDuplicateMarkers(medplum);
    expect(markers.some((m) => m.has(`Patient/${g1.id}`) && m.has(`Patient/${g2.id}`))).toBe(true);
  });

  test('re-linking same source→golden does not duplicate the link Basic', async () => {
    const golden = await createGolden(medplum, { name: [{ family: 'Dup' }] }, 'edup');
    let src: Patient = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Dup' }] });
    src = await linkSourceToGolden(medplum, src, golden, 'AUTO', 'MATCH', 0.9);
    src = await linkSourceToGolden(medplum, src, golden, 'AUTO', 'MATCH', 0.95);
    const basics = await medplum.searchResources('Basic', {
      code: `${MDM.basicSystem}|${MDM.linkBasicCode}`,
    });
    const forPair = basics.filter((b) =>
      (b.extension ?? []).some(
        (e) => e.url === MDM.ext.source && e.valueReference?.reference === `Patient/${src.id}`
      )
    );
    expect(forPair.length).toBe(1);
  });
});
