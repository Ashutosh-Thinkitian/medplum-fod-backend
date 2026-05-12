// SPDX-License-Identifier: Apache-2.0
// Stub-Patient lifecycle helpers. Spec §3.6.

import type { WithId } from '@medplum/core';
import { OperationOutcomeError, badRequest } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import type { Repository } from '../fhir/repo';
import { RFS_CS, RFS_DRAFT_TAG } from './codesystems';

export const STUB_TAG_SYSTEM = RFS_CS.lifecycle;

export function isStubPatient(patient: Patient): boolean {
  return Boolean(
    patient.meta?.tag?.some((t) => t.system === STUB_TAG_SYSTEM && t.code === RFS_DRAFT_TAG)
  );
}

export async function createStubPatient(repo: Repository): Promise<WithId<Patient>> {
  return repo.createResource<Patient>({
    resourceType: 'Patient',
    active: false,
    name: [],
    meta: {
      tag: [{ system: STUB_TAG_SYSTEM, code: RFS_DRAFT_TAG, display: 'RFS draft stub' }],
    },
  });
}

export async function promoteStub(
  repo: Repository,
  stubId: string,
  patch: Partial<Patient>
): Promise<WithId<Patient>> {
  const stub = await repo.readResource<Patient>('Patient', stubId);
  if (!isStubPatient(stub)) {
    throw new OperationOutcomeError(badRequest(`Patient/${stubId} is not a stub`));
  }
  const remainingTags = (stub.meta?.tag ?? []).filter(
    (t) => !(t.system === STUB_TAG_SYSTEM && t.code === RFS_DRAFT_TAG)
  );
  const promoted: Patient = {
    ...stub,
    ...patch,
    active: true,
    meta: { ...stub.meta, tag: remainingTags.length ? remainingTags : undefined },
  };
  return repo.updateResource<Patient>(promoted);
}

export async function deleteStub(repo: Repository, stubId: string): Promise<void> {
  const stub = await repo.readResource<Patient>('Patient', stubId);
  if (!isStubPatient(stub)) {
    throw new OperationOutcomeError(badRequest(`Patient/${stubId} is not a stub`));
  }
  await repo.deleteResource('Patient', stubId);
}
