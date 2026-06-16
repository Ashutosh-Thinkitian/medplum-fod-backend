// SPDX-License-Identifier: Apache-2.0
import type { Address, ContactPoint, HumanName, Identifier, Patient } from '@medplum/fhirtypes';

/** The survivorship-aggregated demographic fields for a golden record. */
export interface GoldenDemographics {
  name?: HumanName[];
  identifier?: Identifier[];
  address?: Address[];
  birthDate?: string;
  gender?: Patient['gender'];
  telecom?: ContactPoint[];
}

function lastUpdated(p: Patient): number {
  const v = p.meta?.lastUpdated;
  return v ? Date.parse(v) : 0;
}
function byRecencyDesc(a: Patient, b: Patient): number {
  return lastUpdated(b) - lastUpdated(a);
}
function digits(s: string): string {
  return s.replace(/\D/g, '');
}
function addressCompleteness(a: Address): number {
  return [a.line?.length ? 1 : 0, a.city ? 1 : 0, a.state ? 1 : 0, a.postalCode ? 1 : 0].reduce((x, y) => x + y, 0);
}
function modeOf<T>(values: T[]): T | undefined {
  if (!values.length) return undefined;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0];
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  return best;
}

/**
 * Aggregate the best demographics across source Patients per CalMHSA survivorship rules.
 * @param sources - linked source Patients.
 * @param sorPriority - identifier systems ranked highest-priority first (system-of-record).
 */
export function computeSurvivorship(sources: Patient[], sorPriority: string[]): GoldenDemographics {
  if (!sources.length) return {};
  const recent = [...sources].sort(byRecencyDesc); // index 0 = most recent

  const out: GoldenDemographics = {};

  // name — most recent source that has a name
  const nameSrc = recent.find((s) => s.name?.length);
  if (nameSrc?.name) out.name = [nameSrc.name[0]];

  // identifiers — per distinct system, take value from highest-priority source that has it.
  const idBySystem = new Map<string, Identifier>();
  const rankedSources = (system: string): Patient[] =>
    recent.filter((s) => (s.identifier ?? []).some((i) => i.system === system));
  const allSystems = new Set<string>();
  for (const s of sources) for (const i of s.identifier ?? []) if (i.system) allSystems.add(i.system);
  const orderedSystems = [
    ...sorPriority.filter((sys) => allSystems.has(sys)),
    ...[...allSystems].filter((sys) => !sorPriority.includes(sys)),
  ];
  for (const system of orderedSystems) {
    const srcs = rankedSources(system);
    const chosen = srcs[0]?.identifier?.find((i) => i.system === system);
    if (chosen) idBySystem.set(system, chosen);
  }
  if (idBySystem.size) out.identifier = [...idBySystem.values()];

  // address — most complete; tie → most recent
  let bestAddr: Address | undefined;
  let bestScore = -1;
  for (const s of recent) {
    for (const a of s.address ?? []) {
      const score = addressCompleteness(a);
      if (score > bestScore) { bestScore = score; bestAddr = a; }
    }
  }
  if (bestAddr) out.address = [bestAddr];

  // birthDate + gender — mode
  const bd = modeOf((sources.map((s) => s.birthDate).filter(Boolean)) as string[]);
  if (bd) out.birthDate = bd;
  const g = modeOf((sources.map((s) => s.gender).filter(Boolean)) as NonNullable<Patient['gender']>[]);
  if (g) out.gender = g;

  // telecom — union of distinct normalized values per system
  const seen = new Set<string>();
  const telecom: ContactPoint[] = [];
  for (const s of recent) {
    for (const t of s.telecom ?? []) {
      if (!t.value || !t.system) continue;
      const norm = t.system === 'phone' ? digits(t.value) : t.value.toLowerCase();
      const key = `${t.system}|${norm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      telecom.push({ system: t.system, value: norm });
    }
  }
  if (telecom.length) out.telecom = telecom;

  return out;
}
