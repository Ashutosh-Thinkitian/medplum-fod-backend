// SPDX-License-Identifier: Apache-2.0
import type { BotEvent, MedplumClient } from '@medplum/core';
import type { Parameters } from '@medplum/fhirtypes';
import { getOperation, getPatientParam, getStringParam, getIntParam, getThresholdsFromSecrets, getSorPriority } from './params';
import { runLink } from './operations/link';
import { runQueryLinks } from './operations/query-links';
import { runCreateLink } from './operations/create-link';
import { runUpdateLink } from './operations/update-link';
import { runMerge } from './operations/merge';
import { runNotDuplicate } from './operations/not-duplicate';
import { runFindDuplicates } from './operations/find-duplicates';

function err(msg: string): never {
  throw new Error(msg);
}
function requireStr(input: Parameters, name: string): string {
  return getStringParam(input, name) ?? err(`Missing required parameter: ${name}`);
}

/**
 * Golden-Record MDM bot. Dispatches on the `operation` Parameters value.
 * Operations: link | query-links | create-link | update-link | merge | not-duplicate | find-duplicates
 */
export async function handler(medplum: MedplumClient, event: BotEvent<Parameters>): Promise<Parameters> {
  const input = event.input;
  const op = getOperation(input);
  const secrets = event.secrets as Record<string, { name: string; valueString?: string }>;
  const thresholds = getThresholdsFromSecrets(secrets);
  const sorPriority = getSorPriority(secrets);

  switch (op) {
    case 'link': {
      const resource = getPatientParam(input, 'resource') ?? err('Missing required parameter: resource (Patient)');
      const id = resource.id ?? err('resource.id is required — the Patient must be persisted before linking');
      const eid = `eid-${id}`;
      return runLink(medplum, resource, { thresholds, sorPriority, eid });
    }
    // query-links params are intentionally optional: omit both to list all links, or pass one to filter by golden or by source.
    case 'query-links':
      return runQueryLinks(medplum, getStringParam(input, 'goldenResourceId'), getStringParam(input, 'resourceId'));
    case 'create-link':
      return runCreateLink(medplum, requireStr(input, 'goldenResourceId'), requireStr(input, 'resourceId'), sorPriority);
    case 'update-link':
      return runUpdateLink(medplum, requireStr(input, 'goldenResourceId'), requireStr(input, 'resourceId'), requireStr(input, 'matchResult'));
    case 'merge':
      return runMerge(medplum, requireStr(input, 'sourceGolden'), requireStr(input, 'targetGolden'));
    case 'not-duplicate':
      return runNotDuplicate(medplum, requireStr(input, 'goldenA'), requireStr(input, 'goldenB'));
    case 'find-duplicates':
      return runFindDuplicates(medplum, thresholds, getIntParam(input, '_count') ?? 100);
    default:
      return err(`Unknown operation: ${op ?? '(none)'}. Expected one of: link, query-links, create-link, update-link, merge, not-duplicate, find-duplicates`);
  }
}
