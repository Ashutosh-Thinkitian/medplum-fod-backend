// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Parameters, Patient, RiskAssessment, Task } from '@medplum/fhirtypes';
import { MDM } from '../constants';
import {
  createGolden, findGoldenForSource, findSourcesForGolden,
  isGolden, linkSourceToGolden, updateGoldenDemographics,
} from '../golden';
import { classifyGrade, scoreCandidate, type Thresholds } from '../scoring';
import { computeSurvivorship } from '../survivorship';

export interface LinkOptions {
  thresholds: Thresholds;
  sorPriority: string[];
  /** EID to stamp on a newly created golden; caller must ensure uniqueness per cluster (e.g. derived from a source id / UUID). */
  eid: string;
}

function out(parts: Record<string, string | undefined>): Parameters {
  return {
    resourceType: 'Parameters',
    parameter: Object.entries(parts)
      .filter(([, v]) => v !== undefined)
      .map(([name, valueString]) => ({ name, valueString: valueString as string })),
  };
}

/**
 * Auto-link an incoming Patient: MATCH→link to golden, POSSIBLE→review queue, else no-match.
 * NOTE: `incoming` MUST be a persisted Patient (have an `id`) so it is excluded from its own
 * candidate search; the dispatcher always passes the saved resource.
 */
export async function runLink(medplum: MedplumClient, incoming: Patient, opts: LinkOptions): Promise<Parameters> {
  const families = (incoming.name ?? []).map((n) => n.family ?? '').filter(Boolean);
  const givens = (incoming.name ?? []).flatMap((n) => n.given ?? []).filter(Boolean);
  const stems = new Set<string>();
  for (const f of families) { const s = f.toLowerCase(); if (s) stems.add(s.slice(0, 3)); }
  for (const g of givens) { const s = g.toLowerCase(); if (s) stems.add(s.slice(0, 3)); }

  const seen = new Map<string, Patient>();
  const searchPromises = [...stems].flatMap((stem) => [
    medplum.searchResources('Patient', { 'family:contains': stem, _count: '100' }),
    medplum.searchResources('Patient', { 'given:contains': stem, _count: '100' }),
  ]);
  for (const list of await Promise.all(searchPromises)) {
    for (const p of list) if (p.id && p.id !== incoming.id && !isGolden(p)) seen.set(p.id, p);
  }
  if (incoming.birthDate) {
    const bd = await medplum.searchResources('Patient', { birthdate: incoming.birthDate, _count: '100' });
    for (const p of bd) if (p.id && p.id !== incoming.id && !isGolden(p)) seen.set(p.id, p);
  }
  const candidates = [...seen.values()];

  let best: { patient: Patient; score: number } | undefined;
  for (const c of candidates) {
    const { score } = scoreCandidate(incoming, c);
    if (!best || score > best.score) best = { patient: c, score };
  }
  const grade = best ? classifyGrade(best.score, opts.thresholds) : 'certainly-not';

  if (best && grade === 'certain') {
    let golden = await findGoldenForSource(medplum, best.patient);
    if (!golden) {
      const demo0 = computeSurvivorship([best.patient], opts.sorPriority);
      golden = await createGolden(medplum, demo0, opts.eid);
      await linkSourceToGolden(medplum, best.patient, golden, 'AUTO', 'MATCH', best.score);
    }
    await linkSourceToGolden(medplum, incoming, golden, 'AUTO', 'MATCH', best.score);
    const sources = await findSourcesForGolden(medplum, golden.id as string);
    const demo = computeSurvivorship(sources, opts.sorPriority);
    golden = await updateGoldenDemographics(medplum, golden, demo);
    return out({ action: 'linked', goldenRecord: `Patient/${golden.id}`, score: String(best.score), grade });
  }

  if (best && (grade === 'probable' || grade === 'possible')) {
    const ra: RiskAssessment = {
      resourceType: 'RiskAssessment',
      status: 'final',
      code: { coding: [{ system: MDM.basicSystem, code: 'duplicate-patient' }] },
      subject: { reference: `Patient/${incoming.id}` },
      basis: [{ reference: `Patient/${best.patient.id}` }],
      prediction: [{ qualitativeRisk: { text: grade }, probabilityDecimal: best.score }],
    };
    const savedRa = await medplum.createResource(ra);
    const task: Task = {
      resourceType: 'Task',
      status: 'requested',
      intent: 'order',
      code: { coding: [{ system: MDM.basicSystem, code: MDM.reviewTaskCode }] },
      focus: { reference: `RiskAssessment/${savedRa.id}` },
      for: { reference: `Patient/${incoming.id}` },
    };
    await medplum.createResource(task);
    return out({ action: 'review-queued', candidate: `Patient/${best.patient.id}`, score: String(best.score), grade });
  }

  return out({ action: 'no-match', score: best ? String(best.score) : '0', grade });
}
