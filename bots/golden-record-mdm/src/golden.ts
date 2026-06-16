// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { Basic, Patient } from '@medplum/fhirtypes';
import { MDM } from './constants';
import type { GoldenDemographics } from './survivorship';

export function isGolden(p: Patient): boolean {
  return (p.meta?.tag ?? []).some((t) => t.system === MDM.goldenTag.system && t.code === MDM.goldenTag.code);
}

/** Create a golden Patient with the MDM tags, an EID, and the given demographics. */
export async function createGolden(
  medplum: MedplumClient,
  demographics: GoldenDemographics,
  eid: string
): Promise<Patient> {
  const golden: Patient = {
    resourceType: 'Patient',
    meta: {
      tag: [
        { system: MDM.goldenTag.system, code: MDM.goldenTag.code, display: MDM.goldenTag.display },
        { system: MDM.managingTag.system, code: MDM.managingTag.code, display: MDM.managingTag.display },
      ],
    },
    ...demographics,
    identifier: [{ system: MDM.eidSystem, value: eid }, ...(demographics.identifier ?? [])],
  };
  return medplum.createResource(golden);
}

/** Update a golden's demographics (after survivorship recompute), preserving tags + EID. */
export async function updateGoldenDemographics(
  medplum: MedplumClient,
  golden: Patient,
  demographics: GoldenDemographics
): Promise<Patient> {
  const eid = golden.identifier?.find((i) => i.system === MDM.eidSystem);
  const updated: Patient = {
    ...golden,
    name: demographics.name,
    address: demographics.address,
    birthDate: demographics.birthDate,
    gender: demographics.gender,
    telecom: demographics.telecom,
    identifier: [...(eid ? [eid] : []), ...(demographics.identifier ?? [])],
  };
  return medplum.updateResource(updated);
}

/** Add a seealso link (source → golden) and write a link Basic with metadata. */
export async function linkSourceToGolden(
  medplum: MedplumClient,
  source: Patient,
  golden: Patient,
  linkSource: 'AUTO' | 'MANUAL',
  matchResult: 'MATCH' | 'NO_MATCH' | 'POSSIBLE_MATCH',
  score: number
): Promise<Patient> {
  const ref = `Patient/${golden.id}`;
  const already = (source.link ?? []).some((l) => l.type === 'seealso' && l.other.reference === ref);
  let updated = source;
  if (!already) {
    updated = await medplum.updateResource<Patient>({
      ...source,
      link: [...(source.link ?? []), { type: 'seealso', other: { reference: ref } }],
    });
  }
  const linkBasic: Basic = {
    resourceType: 'Basic',
    code: { coding: [{ system: MDM.basicSystem, code: MDM.linkBasicCode }] },
    subject: { reference: `Patient/${source.id}` },
    extension: [
      { url: MDM.ext.golden, valueReference: { reference: ref } },
      { url: MDM.ext.source, valueReference: { reference: `Patient/${source.id}` } },
      { url: MDM.ext.matchResult, valueString: matchResult },
      { url: MDM.ext.linkSource, valueString: linkSource },
      { url: MDM.ext.score, valueDecimal: score },
    ],
  };
  // Upsert: if a link Basic already exists for this (source, golden) pair, update it
  // instead of creating a duplicate — prevents query-links returning the same link N times.
  const existing = await medplum.searchResources('Basic', {
    code: `${MDM.basicSystem}|${MDM.linkBasicCode}`,
    _count: '200',
  });
  const match = existing.find(
    (b) =>
      (b.extension ?? []).some(
        (e) => e.url === MDM.ext.source && e.valueReference?.reference === `Patient/${source.id}`
      ) &&
      (b.extension ?? []).some((e) => e.url === MDM.ext.golden && e.valueReference?.reference === ref)
  );
  if (match) {
    await medplum.updateResource({ ...linkBasic, id: match.id });
  } else {
    await medplum.createResource(linkBasic);
  }
  return updated;
}

/** Resolve the golden a source is linked to (via its seealso link). */
export async function findGoldenForSource(medplum: MedplumClient, source: Patient): Promise<Patient | undefined> {
  const ref = (source.link ?? []).find((l) => l.type === 'seealso')?.other.reference;
  if (!ref) return undefined;
  const id = ref.split('/')[1];
  try {
    return await medplum.readResource('Patient', id);
  } catch {
    return undefined;
  }
}

/** All source Patients linked to a golden (reverse lookup). */
export async function findSourcesForGolden(medplum: MedplumClient, goldenId: string): Promise<Patient[]> {
  return medplum.searchResources('Patient', { link: `Patient/${goldenId}`, _count: '100' });
}

/** All golden Patients. */
export async function findAllGoldens(medplum: MedplumClient): Promise<Patient[]> {
  return medplum.searchResources('Patient', {
    _tag: `${MDM.goldenTag.system}|${MDM.goldenTag.code}`,
    _count: '100',
  });
}
