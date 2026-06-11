// SPDX-License-Identifier: Apache-2.0
import type { Patient } from '@medplum/fhirtypes';
import { damerauLevenshtein, normalizeName, soundex } from './text-distance';

const SOUNDEX_BONUS = 0.92;

/** 0..1 name similarity: max(normalized Levenshtein distance, Soundex-equal bonus). */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = damerauLevenshtein(na, nb);
  const editScore = 1 - dist / Math.max(na.length, nb.length);
  const phoneticScore = soundex(na) === soundex(nb) ? SOUNDEX_BONUS : 0;
  return Math.max(editScore, phoneticScore);
}

export type MatchGrade = 'certain' | 'probable' | 'possible' | 'certainly-not';

export interface Thresholds {
  certain: number;
  probable: number;
  possible: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { certain: 0.85, probable: 0.65, possible: 0.45 };

export interface ScoredCandidate {
  patient: Patient;
  score: number;
}

// Field weights for the normalized match score. family is intentionally dominant (0.45,
// vs a naive 0.30) so a wrong family name cannot be rescued by first-name + DOB coincidence:
// a garbage surname + correct DOB must score below the `possible` threshold (see F1.6 test).
//
// STRONG-ANCHOR RULE: A `certain` match must be anchored by either a family-name or an
// identifier comparison (both sides present). Without such an anchor, a query with only
// birthDate/gender/phone/email could naively reach score=1.0 via a single matching field —
// causing many unrelated patients sharing a birthday to all be returned as "certain"
// (false positives / PHI over-disclosure). The cap below prevents this: anchor-less matches
// are capped at NO_ANCHOR_CAP (< `certain` threshold) so they can reach at most `probable`.
const NO_ANCHOR_CAP = 0.84; // just below DEFAULT_THRESHOLDS.certain (0.85)

const WEIGHTS = {
  identifier: 0.35,
  family: 0.45,
  given: 0.15,
  birthDate: 0.2,
  phone: 0.2,
  email: 0.2,
  gender: 0.05,
};

function digits(s: string): string {
  return s.replace(/\D/g, '');
}

function bestFamily(p: Patient): string[] {
  return (p.name ?? []).map((n) => n.family ?? '').filter(Boolean);
}
function allGiven(p: Patient): string[] {
  return (p.name ?? []).flatMap((n) => n.given ?? []).filter(Boolean);
}
function telecom(p: Patient, system: 'phone' | 'email'): string[] {
  return (p.telecom ?? []).filter((t) => t.system === system && t.value).map((t) => t.value as string);
}

/** Best name similarity across all of input's vs candidate's name parts. */
function bestNameSim(inputs: string[], cands: string[]): number {
  let best = 0;
  for (const i of inputs) for (const c of cands) best = Math.max(best, nameSimilarity(i, c));
  return best;
}

/** Weighted score over fields present on BOTH input and candidate; normalized to 0..1. */
export function scoreCandidate(input: Patient, candidate: Patient): ScoredCandidate {
  let score = 0;
  let total = 0;
  // Strong anchor: true when identifier OR family name is present on BOTH sides (denominator).
  // Without an anchor, the score is capped at NO_ANCHOR_CAP to prevent single weak-field
  // queries (e.g. birthDate-only) from reaching `certain` (see NO_ANCHOR_CAP comment above).
  let hasStrongAnchor = false;

  const inIds = input.identifier ?? [];
  const cIds = candidate.identifier ?? [];
  if (inIds.length && cIds.length) {
    total += WEIGHTS.identifier;
    const hit = inIds.some((a) => cIds.some((b) => a.value === b.value && (!a.system || a.system === b.system)));
    if (hit) score += WEIGHTS.identifier;
    hasStrongAnchor = true;
  }

  const inFam = bestFamily(input);
  const cFam = bestFamily(candidate);
  if (inFam.length && cFam.length) {
    total += WEIGHTS.family;
    score += WEIGHTS.family * bestNameSim(inFam, cFam);
    hasStrongAnchor = true;
  }

  const inGiv = allGiven(input);
  const cGiv = allGiven(candidate);
  if (inGiv.length && cGiv.length) {
    total += WEIGHTS.given;
    score += WEIGHTS.given * bestNameSim(inGiv, cGiv);
  }

  if (input.birthDate && candidate.birthDate) {
    total += WEIGHTS.birthDate;
    if (input.birthDate === candidate.birthDate) score += WEIGHTS.birthDate;
  }

  const inPhone = telecom(input, 'phone').map(digits);
  const cPhone = telecom(candidate, 'phone').map(digits);
  if (inPhone.length && cPhone.length) {
    total += WEIGHTS.phone;
    if (inPhone.some((p) => cPhone.includes(p))) score += WEIGHTS.phone;
  }

  const inEmail = telecom(input, 'email').map((e) => e.toLowerCase());
  const cEmail = telecom(candidate, 'email').map((e) => e.toLowerCase());
  if (inEmail.length && cEmail.length) {
    total += WEIGHTS.email;
    if (inEmail.some((e) => cEmail.includes(e))) score += WEIGHTS.email;
  }

  if (input.gender && candidate.gender) {
    total += WEIGHTS.gender;
    if (input.gender === candidate.gender) score += WEIGHTS.gender;
  }

  let normalizedScore = total > 0 ? score / total : 0;
  if (!hasStrongAnchor) {
    normalizedScore = Math.min(normalizedScore, NO_ANCHOR_CAP);
  }
  return { patient: candidate, score: normalizedScore };
}

export function classifyGrade(score: number, t: Thresholds): MatchGrade {
  if (score >= t.certain) return 'certain';
  if (score >= t.probable) return 'probable';
  if (score >= t.possible) return 'possible';
  return 'certainly-not';
}
