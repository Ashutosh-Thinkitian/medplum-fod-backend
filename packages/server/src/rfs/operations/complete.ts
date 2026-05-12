// SPDX-License-Identifier: Apache-2.0
// $rfs-complete — validates the draft and transitions status to active. Spec §10. AC #14.

import { allOk, badRequest } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { OperationOutcome, Parameters, Patient, ServiceRequest } from '@medplum/fhirtypes';
import { getAuthenticatedContext } from '../../context';
import { validateForComplete } from '../validation';

function refValue(params: Parameters, name: string): string | undefined {
  return params.parameter?.find((p) => p.name === name)?.valueReference?.reference;
}

function idFromRef(ref?: string): string | undefined {
  return ref?.split('/')[1];
}

export async function rfsCompleteHandler(req: FhirRequest): Promise<FhirResponse> {
  const { repo } = getAuthenticatedContext();
  const srRef = refValue(req.body as Parameters, 'serviceRequest');
  const srId = idFromRef(srRef);
  if (!srId) {
    return [badRequest('serviceRequest parameter is required')];
  }

  const sr = await repo.readResource<ServiceRequest>('ServiceRequest', srId);
  if (sr.status !== 'draft') {
    return [badRequest(`ServiceRequest/${srId} is not in draft status (current: ${sr.status})`)];
  }
  const subjectId = idFromRef(sr.subject?.reference);
  if (!subjectId) {
    return [badRequest('ServiceRequest has no subject')];
  }
  const patient = await repo.readResource<Patient>('Patient', subjectId);

  const result = validateForComplete(sr, patient);
  if (!result.ok) {
    const outcome: OperationOutcome = {
      resourceType: 'OperationOutcome',
      issue: result.issues.map((path) => ({
        severity: 'error',
        code: 'required',
        details: { text: `Required field missing: ${path}` },
      })),
    };
    return [outcome];
  }

  const updated = await repo.updateResource<ServiceRequest>({
    ...sr,
    status: 'active',
    authoredOn: new Date().toISOString(),
  });
  const output: Parameters = {
    resourceType: 'Parameters',
    parameter: [
      { name: 'serviceRequest', valueReference: { reference: `ServiceRequest/${updated.id}` } },
    ],
  };
  return [allOk, output];
}
