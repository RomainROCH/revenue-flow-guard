import manifest from '../../regressions/manifest.json';

export const SITES_SOURCE_SHA = 'a'.repeat(40);
export const SITES_CI_RUN_ID = '29610161437';
export const SITES_CI_RUN_URL =
  `https://github.com/RomainROCH/revenue-flow-guard/actions/runs/${SITES_CI_RUN_ID}`;

export const SITES_EVIDENCE = {
  schemaVersion: 1,
  source: {
    commitSha: SITES_SOURCE_SHA,
    ciRunId: SITES_CI_RUN_ID,
    ciRunUrl: SITES_CI_RUN_URL,
  },
  generatedAt: '2026-07-17T20:10:42.138Z',
  complete: true,
  sanitized: true,
  baseline: {
    status: 'passed',
    tests: 103,
    retries: 0,
    durationMs: 9784.696,
  },
  faults: manifest.entries.map(({ id, testId, expectedSignature }) => ({
    id,
    testId,
    expectedSignature,
    observedSignature: expectedSignature,
    status: 'detected',
  })),
};

export const SITES_RUNTIME_ENV = {
  PUBLIC_CONTACT_URL: 'https://github.com/RomainROCH',
  PUBLIC_CONTACT_LABEL: 'Contact Romain on GitHub',
  PUBLIC_OFFER_NAME: 'Revenue Flow Guard — SaaS Release Confidence Sprint',
  PUBLIC_OFFER_SUMMARY:
    'Protect one revenue-critical SaaS journey with risk-driven Playwright tests, CI evidence, and a maintainable handoff.',
  SOURCE_COMMIT_SHA: SITES_SOURCE_SHA,
  PUBLIC_EVIDENCE_JSON: JSON.stringify(SITES_EVIDENCE),
};
