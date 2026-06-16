// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Basic, Parameters, ParametersParameter } from '@medplum/fhirtypes';
import { MDM } from '../constants';

function extStr(b: Basic, url: string): string | undefined {
  const e = (b.extension ?? []).find((x) => x.url === url);
  return e?.valueString ?? e?.valueReference?.reference ?? (e?.valueDecimal !== undefined ? String(e.valueDecimal) : undefined);
}

/** List source↔golden links (reads the link Basics). Filter by golden or by source. */
export async function runQueryLinks(
  medplum: MedplumClient,
  goldenResourceId: string | undefined,
  resourceId: string | undefined
): Promise<Parameters> {
  const basics = await medplum.searchResources('Basic', {
    code: `${MDM.basicSystem}|${MDM.linkBasicCode}`,
    _count: '200',
  });
  const matches = basics.filter((b) => {
    const g = extStr(b, MDM.ext.golden);
    const s = extStr(b, MDM.ext.source);
    if (goldenResourceId) return g === goldenResourceId;
    if (resourceId) return s === resourceId;
    return true;
  });
  const parameter: ParametersParameter[] = matches.map((b) => ({
    name: 'link',
    part: [
      { name: 'goldenResourceId', valueString: extStr(b, MDM.ext.golden) },
      { name: 'sourceResourceId', valueString: extStr(b, MDM.ext.source) },
      { name: 'matchResult', valueString: extStr(b, MDM.ext.matchResult) },
      { name: 'linkSource', valueString: extStr(b, MDM.ext.linkSource) },
      { name: 'score', valueString: extStr(b, MDM.ext.score) },
    ],
  }));
  return { resourceType: 'Parameters', parameter };
}
