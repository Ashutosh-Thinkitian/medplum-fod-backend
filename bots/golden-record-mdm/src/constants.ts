// SPDX-License-Identifier: Apache-2.0
// Single source of truth for MDM systems, tags, and codes.
export const MDM = {
  goldenTag: {
    system: 'http://hapifhir.io/fhir/NamingSystem/mdm-record-status',
    code: 'GOLDEN_RECORD',
    display: 'Golden Record',
  },
  managingTag: {
    system: 'https://calmhsa-works.dev/mdm/managing-system',
    code: 'CALMHSA-MDM',
    display: 'Managed by CalMHSA Bot MDM',
  },
  eidSystem: 'https://calmhsa-works.dev/mdm-eid',
  // Basic resources carry link metadata + not-duplicate markers (Patient.link has no score/source fields).
  basicSystem: 'https://calmhsa-works.dev/mdm',
  linkBasicCode: 'mdm-link',
  notDuplicateBasicCode: 'mdm-not-duplicate',
  // Extension URLs on the link Basic:
  linkExtensionBase: 'https://calmhsa-works.dev/mdm/link',
  ext: {
    golden: 'https://calmhsa-works.dev/mdm/link#golden',
    source: 'https://calmhsa-works.dev/mdm/link#source',
    matchResult: 'https://calmhsa-works.dev/mdm/link#matchResult',
    linkSource: 'https://calmhsa-works.dev/mdm/link#linkSource',
    score: 'https://calmhsa-works.dev/mdm/link#score',
  },
  reviewTaskCode: 'mdm-review',
  updateLinkTaskCode: 'mdm-update-link',
  mergeTaskCode: 'mdm-merge',
} as const;
