import { ContentType, indexSearchParameterBundle, indexStructureDefinitionBundle } from '@medplum/core';
import { SEARCH_PARAMETER_BUNDLE_FILES, readJson } from '@medplum/definitions';
import type { Bundle, Parameters, Patient, SearchParameter } from '@medplum/fhirtypes';
import { MockClient } from '@medplum/mock';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { handler } from './golden-record-mdm';

function P(parts: Parameters['parameter']): Parameters { return { resourceType: 'Parameters', parameter: parts }; }

describe('dispatcher', () => {
  let medplum: MockClient;
  const bot = { reference: 'Bot/123' };
  const secrets = {};
  beforeAll(() => {
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-types.json') as Bundle);
    indexStructureDefinitionBundle(readJson('fhir/r4/profiles-resources.json') as Bundle);
    for (const f of SEARCH_PARAMETER_BUNDLE_FILES) indexSearchParameterBundle(readJson(f) as Bundle<SearchParameter>);
  });
  beforeEach(() => { medplum = new MockClient(); });

  async function run(input: Parameters): Promise<any> {
    return handler(medplum, { bot, input, contentType: ContentType.FHIR_JSON, secrets });
  }

  test('unknown operation → throws/errors', async () => {
    await expect(run(P([{ name: 'operation', valueString: 'bogus' }]))).rejects.toThrow();
  });

  test('missing required param (create-link without ids) → throws', async () => {
    await expect(run(P([{ name: 'operation', valueString: 'create-link' }]))).rejects.toThrow();
  });

  test('link operation routes to runLink', async () => {
    await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' });
    const inc = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'Garcia', given: ['Maria'] }], birthDate: '1985-03-12' });
    const out: Parameters = await run(P([
      { name: 'operation', valueString: 'link' },
      { name: 'resource', resource: inc },
    ]));
    expect(out.resourceType).toBe('Parameters');
    expect(out.parameter?.some((p) => p.name === 'action')).toBe(true);
  });

  test('find-duplicates operation routes', async () => {
    const out: Parameters = await run(P([{ name: 'operation', valueString: 'find-duplicates' }]));
    expect(out.resourceType).toBe('Parameters');
  });

  test('query-links routes (no params lists all)', async () => {
    const out: Parameters = await run(P([{ name: 'operation', valueString: 'query-links' }]));
    expect(out.resourceType).toBe('Parameters');
  });

  test('create-link routes (happy path)', async () => {
    const golden = await medplum.createResource<Patient>({ resourceType: 'Patient', meta: { tag: [{ system: 'http://hapifhir.io/fhir/NamingSystem/mdm-record-status', code: 'GOLDEN_RECORD' }] }, identifier: [{ system: 'https://calmhsa-works.dev/mdm-eid', value: 'e1' }], name: [{ family: 'A' }] });
    const src = await medplum.createResource<Patient>({ resourceType: 'Patient', name: [{ family: 'A' }] });
    const out: Parameters = await run(P([
      { name: 'operation', valueString: 'create-link' },
      { name: 'goldenResourceId', valueString: `Patient/${golden.id}` },
      { name: 'resourceId', valueString: `Patient/${src.id}` },
    ]));
    expect(out.parameter?.find((p) => p.name === 'outcome')?.valueString).toBe('linked');
  });

  test('update-link routes (propose-only)', async () => {
    const out: Parameters = await run(P([
      { name: 'operation', valueString: 'update-link' },
      { name: 'goldenResourceId', valueString: 'Patient/g1' },
      { name: 'resourceId', valueString: 'Patient/s1' },
      { name: 'matchResult', valueString: 'NO_MATCH' },
    ]));
    expect(out.parameter?.find((p) => p.name === 'proposed')?.valueBoolean).toBe(true);
  });

  test('merge routes (propose-only)', async () => {
    const out: Parameters = await run(P([
      { name: 'operation', valueString: 'merge' },
      { name: 'sourceGolden', valueString: 'Patient/g1' },
      { name: 'targetGolden', valueString: 'Patient/g2' },
    ]));
    expect(out.parameter?.find((p) => p.name === 'proposed')?.valueBoolean).toBe(true);
  });

  test('not-duplicate routes', async () => {
    const out: Parameters = await run(P([
      { name: 'operation', valueString: 'not-duplicate' },
      { name: 'goldenA', valueString: 'Patient/g1' },
      { name: 'goldenB', valueString: 'Patient/g2' },
    ]));
    expect(out.parameter?.find((p) => p.name === 'outcome')?.valueString).toBe('marked-distinct');
  });
});
