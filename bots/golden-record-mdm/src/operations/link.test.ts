import { indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { SEARCH_PARAMETER_BUNDLE_FILES, readJson } from '@medplum/definitions';
import type { Bundle, Parameters, Patient, RiskAssessment, SearchParameter, Task } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_THRESHOLDS } from '../scoring';
import { isGolden } from '../golden';
import { runLink } from './link';

function paramStr(p: Parameters, name: string): string | undefined {
  return p.parameter?.find((x) => x.name === name)?.valueString;
}

describe('link operation', () => {
  let medplum: MockClient;
  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    for (const f of SEARCH_PARAMETER_BUNDLE_FILES) indexSearchParameterBundle(readJson(f) as Bundle<SearchParameter>);
  });
  beforeEach(async () => {
    medplum = new MockClient();
    await medplum.createResource<Patient>({
      resourceType: 'Patient', name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12', gender: 'female',
    });
  });

  const opts = { thresholds: DEFAULT_THRESHOLDS, sorPriority: [], eid: 'eid-test' };

  test('MATCH → creates golden + links source; action=linked', async () => {
    const incoming: Patient = { resourceType: 'Patient', id: 'inc1', name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' };
    const saved = await medplum.createResource(incoming);
    const out = await runLink(medplum, saved, opts);
    expect(paramStr(out, 'action')).toBe('linked');
    const goldenRef = paramStr(out, 'goldenRecord');
    expect(goldenRef).toBeDefined();
    const golden = await medplum.readReference<Patient>({ reference: goldenRef! });
    expect(isGolden(golden)).toBe(true);
  });

  test('near-miss (review band) → review queue (RiskAssessment + Task), NOT linked', async () => {
    // shares family + DOB with the seed but different given → should land in probable/possible (review), not certain
    const incoming = await medplum.createResource<Patient>({
      resourceType: 'Patient', name: [{ family: 'Garcia', given: ['Roberto'] }], birthDate: '1985-03-12',
    });
    const out = await runLink(medplum, incoming, opts);
    const action = paramStr(out, 'action');
    // It must NOT auto-link (only exact-enough certain matches auto-link) and must NOT be a no-match
    expect(action).toBe('review-queued');
    const tasks = await medplum.searchResources('Task', {});
    const ras = await medplum.searchResources('RiskAssessment', {});
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(ras.length).toBeGreaterThanOrEqual(1);
    // and no golden link was written on the incoming
    const reread = await medplum.readResource('Patient', incoming.id as string);
    expect(reread.link ?? []).toHaveLength(0);
  });

  test('garbage name → action=no-match, nothing created', async () => {
    const incoming = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Zzzzzz', given: ['Qqq'] }] });
    const out = await runLink(medplum, incoming, opts);
    expect(paramStr(out, 'action')).toBe('no-match');
  });

  test('second matching source attaches to SAME golden (idempotent — no 2nd golden)', async () => {
    const a = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' });
    await runLink(medplum, a, opts);
    const b = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' });
    await runLink(medplum, b, opts);
    const goldens = await medplum.searchResources('Patient', { _tag: 'http://hapifhir.io/fhir/NamingSystem/mdm-record-status|GOLDEN_RECORD' });
    expect(goldens.length).toBe(1);
  });
});
