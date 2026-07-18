import { expect, test } from '@playwright/test';

import {
  parseSitesPublicConfig,
  parseSitesPublicEvidence,
} from '../../sites-app/lib/public-runtime';

type Environment = Record<string, string | undefined>;

type NodePublicRuntime = {
  parsePublicConfig: (environment: Environment) => unknown;
  parsePublicEvidence: (environment: Environment) => unknown;
};

type Manifest = {
  entries: Array<{
    id: string;
    testId: string;
    expectedSignature: string;
  }>;
};

const { parsePublicConfig, parsePublicEvidence } = {
  ...require('../../src/public/public-config.js'),
  ...require('../../src/public/public-evidence.js'),
} as NodePublicRuntime;

const { entries: canonicalFaults } = require('../../regressions/manifest.json') as Manifest;

const SOURCE_SHA = 'a'.repeat(40);
const CI_RUN_ID = '29610161437';
const EXACT_CI_URL =
  `https://github.com/RomainROCH/revenue-flow-guard/actions/runs/${CI_RUN_ID}`;

const validConfig: Environment = {
  PUBLIC_CONTACT_URL: 'https://github.com/RomainROCH',
  PUBLIC_CONTACT_LABEL: 'Contact Romain on GitHub',
  PUBLIC_OFFER_NAME: 'Revenue Flow Guard — SaaS Release Confidence Sprint',
  PUBLIC_OFFER_SUMMARY:
    'Protect one revenue-critical SaaS journey with risk-driven Playwright tests, CI evidence, and a maintainable handoff.',
};

function validEvidence() {
  return {
    schemaVersion: 1,
    source: {
      commitSha: SOURCE_SHA,
      ciRunId: CI_RUN_ID,
      ciRunUrl: EXACT_CI_URL,
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
    faults: canonicalFaults.map(({ id, testId, expectedSignature }) => ({
      id,
      testId,
      expectedSignature,
      observedSignature: expectedSignature,
      status: 'detected',
    })),
  };
}

function evidenceEnvironment(evidence: unknown): Environment {
  return {
    SOURCE_COMMIT_SHA: SOURCE_SHA,
    PUBLIC_EVIDENCE_JSON:
      typeof evidence === 'string' ? evidence : JSON.stringify(evidence),
  };
}

test.describe('Sites public config parity', () => {
  test('accepts the exact Node-valid public configuration', () => {
    expect(parseSitesPublicConfig(validConfig)).toEqual(
      parsePublicConfig(validConfig),
    );
  });

  const rejectedConfigs: Array<[string, Environment]> = [
    ['missing contact URL', { ...validConfig, PUBLIC_CONTACT_URL: undefined }],
    ['non-HTTPS contact URL', { ...validConfig, PUBLIC_CONTACT_URL: 'http://example.test' }],
    ['credential-bearing contact URL', {
      ...validConfig,
      PUBLIC_CONTACT_URL: 'https://user:pass@example.test/contact',
    }],
    ['untrimmed label', { ...validConfig, PUBLIC_CONTACT_LABEL: ' Contact ' }],
    ['oversized offer name', { ...validConfig, PUBLIC_OFFER_NAME: 'N'.repeat(81) }],
    ['oversized summary', { ...validConfig, PUBLIC_OFFER_SUMMARY: 'S'.repeat(241) }],
  ];

  for (const [name, environment] of rejectedConfigs) {
    test(`rejects ${name} exactly like the Node runtime`, () => {
      expect(parsePublicConfig(environment)).toEqual({ publicationReady: false });
      expect(parseSitesPublicConfig(environment)).toEqual({ publicationReady: false });
    });
  }
});

test.describe('Sites public evidence boundary', () => {
  test('accepts exact repository CI evidence with Node parity', () => {
    const environment = evidenceEnvironment(validEvidence());
    expect(parseSitesPublicEvidence(environment)).toEqual(
      parsePublicEvidence(environment),
    );
  });

  const invalidEvidence: Array<[string, (evidence: ReturnType<typeof validEvidence>) => void]> = [
    ['incomplete evidence', (evidence) => { evidence.complete = false; }],
    ['unsanitized evidence', (evidence) => { evidence.sanitized = false; }],
    ['retried baseline', (evidence) => { evidence.baseline.retries = 1; }],
    ['forged fault mapping', (evidence) => {
      evidence.faults[0].observedSignature = 'RFG:FORGED';
    }],
    ['duplicate fault', (evidence) => {
      evidence.faults[1] = structuredClone(evidence.faults[0]);
    }],
  ];

  for (const [name, mutate] of invalidEvidence) {
    test(`rejects ${name} with Node parity`, () => {
      const evidence = validEvidence();
      mutate(evidence);
      const environment = evidenceEnvironment(evidence);
      expect(parsePublicEvidence(environment)).toEqual({ available: false });
      expect(parseSitesPublicEvidence(environment)).toEqual({ available: false });
    });
  }

  test('rejects malformed JSON with Node parity and no reflection', () => {
    const environment = evidenceEnvironment('{malformed:SECRET_SENTINEL');
    expect(parsePublicEvidence(environment)).toEqual({ available: false });
    expect(parseSitesPublicEvidence(environment)).toEqual({ available: false });
    expect(JSON.stringify(parseSitesPublicEvidence(environment))).not.toContain(
      'SECRET_SENTINEL',
    );
  });

  test('rejects a commit mismatch with Node parity', () => {
    const evidence = validEvidence();
    evidence.source.commitSha = 'b'.repeat(40);
    const environment = evidenceEnvironment(evidence);
    expect(parsePublicEvidence(environment)).toEqual({ available: false });
    expect(parseSitesPublicEvidence(environment)).toEqual({ available: false });
  });

  test('deliberately rejects Node-valid local evidence', () => {
    const evidence = validEvidence();
    evidence.source.ciRunId = null as unknown as string;
    evidence.source.ciRunUrl = null as unknown as string;
    const environment = evidenceEnvironment(evidence);
    expect(parsePublicEvidence(environment)).toMatchObject({ available: true });
    expect(parseSitesPublicEvidence(environment)).toEqual({ available: false });
  });

  test('deliberately rejects Node-valid evidence from another repository', () => {
    const evidence = validEvidence();
    evidence.source.ciRunUrl =
      `https://github.com/another-owner/another-repo/actions/runs/${CI_RUN_ID}`;
    const environment = evidenceEnvironment(evidence);
    expect(parsePublicEvidence(environment)).toMatchObject({ available: true });
    expect(parseSitesPublicEvidence(environment)).toEqual({ available: false });
  });

  test('deliberately rejects canonical URL with trailing slash', () => {
    const evidence = validEvidence();
    evidence.source.ciRunUrl =
      `https://github.com/RomainROCH/revenue-flow-guard/actions/runs/${CI_RUN_ID}/`;
    const environment = evidenceEnvironment(evidence);
    expect(parsePublicEvidence(environment)).toMatchObject({ available: true });
    expect(parseSitesPublicEvidence(environment)).toEqual({ available: false });
  });

  test('deliberately rejects canonical URL with explicit default port', () => {
    const evidence = validEvidence();
    evidence.source.ciRunUrl =
      `https://github.com:443/RomainROCH/revenue-flow-guard/actions/runs/${CI_RUN_ID}`;
    const environment = evidenceEnvironment(evidence);
    expect(parsePublicEvidence(environment)).toMatchObject({ available: true });
    expect(parseSitesPublicEvidence(environment)).toEqual({ available: false });
  });

  test('deliberately rejects canonical URL with repeated path slash', () => {
    const evidence = validEvidence();
    evidence.source.ciRunUrl =
      `https://github.com/RomainROCH/revenue-flow-guard/actions/runs//${CI_RUN_ID}`;
    const environment = evidenceEnvironment(evidence);
    expect(parsePublicEvidence(environment)).toMatchObject({ available: true });
    expect(parseSitesPublicEvidence(environment)).toEqual({ available: false });
  });
});
