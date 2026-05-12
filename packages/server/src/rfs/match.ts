// SPDX-License-Identifier: Apache-2.0
// Client-search match-confidence scoring. Spec §4 ($client-search).
// Rules: 4+ strong-field matches => exact; 2-3 matches => possible; <2 => none.
// Strong fields = lastName, dob, ssnLast4, phone. firstName is weak (used for ranking).

import type { Patient } from '@medplum/fhirtypes';
import { SSN_SYSTEM } from './codesystems';

export interface SearchInput {
  firstName?: string;
  lastName?: string;
  dob?: string;
  ssnLast4?: string;
  phone?: string;
}

export type MatchConfidence = 'exact' | 'possible' | 'none';

export interface MatchResult {
  patient: Patient;
  score: number;
  confidence: MatchConfidence;
  matchedFields: string[];
}

const norm = (s?: string): string => (s ?? '').trim().toLowerCase();

function lastNameMatches(input: string | undefined, p: Patient): boolean {
  if (!input) return false;
  return (p.name ?? []).some((n) => norm(n.family) === norm(input));
}

function firstNameMatches(input: string | undefined, p: Patient): boolean {
  if (!input) return false;
  return (p.name ?? []).some((n) => (n.given ?? []).some((g) => norm(g) === norm(input)));
}

function dobMatches(input: string | undefined, p: Patient): boolean {
  return Boolean(input) && p.birthDate === input;
}

function ssnLast4Matches(input: string | undefined, p: Patient): boolean {
  if (!input) return false;
  const stored = (p.identifier ?? []).find((i) => i.system === SSN_SYSTEM)?.value;
  if (!stored) return false;
  return stored.replace(/\D/g, '').slice(-4) === input.replace(/\D/g, '');
}

function phoneMatches(input: string | undefined, p: Patient): boolean {
  if (!input) return false;
  const digits = input.replace(/\D/g, '');
  return (p.telecom ?? []).some(
    (t) => t.system === 'phone' && (t.value ?? '').replace(/\D/g, '') === digits
  );
}

export function scoreMatch(input: SearchInput, p: Patient): MatchResult {
  const checks: [string, boolean][] = [
    ['lastName', lastNameMatches(input.lastName, p)],
    ['dob', dobMatches(input.dob, p)],
    ['ssnLast4', ssnLast4Matches(input.ssnLast4, p)],
    ['phone', phoneMatches(input.phone, p)],
    ['firstName', firstNameMatches(input.firstName, p)],
  ];
  const matchedFields = checks.filter(([, v]) => v).map(([k]) => k);
  const strongHits = matchedFields.filter((f) => f !== 'firstName').length;
  let confidence: MatchConfidence;
  if (strongHits >= 4) confidence = 'exact';
  else if (strongHits >= 2) confidence = 'possible';
  else confidence = 'none';
  return { patient: p, score: matchedFields.length, confidence, matchedFields };
}
