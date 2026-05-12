// SPDX-License-Identifier: Apache-2.0
// CalMHSA RFS code-system URLs and well-known codes. Spec §3.1, §3.6.

const CS_BASE = 'https://calmhsa.org/fhir/CodeSystem';

export const RFS_CS = {
  serviceRequestCategory: `${CS_BASE}/service-request-category`,
  requestMethod: `${CS_BASE}/rfs-request-method`,
  serviceType: `${CS_BASE}/rfs-service-type`,
  recommendedBy: `${CS_BASE}/rfs-recommended-by`,
  prefComm: `${CS_BASE}/rfs-pref-comm`,
  lifecycle: `${CS_BASE}/lifecycle`,
} as const;

export const RFS_CATEGORY_CODE = 'request-for-services';
export const RFS_DRAFT_TAG = 'rfs-draft';

export type RequestMethod = 'phone' | 'walk-in' | 'external-referral';
export type ServiceType = 'mental-health' | 'substance-use' | 'crisis' | 'psychiatric' | 'other';
export type PreferredCommunication = 'phone-call' | 'text' | 'email' | 'mail';

export const SSN_SYSTEM = 'http://hl7.org/fhir/sid/us-ssn';
