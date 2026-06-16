// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Parameters, ParametersParameter } from '@medplum/fhirtypes';
import { findAllGoldens } from '../golden';
import { classifyGrade, scoreCandidate, type Thresholds } from '../scoring';
import { findDuplicateMarkers } from './not-duplicate';

/** Scan goldens, score pairs, return possible-duplicate pairs (excludes not-duplicate-marked). No merge. */
export async function runFindDuplicates(
  medplum: MedplumClient,
  thresholds: Thresholds,
  maxCount: number
): Promise<Parameters> {
  const goldens = await findAllGoldens(medplum);
  const markers = await findDuplicateMarkers(medplum);
  const isMarked = (a: string, b: string): boolean => markers.some((m) => m.has(a) && m.has(b));

  // O(n²) over goldens, capped by findAllGoldens _count:'100' — suitable for dev/eval,
  // not a bulk production engine. Replace with a pre-filter index for large deployments.
  const parameter: ParametersParameter[] = [];
  for (let i = 0; i < goldens.length; i++) {
    for (let j = i + 1; j < goldens.length; j++) {
      const a = goldens[i];
      const b = goldens[j];
      const refA = `Patient/${a.id}`;
      const refB = `Patient/${b.id}`;
      if (isMarked(refA, refB)) continue;
      const { score } = scoreCandidate(a, b);
      const grade = classifyGrade(score, thresholds);
      if (grade === 'possible' || grade === 'probable' || grade === 'certain') {
        parameter.push({
          name: 'duplicatePair',
          part: [
            { name: 'goldenA', valueString: refA },
            { name: 'goldenB', valueString: refB },
            { name: 'score', valueString: String(score) },
            { name: 'grade', valueString: grade },
          ],
        });
        if (parameter.length >= maxCount) return { resourceType: 'Parameters', parameter };
      }
    }
  }
  return { resourceType: 'Parameters', parameter };
}
