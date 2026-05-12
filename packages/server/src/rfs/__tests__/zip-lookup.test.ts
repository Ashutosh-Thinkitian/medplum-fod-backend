// SPDX-License-Identifier: Apache-2.0
import express from 'express';
import request from 'supertest';
import { initApp, shutdownApp } from '../../app';
import { loadTestConfig } from '../../config/loader';
import { initTestAuth } from '../../test.setup';

describe('$zip-lookup', () => {
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

  test('known CA zip returns Parameters with city/state/county', async () => {
    const res = await request(app)
      .get('/fhir/R4/$zip-lookup?zip=95112')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const params = res.body;
    const state = params.parameter.find((p: { name: string; valueCode?: string }) => p.name === 'state');
    const city = params.parameter.find((p: { name: string; valueString?: string }) => p.name === 'city');
    expect(state.valueCode).toBe('CA');
    expect(city.valueString).toBe('San Jose');
  });

  test('unknown zip returns 404 OperationOutcome', async () => {
    const res = await request(app)
      .get('/fhir/R4/$zip-lookup?zip=99999')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
  });

  test('malformed zip returns 404 OperationOutcome', async () => {
    const res = await request(app)
      .get('/fhir/R4/$zip-lookup?zip=abc')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(404);
  });
});
