// SPDX-License-Identifier: Apache-2.0
// $client-search — partial-demographics Patient search with match-confidence.
// Spec §4 ($client-search). AC #12.

import { allOk, Operator } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { Bundle, Parameters, Patient } from '@medplum/fhirtypes';
import { getAuthenticatedContext } from '../../context';
import { RFS_CS, RFS_DRAFT_TAG } from '../codesystems';
import { scoreMatch, type SearchInput } from '../match';

const MATCH_CONF_EXT = 'https://calmhsa.org/fhir/StructureDefinition/match-confidence';

function paramValue(params: Parameters | undefined, name: string): string | undefined {
  const p = params?.parameter?.find((x) => x.name === name);
  return p?.valueString ?? p?.valueDate;
}

export async function clientSearchHandler(req: FhirRequest): Promise<FhirResponse> {
  const { repo } = getAuthenticatedContext();
  const params = req.body as Parameters | undefined;
  const input: SearchInput = {
    firstName: paramValue(params, 'firstName'),
    lastName: paramValue(params, 'lastName'),
    dob: paramValue(params, 'dob'),
    ssnLast4: paramValue(params, 'ssnLast4'),
    phone: paramValue(params, 'phone'),
  };

  // Build candidate search: use lastName + dob if available, else lastName only,
  // else dob only. If neither, return empty bundle.
  const filters = [];
  if (input.lastName) {
    filters.push({ code: 'family', operator: Operator.EQUALS, value: input.lastName });
  }
  if (input.dob) {
    filters.push({ code: 'birthdate', operator: Operator.EQUALS, value: input.dob });
  }
  if (filters.length === 0) {
    const empty: Bundle = { resourceType: 'Bundle', type: 'searchset', entry: [] };
    return [allOk, empty];
  }

  const bundle = await repo.search<Patient>({
    resourceType: 'Patient',
    filters,
    count: 50,
  });

  const matches = (bundle.entry ?? [])
    .map((e) => e.resource as Patient)
    .filter((p): p is Patient => Boolean(p))
    .filter(
      (p) =>
        !(p.meta?.tag ?? []).some((t) => t.system === RFS_CS.lifecycle && t.code === RFS_DRAFT_TAG)
    )
    .map((p) => scoreMatch(input, p))
    .filter((m) => m.confidence !== 'none')
    .sort((a, b) => b.score - a.score);

  const output: Bundle = {
    resourceType: 'Bundle',
    type: 'searchset',
    total: matches.length,
    entry: matches.map((m) => ({
      resource: m.patient,
      search: { mode: 'match', score: m.score / 4 },
      extension: [{ url: MATCH_CONF_EXT, valueCode: m.confidence }],
    })),
  };

  return [allOk, output];
}
