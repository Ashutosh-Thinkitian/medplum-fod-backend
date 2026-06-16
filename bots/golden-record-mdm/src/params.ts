// SPDX-License-Identifier: Apache-2.0
import type { Parameters, Patient } from '@medplum/fhirtypes';
import { DEFAULT_THRESHOLDS, type Thresholds } from './scoring';

export function getOperation(input: Parameters): string | undefined {
  return getStringParam(input, 'operation');
}
export function getStringParam(input: Parameters, name: string): string | undefined {
  return input.parameter?.find((p) => p.name === name)?.valueString;
}
export function getIntParam(input: Parameters, name: string): number | undefined {
  return input.parameter?.find((p) => p.name === name)?.valueInteger;
}
export function getPatientParam(input: Parameters, name: string): Patient | undefined {
  const r = input.parameter?.find((p) => p.name === name)?.resource;
  return r && r.resourceType === 'Patient' ? (r as Patient) : undefined;
}
export function getSorPriority(secrets: Record<string, { name: string; valueString?: string }>): string[] {
  const raw = secrets?.['SOR_PRIORITY']?.valueString;
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
}
export function getThresholdsFromSecrets(
  secrets: Record<string, { name: string; valueString?: string }>
): Thresholds {
  const num = (k: string, d: number): number => {
    const v = secrets?.[k]?.valueString;
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : d;
  };
  const t = {
    certain: num('CERTAIN', DEFAULT_THRESHOLDS.certain),
    probable: num('PROBABLE', DEFAULT_THRESHOLDS.probable),
    possible: num('POSSIBLE', DEFAULT_THRESHOLDS.possible),
  };
  const valid = t.certain > t.probable && t.probable > t.possible && t.possible > 0 && t.certain <= 1;
  return valid ? t : DEFAULT_THRESHOLDS;
}
