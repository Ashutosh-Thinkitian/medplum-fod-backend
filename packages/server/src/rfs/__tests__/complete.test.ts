// SPDX-License-Identifier: Apache-2.0
import { ContentType } from '@medplum/core';
import type { Parameters } from '@medplum/fhirtypes';
import express from 'express';
import request from 'supertest';
import { initApp, shutdownApp } from '../../app';
import { loadTestConfig } from '../../config/loader';
import { initTestAuth } from '../../test.setup';

describe('$rfs-complete', () => {
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

  test('returns 400 OperationOutcome when required fields are missing', async () => {
    const draft = await request(app)
      .post('/fhir/R4/$rfs-create-draft')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({ resourceType: 'Parameters', parameter: [] });
    const srRef = draft.body.parameter.find((p: { name: string; valueReference: { reference: string } }) => p.name === 'serviceRequest').valueReference.reference;
    const res = await request(app)
      .post('/fhir/R4/$rfs-complete')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({
        resourceType: 'Parameters',
        parameter: [{ name: 'serviceRequest', valueReference: { reference: srRef } }],
      } as Parameters);
    expect(res.status).toBe(400);
    expect(res.body.resourceType).toBe('OperationOutcome');
    // Details should mention at least one missing field path
    const text = JSON.stringify(res.body);
    expect(text).toMatch(/performer|patient/);
  });

  test('transitions ServiceRequest.status to active and sets authoredOn', async () => {
    const real = await request(app)
      .post('/fhir/R4/Patient')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({
        resourceType: 'Patient',
        active: true,
        name: [{ family: 'Patient', given: ['Test'] }],
        birthDate: '1990-05-12',
        gender: 'unknown',
        communication: [{ preferred: true, language: { coding: [{ system: 'urn:ietf:bcp:47', code: 'en' }] } }],
        telecom: [{ system: 'phone', value: '5555555555' }],
        address: [{ line: ['1 Test St'], city: 'San Jose', state: 'CA', postalCode: '95112' }],
        identifier: [{ system: 'http://hl7.org/fhir/sid/us-ssn', value: '123-45-6789' }],
      });
    const hs = await request(app)
      .post('/fhir/R4/HealthcareService')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({ resourceType: 'HealthcareService', active: true, name: 'Test Program' });
    const sr = await request(app)
      .post('/fhir/R4/ServiceRequest')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({
        resourceType: 'ServiceRequest',
        status: 'draft',
        intent: 'order',
        subject: { reference: `Patient/${real.body.id}` },
        performer: [{ reference: `HealthcareService/${hs.body.id}` }],
        priority: 'routine',
        category: [{ coding: [{ system: 'https://calmhsa.org/fhir/CodeSystem/service-request-category', code: 'request-for-services' }] }],
        reasonCode: [{ coding: [{ system: 'https://calmhsa.org/fhir/CodeSystem/rfs-service-type', code: 'mental-health' }] }],
        note: [{ text: 'Needs services' }],
        occurrenceDateTime: new Date().toISOString(),
        extension: [
          { url: 'https://calmhsa.org/fhir/StructureDefinition/rfs-request-method', valueCode: 'phone' },
          { url: 'https://calmhsa.org/fhir/StructureDefinition/rfs-language-used', valueCodeableConcept: { coding: [{ system: 'urn:ietf:bcp:47', code: 'en' }] } },
          { url: 'https://calmhsa.org/fhir/StructureDefinition/rfs-interpreter-used', extension: [{ url: 'used', valueBoolean: false }] },
        ],
      });

    const res = await request(app)
      .post('/fhir/R4/$rfs-complete')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Content-Type', ContentType.FHIR_JSON)
      .send({
        resourceType: 'Parameters',
        parameter: [{ name: 'serviceRequest', valueReference: { reference: `ServiceRequest/${sr.body.id}` } }],
      });
    expect(res.status).toBe(200);
    const after = await request(app)
      .get(`/fhir/R4/ServiceRequest/${sr.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(after.body.status).toBe('active');
    expect(after.body.authoredOn).toBeTruthy();
  });
});
