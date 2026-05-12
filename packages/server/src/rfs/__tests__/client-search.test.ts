// SPDX-License-Identifier: Apache-2.0
import { ContentType } from '@medplum/core';
import type { Bundle, Parameters } from '@medplum/fhirtypes';
import express from 'express';
import request from 'supertest';
import { initApp, shutdownApp } from '../../app';
import { loadTestConfig } from '../../config/loader';
import { initTestAuth } from '../../test.setup';

describe('$client-search', () => {
  const app = express();
  let accessToken: string;

  beforeAll(async () => {
    const config = await loadTestConfig();
    await initApp(app, config);
    accessToken = await initTestAuth();
  });

  afterAll(async () => {
    await shutdownApp();
  });

  test('returns a Bundle with match-confidence on each entry', async () => {
    await request(app)
      .post('/fhir/R4/Patient')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({
        resourceType: 'Patient',
        active: true,
        name: [{ family: 'Targetfam', given: ['Targetgiven'] }],
        birthDate: '1990-05-12',
      });
    const res = await request(app)
      .post('/fhir/R4/$client-search')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({
        resourceType: 'Parameters',
        parameter: [
          { name: 'lastName', valueString: 'Targetfam' },
          { name: 'dob', valueDate: '1990-05-12' },
        ],
      } as Parameters);

    expect(res.status).toBe(200);
    const bundle = res.body as Bundle;
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.entry?.length).toBeGreaterThanOrEqual(1);
    const entry = bundle.entry?.[0];
    const confExt = entry?.extension?.find(
      (e) => e.url === 'https://calmhsa.org/fhir/StructureDefinition/match-confidence'
    );
    expect(confExt?.valueCode).toBeTruthy();
  });

  test('excludes Patients tagged rfs-draft from results', async () => {
    // Seed a stub-tagged Patient via the create-draft operation
    const draftRes = await request(app)
      .post('/fhir/R4/$rfs-create-draft')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({ resourceType: 'Parameters', parameter: [] });
    const stubPatRef = draftRes.body.parameter.find(
      (p: { name: string; valueReference: { reference: string } }) => p.name === 'patient'
    ).valueReference.reference;
    const stubPatId = stubPatRef.split('/')[1];

    // PATCH the stub with a name we will then search for
    await request(app)
      .patch(`/fhir/R4/Patient/${stubPatId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', 'application/json-patch+json')
      .send([{ op: 'replace', path: '/name', value: [{ family: 'Stubfam' }] }]);

    const res = await request(app)
      .post('/fhir/R4/$client-search')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({
        resourceType: 'Parameters',
        parameter: [{ name: 'lastName', valueString: 'Stubfam' }],
      });
    expect(res.status).toBe(200);
    const bundle = res.body as Bundle;
    const ids = (bundle.entry ?? []).map((e) => e.resource?.id);
    expect(ids).not.toContain(stubPatId);
  });
});
