// SPDX-License-Identifier: Apache-2.0
import type { Parameters } from '@medplum/fhirtypes';
import { ContentType } from '@medplum/core';
import express from 'express';
import request from 'supertest';
import { initApp, shutdownApp } from '../../app';
import { loadTestConfig } from '../../config/loader';
import { initTestAuth } from '../../test.setup';
import { RFS_CATEGORY_CODE, RFS_CS } from '../codesystems';

describe('$rfs-create-draft', () => {
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

  test('creates draft ServiceRequest + stub Patient and returns both refs', async () => {
    const res = await request(app)
      .post('/fhir/R4/$rfs-create-draft')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({ resourceType: 'Parameters', parameter: [] } as Parameters);

    expect(res.status).toBe(200);
    const out = res.body as Parameters;
    const srRef = out.parameter?.find((p) => p.name === 'serviceRequest')?.valueReference?.reference;
    const patRef = out.parameter?.find((p) => p.name === 'patient')?.valueReference?.reference;
    expect(srRef).toMatch(/^ServiceRequest\//);
    expect(patRef).toMatch(/^Patient\//);
  });

  test('ServiceRequest has status=draft, category=request-for-services, occurrenceDateTime set', async () => {
    const res = await request(app)
      .post('/fhir/R4/$rfs-create-draft')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({ resourceType: 'Parameters', parameter: [] } as Parameters);
    const out = res.body as Parameters;
    const srRef = out.parameter?.find((p) => p.name === 'serviceRequest')?.valueReference?.reference;
    const sr = await request(app)
      .get(`/fhir/R4/${srRef}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(sr.body.status).toBe('draft');
    expect(sr.body.intent).toBe('order');
    expect(sr.body.occurrenceDateTime).toBeTruthy();
    const cat = sr.body.category?.[0]?.coding?.[0];
    expect(cat?.system).toBe(RFS_CS.serviceRequestCategory);
    expect(cat?.code).toBe(RFS_CATEGORY_CODE);
  });
});
