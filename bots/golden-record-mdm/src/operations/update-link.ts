// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Parameters, Task } from '@medplum/fhirtypes';
import { MDM } from '../constants';

/** PROPOSE-ONLY: create a Task proposing a link re-grade. Does NOT change any link. */
export async function runUpdateLink(
  medplum: MedplumClient,
  goldenResourceId: string,
  resourceId: string,
  matchResult: string
): Promise<Parameters> {
  const task: Task = {
    resourceType: 'Task',
    status: 'requested',
    intent: 'order',
    code: { coding: [{ system: MDM.basicSystem, code: MDM.updateLinkTaskCode }] },
    description: `Propose re-grade link ${resourceId} -> ${goldenResourceId} to ${matchResult} (MANUAL).`,
    for: { reference: resourceId },
    input: [
      { type: { text: 'goldenResourceId' }, valueString: goldenResourceId },
      { type: { text: 'resourceId' }, valueString: resourceId },
      { type: { text: 'matchResult' }, valueString: matchResult },
    ],
  };
  const saved = await medplum.createResource(task);
  return {
    resourceType: 'Parameters',
    parameter: [
      { name: 'proposed', valueBoolean: true },
      { name: 'taskId', valueString: `Task/${saved.id}` },
      { name: 'note', valueString: 'Re-grade proposed for human approval; no link changed.' },
    ],
  };
}
