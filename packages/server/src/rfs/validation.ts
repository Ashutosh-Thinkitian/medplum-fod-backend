// SPDX-License-Identifier: Apache-2.0
// Save-&-Complete validation. Spec §10. AC #14.

import type { Patient, ServiceRequest } from '@medplum/fhirtypes';
import { PATIENT_EXT, RFS_EXT } from './extensions';
import { SSN_SYSTEM } from './codesystems';

export interface ValidationResult {
  ok: boolean;
  issues: string[];
}

interface MaybeExtended {
  extension?: { url: string; valueBoolean?: boolean }[];
}

function hasExt(target: MaybeExtended | undefined, url: string, value?: boolean): boolean {
  if (!target?.extension) return false;
  const e = target.extension.find((x) => x.url === url);
  if (!e) return false;
  if (value === undefined) return true;
  return e.valueBoolean === value;
}

function hasExtAny(target: { extension?: { url: string }[] } | undefined, url: string): boolean {
  return Boolean(target?.extension?.some((x) => x.url === url));
}

export function validateForComplete(sr: ServiceRequest, patient: Patient): ValidationResult {
  const issues: string[] = [];

  // ServiceRequest side
  if (!sr.performer?.length) issues.push('performer');
  if (!sr.priority) issues.push('priority');
  if (!sr.reasonCode?.length) issues.push('reasonCode');
  if (!sr.note?.[0]?.text) issues.push('note');
  if (!hasExtAny(sr, RFS_EXT.requestMethod)) issues.push('extension:request-method');
  if (!hasExtAny(sr, RFS_EXT.languageUsed)) issues.push('extension:language-used');
  if (!hasExtAny(sr, RFS_EXT.interpreterUsed)) issues.push('extension:interpreter-used');

  // Patient side — must be a real, linked Patient (active=true)
  if (!patient.active) issues.push('patient.active=false');
  if (!patient.name?.[0]?.family) issues.push('patient.name.family');
  if (!patient.name?.[0]?.given?.[0]) issues.push('patient.name.given');
  const hasDob = Boolean(patient.birthDate);
  const dobUnknown = hasExt(patient, PATIENT_EXT.dobUnknown, true) && hasExtAny(patient, PATIENT_EXT.estimatedAge);
  if (!hasDob && !dobUnknown) issues.push('patient.birthDate-or-estimated-age');
  const hasSsn = (patient.identifier ?? []).some((i) => i.system === SSN_SYSTEM && i.value);
  const ssnUnknown = hasExt(patient, PATIENT_EXT.ssnUnknown, true);
  if (!hasSsn && !ssnUnknown) issues.push('patient.ssn-or-ssn-unknown');
  if (!patient.gender) issues.push('patient.gender');
  if (!patient.communication?.[0]?.language) issues.push('patient.communication.preferred-language');
  if (!patient.telecom?.length) issues.push('patient.telecom');
  const addr = patient.address?.[0];
  if (!addr) issues.push('patient.address');

  return { ok: issues.length === 0, issues };
}
