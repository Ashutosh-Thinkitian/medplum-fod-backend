// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Parameters, Task } from '@medplum/fhirtypes';
import { MDM } from '../constants';

/** PROPOSE-ONLY: create a Task proposing a golden-record merge. Does NOT merge. */
export async function runMerge(
  medplum: MedplumClient,
  sourceGolden: string,
  targetGolden: string
): Promise<Parameters> {
  if (sourceGolden === targetGolden) {
    throw new Error('merge requires two DIFFERENT golden records (sourceGolden === targetGolden)');
  }
  const task: Task = {
    resourceType: 'Task',
    status: 'requested',
    intent: 'order',
    code: { coding: [{ system: MDM.basicSystem, code: MDM.mergeTaskCode }] },
    description: `Propose merge of golden ${sourceGolden} into ${targetGolden}.`,
    input: [
      { type: { text: 'sourceGolden' }, valueString: sourceGolden },
      { type: { text: 'targetGolden' }, valueString: targetGolden },
    ],
  };
  const saved = await medplum.createResource(task);
  return {
    resourceType: 'Parameters',
    parameter: [
      { name: 'proposed', valueBoolean: true },
      { name: 'taskId', valueString: `Task/${saved.id}` },
      { name: 'note', valueString: 'Golden merge proposed for human approval; nothing merged.' },
    ],
  };
}
