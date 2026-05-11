// SPDX-License-Identifier: Apache-2.0
// CalMHSA Request-for-Services extension URLs. Single source of truth.
// Spec §3.2.

const BASE = 'https://calmhsa.org/fhir/StructureDefinition';

export const RFS_EXT = {
  requestMethod: `${BASE}/rfs-request-method`,
  languageUsed: `${BASE}/rfs-language-used`,
  interpreterUsed: `${BASE}/rfs-interpreter-used`,
  recommendedBy: `${BASE}/rfs-recommended-by`,
  contactId: `${BASE}/rfs-contact-id`,
} as const;

export const PATIENT_EXT = {
  estimatedAge: `${BASE}/patient-estimated-age`,
  dobUnknown: `${BASE}/patient-dob-unknown`,
  ssnUnknown: `${BASE}/patient-ssn-unknown`,
  clientIsHomeless: `${BASE}/client-is-homeless`,
  preferredCommunication: `${BASE}/rfs-pref-comm`,
  // Use HL7 standard for pronouns
  pronouns: 'https://hl7.org/fhir/StructureDefinition/individual-pronouns',
} as const;

export const COVERAGE_EXT = {
  aidCode: `${BASE}/cov-aid-code`,
  shareOfCost: `${BASE}/cov-share-of-cost`,
  otherCoverage: `${BASE}/cov-other-coverage`,
} as const;
