// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Basic, Parameters } from '@medplum/fhirtypes';
import { MDM } from '../constants';

/** Mark two goldens as genuinely distinct (so find-duplicates skips the pair). */
export async function runNotDuplicate(
  medplum: MedplumClient,
  goldenA: string,
  goldenB: string
): Promise<Parameters> {
  if (goldenA === goldenB) {
    throw new Error('not-duplicate requires two DIFFERENT golden records (goldenA === goldenB)');
  }
  const marker: Basic = {
    resourceType: 'Basic',
    code: { coding: [{ system: MDM.basicSystem, code: MDM.notDuplicateBasicCode }] },
    extension: [
      { url: `${MDM.linkExtensionBase}#goldenA`, valueReference: { reference: goldenA } },
      { url: `${MDM.linkExtensionBase}#goldenB`, valueReference: { reference: goldenB } },
    ],
  };
  const saved = await medplum.createResource(marker);
  return {
    resourceType: 'Parameters',
    parameter: [
      { name: 'outcome', valueString: 'marked-distinct' },
      { name: 'markerId', valueString: `Basic/${saved.id}` },
    ],
  };
}

/** Return the set of {goldenA, goldenB} pairs marked not-duplicate. */
export async function findDuplicateMarkers(medplum: MedplumClient): Promise<Set<string>[]> {
  const markers = await medplum.searchResources('Basic', {
    code: `${MDM.basicSystem}|${MDM.notDuplicateBasicCode}`,
    _count: '200',
  });
  return markers.map((m) => {
    const refs = (m.extension ?? []).map((e) => e.valueReference?.reference).filter(Boolean) as string[];
    return new Set(refs);
  });
}
