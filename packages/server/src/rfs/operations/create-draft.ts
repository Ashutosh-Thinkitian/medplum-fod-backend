// SPDX-License-Identifier: Apache-2.0
// $rfs-create-draft — creates a draft ServiceRequest + stub Patient at contact moment.
// Spec §3.1, §3.6, §4. AC #1, #2, #17, #18.

import { allOk, createReference } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { Parameters, ServiceRequest } from '@medplum/fhirtypes';
import { getAuthenticatedContext } from '../../context';
import { RFS_CATEGORY_CODE, RFS_CS } from '../codesystems';
import { createStubPatient } from '../stub';

export async function rfsCreateDraftHandler(_req: FhirRequest): Promise<FhirResponse> {
  const ctx = getAuthenticatedContext();
  const { repo, profile } = ctx;

  const stub = await createStubPatient(repo);

  const now = new Date().toISOString();
  const sr = await repo.createResource<ServiceRequest>({
    resourceType: 'ServiceRequest',
    status: 'draft',
    intent: 'order',
    subject: createReference(stub),
    requester: profile ? createReference(profile) : undefined,
    occurrenceDateTime: now,
    category: [
      {
        coding: [
          {
            system: RFS_CS.serviceRequestCategory,
            code: RFS_CATEGORY_CODE,
            display: 'Request for Services',
          },
        ],
      },
    ],
  });

  const output: Parameters = {
    resourceType: 'Parameters',
    parameter: [
      { name: 'serviceRequest', valueReference: createReference(sr) },
      { name: 'patient', valueReference: createReference(stub) },
    ],
  };
  return [allOk, output];
}
