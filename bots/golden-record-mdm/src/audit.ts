// SPDX-License-Identifier: Apache-2.0
import type { MedplumClient } from '@medplum/core';
import type { AuditEvent, Patient, Reference } from '@medplum/fhirtypes';

/** Write an AuditEvent recording an MDM link action (F2.6 link history). */
export async function writeLinkAuditEvent(
  medplum: MedplumClient,
  action: string,
  golden: Patient,
  source: Patient,
  outcome: '0' | '4' | '8' = '0'
): Promise<void> {
  const entity = (p: Patient): { what: Reference } => ({ what: { reference: `Patient/${p.id}` } });
  const ev: AuditEvent = {
    resourceType: 'AuditEvent',
    type: { system: 'http://terminology.hl7.org/CodeSystem/audit-event-type', code: 'rest' },
    subtype: [{ system: 'https://calmhsa-works.dev/mdm', code: action }],
    action: 'U',
    recorded: '1970-01-01T00:00:00.000Z',
    outcome,
    agent: [{ who: { display: 'golden-record-mdm bot' }, requestor: false }],
    source: { observer: { display: 'golden-record-mdm bot' } },
    entity: [entity(golden), entity(source)],
  };
  await medplum.createResource(ev);
}
