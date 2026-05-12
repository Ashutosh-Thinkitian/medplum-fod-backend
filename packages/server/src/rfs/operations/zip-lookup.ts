// SPDX-License-Identifier: Apache-2.0
// $zip-lookup — California-only ZIP → {city, state, county}. Spec §4. AC #7.

import { allOk, notFound } from '@medplum/core';
import type { FhirRequest, FhirResponse } from '@medplum/fhir-router';
import type { Parameters } from '@medplum/fhirtypes';
import caZip from '../data/ca-zip.json';

type ZipEntry = { city: string; county: string };
const TABLE = caZip as Record<string, ZipEntry>;

export async function zipLookupHandler(req: FhirRequest): Promise<FhirResponse> {
  const zipParam = (req.query as Record<string, string | undefined> | undefined)?.zip;
  const zip = zipParam?.trim();
  if (!zip || !/^\d{5}$/.test(zip)) {
    return [notFound];
  }
  const entry = TABLE[zip];
  if (!entry) {
    return [notFound];
  }

  const out: Parameters = {
    resourceType: 'Parameters',
    parameter: [
      { name: 'city', valueString: entry.city },
      { name: 'state', valueCode: 'CA' },
      { name: 'county', valueString: entry.county },
    ],
  };
  return [allOk, out];
}
