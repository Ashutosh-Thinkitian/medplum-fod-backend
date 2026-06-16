// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Parameters, Patient } from '@medplum/fhirtypes';
import { findSourcesForGolden, isGolden, linkSourceToGolden, updateGoldenDemographics } from '../golden';
import { writeLinkAuditEvent } from '../audit';
import { computeSurvivorship } from '../survivorship';

/** Manually link a source to a golden (MANUAL), recompute survivorship, audit. */
export async function runCreateLink(
  medplum: MedplumClient,
  goldenResourceId: string,
  resourceId: string,
  sorPriority: string[] = []
): Promise<Parameters> {
  const golden = await medplum.readResource('Patient', goldenResourceId.split('/')[1]);
  if (!isGolden(golden)) {
    throw new Error(`${goldenResourceId} is not a GOLDEN_RECORD`);
  }
  const source = await medplum.readResource('Patient', resourceId.split('/')[1]);
  await linkSourceToGolden(medplum, source, golden, 'MANUAL', 'MATCH', 1);
  await writeLinkAuditEvent(medplum, 'mdm-create-link', golden, source);
  const sources = await findSourcesForGolden(medplum, golden.id as string);
  await updateGoldenDemographics(medplum, golden, computeSurvivorship(sources, sorPriority));
  return {
    resourceType: 'Parameters',
    parameter: [
      { name: 'outcome', valueString: 'linked' },
      { name: 'goldenResourceId', valueString: goldenResourceId },
      { name: 'sourceResourceId', valueString: resourceId },
      { name: 'linkSource', valueString: 'MANUAL' },
    ],
  };
}
