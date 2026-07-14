import { expect, test } from '@playwright/test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

type Environment = Record<string, string | undefined>;

type ApplicationModule = {
  createApplication: (options?: { environment?: Environment }) => Server;
};

type PublicConfigModule = {
  parsePublicConfig: (environment: Environment) => unknown;
};

type PublicEvidenceModule = {
  parsePublicEvidence: (environment: Environment) => unknown;
};

type StaticAssetsModule = {
  transformPublicHtml: (source: string, publicConfig: unknown) => string;
};

const { createApplication } = require('../../src/create-application.js') as ApplicationModule;
const { parsePublicConfig } = require('../../src/public/public-config.js') as PublicConfigModule;
const { parsePublicEvidence } = require('../../src/public/public-evidence.js') as PublicEvidenceModule;
const { transformPublicHtml } = require('../../src/http/static-assets.js') as StaticAssetsModule;

const COMMIT_SHA = 'a'.repeat(40);
const OTHER_COMMIT_SHA = 'b'.repeat(40);
const FAULTS = [
  {
    id: 'AUTH_BYPASS',
    testId:
      'tests/api/catalog.spec.ts › GET /api/products requires a known session and leaks no catalogue data',
    expectedSignature: 'RFG:AUTH_BYPASS:AUTH_REQUIRED',
  },
  {
    id: 'CLIENT_PRICE_TRUST',
    testId:
      'tests/api/orders.spec.ts › POST /api/orders enforces exact top-level and item fields and forbids client prices or totals',
    expectedSignature: 'RFG:CLIENT_PRICE_TRUST:CLIENT_AMOUNT_FORBIDDEN',
  },
  {
    id: 'DUPLICATE_ORDER',
    testId:
      'tests/api/orders.spec.ts › a successful order uses canonical item order, server totals, an opaque id, and replays exactly once',
    expectedSignature: 'RFG:DUPLICATE_ORDER:IDEMPOTENT_REPLAY',
  },
  {
    id: 'EMPTY_CART_ACCEPTED',
    testId:
      'tests/api/orders.spec.ts › POST /api/orders maps empty, duplicate, unknown, and invalid-quantity items to INVALID_ITEMS without stock changes',
    expectedSignature: 'RFG:EMPTY_CART_ACCEPTED:EMPTY_CART_REJECTED',
  },
  {
    id: 'PAYMENT_DECLINE_HIDDEN',
    testId:
      'tests/ui/checkout.spec.ts › safe demonstration checkout › shows a declined-payment message, preserves the cart, and uses a new key for a new attempt',
    expectedSignature: 'RFG:PAYMENT_DECLINE_HIDDEN:DECLINE_VISIBLE',
  },
  {
    id: 'SUBMIT_CONTROL_MISSING',
    testId:
      'tests/ui/checkout.spec.ts › safe demonstration checkout › disables every submission path while the first order is pending',
    expectedSignature: 'RFG:SUBMIT_CONTROL_MISSING:SUBMIT_DISABLED',
  },
];

function validEvidence() {
  return {
    schemaVersion: 1,
    complete: true,
    sanitized: true,
    source: {
      commitSha: COMMIT_SHA,
      ciRunId: null,
      ciRunUrl: null,
    },
    generatedAt: '2026-07-14T12:00:00.000Z',
    baseline: {
      status: 'passed',
      tests: 96,
      retries: 0,
      durationMs: 12_345.25,
    },
    faults: FAULTS.map(({ id, testId, expectedSignature }) => ({
      id,
      testId,
      expectedSignature,
      status: 'detected',
      observedSignature: expectedSignature,
    })),
  };
}

function evidenceEnvironment(
  evidence: unknown = validEvidence(),
  sourceCommitSha = COMMIT_SHA,
): Environment {
  return {
    PUBLIC_EVIDENCE_JSON: JSON.stringify(evidence),
    SOURCE_COMMIT_SHA: sourceCommitSha,
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function withApplication(
  environment: Environment,
  assertion: (baseURL: string) => Promise<void>,
): Promise<void> {
  const server = createApplication({ environment });

  try {
    const baseURL = await listen(server);
    await assertion(baseURL);
  } finally {
    await close(server);
  }
}

test.describe('public evidence environment', () => {
  test('fails closed when evidence is missing or malformed', () => {
    expect(parsePublicEvidence({ SOURCE_COMMIT_SHA: COMMIT_SHA })).toEqual({
      available: false,
    });
    expect(
      parsePublicEvidence({
        PUBLIC_EVIDENCE_JSON: '{malformed-json:SECRET_SENTINEL',
        SOURCE_COMMIT_SHA: COMMIT_SHA,
      }),
    ).toEqual({ available: false });
  });

  test('rejects unsupported, incomplete, unsanitized, and commit-mismatched evidence', () => {
    const candidate = validEvidence();
    const invalidEnvironments = [
      evidenceEnvironment({ ...candidate, schemaVersion: 2 }),
      evidenceEnvironment({ ...candidate, complete: false }),
      evidenceEnvironment({ ...candidate, sanitized: false }),
      evidenceEnvironment(candidate, OTHER_COMMIT_SHA),
    ];

    for (const environment of invalidEnvironments) {
      expect(parsePublicEvidence(environment)).toEqual({ available: false });
    }
  });

  test('requires exactly the six canonical detected fault contracts', () => {
    const missingFault = validEvidence();
    missingFault.faults.pop();
    const duplicateId = validEvidence();
    duplicateId.faults[1].id = duplicateId.faults[0].id;
    const brokenContract = validEvidence();
    brokenContract.faults[0].observedSignature = 'RFG:AUTH_BYPASS:WRONG';
    const forgedMapping = validEvidence();
    forgedMapping.faults[0].testId =
      'tests/api/forged.spec.ts › forged mapping';
    const unsafeBaselineTotal = validEvidence();
    unsafeBaselineTotal.baseline.tests = Number.MAX_SAFE_INTEGER + 1;

    for (const candidate of [
      missingFault,
      duplicateId,
      brokenContract,
      forgedMapping,
      unsafeBaselineTotal,
    ]) {
      expect(parsePublicEvidence(evidenceEnvironment(candidate))).toEqual({
        available: false,
      });
    }
  });

  test('returns the exact valid evidence as an available discriminated result', () => {
    const evidence = validEvidence();

    expect(parsePublicEvidence(evidenceEnvironment(evidence))).toEqual({
      available: true,
      evidence,
    });
  });
});

test.describe('public evidence endpoint', () => {
  test('returns a closed no-store error without reflecting malformed environment values', async ({
    request,
  }) => {
    const sentinel = 'MALFORMED_SECRET_SENTINEL';

    await withApplication(
      {
        PUBLIC_EVIDENCE_JSON: `{not-json:${sentinel}`,
        SOURCE_COMMIT_SHA: COMMIT_SHA,
      },
      async (baseURL) => {
        const response = await request.get(`${baseURL}/evidence/latest.json`);
        const body = await response.text();

        expect(response.status()).toBe(503);
        expect(response.headers()['cache-control']).toBe('no-store');
        expect(JSON.parse(body)).toMatchObject({
          data: null,
          error: { code: 'EVIDENCE_UNAVAILABLE' },
        });
        expect(body).not.toContain(sentinel);
        expect(body).not.toContain('{not-json:');
      },
    );
  });

  test('returns the raw exact valid manifest with no-store caching', async ({ request }) => {
    const evidence = validEvidence();

    await withApplication(evidenceEnvironment(evidence), async (baseURL) => {
      const response = await request.get(`${baseURL}/evidence/latest.json`);

      expect(response.status()).toBe(200);
      expect(response.headers()['cache-control']).toBe('no-store');
      expect(await response.json()).toEqual(evidence);
    });
  });
});

const VALID_PUBLIC_CONFIG = {
  PUBLIC_CONTACT_URL: 'https://example.test/contact',
  PUBLIC_CONTACT_LABEL: 'Contact the team',
  PUBLIC_OFFER_NAME: 'Revenue Flow Guard',
  PUBLIC_OFFER_SUMMARY: 'Independent evidence for the checkout revenue path.',
};

test.describe('public configuration environment', () => {
  test('fails closed for a missing or non-HTTPS contact URL', () => {
    const { PUBLIC_CONTACT_URL: _omitted, ...missingUrl } = VALID_PUBLIC_CONFIG;

    expect(parsePublicConfig(missingUrl)).toEqual({ publicationReady: false });
    expect(
      parsePublicConfig({
        ...VALID_PUBLIC_CONFIG,
        PUBLIC_CONTACT_URL: 'http://example.test/contact',
      }),
    ).toEqual({ publicationReady: false });
  });

  test('fails closed for missing, empty, or oversized contact labels', () => {
    const { PUBLIC_CONTACT_LABEL: _omitted, ...missingLabel } = VALID_PUBLIC_CONFIG;
    const invalidEnvironments = [
      missingLabel,
      { ...VALID_PUBLIC_CONFIG, PUBLIC_CONTACT_LABEL: '' },
      { ...VALID_PUBLIC_CONFIG, PUBLIC_CONTACT_LABEL: ' '.repeat(80) },
      { ...VALID_PUBLIC_CONFIG, PUBLIC_CONTACT_LABEL: 'L'.repeat(81) },
    ];

    for (const environment of invalidEnvironments) {
      expect(parsePublicConfig(environment)).toEqual({ publicationReady: false });
    }
  });

  test('fails closed for missing, empty, or oversized offer names and summaries', () => {
    const { PUBLIC_OFFER_NAME: _omittedName, ...missingName } = VALID_PUBLIC_CONFIG;
    const { PUBLIC_OFFER_SUMMARY: _omittedSummary, ...missingSummary } =
      VALID_PUBLIC_CONFIG;
    const invalidEnvironments = [
      missingName,
      missingSummary,
      { ...VALID_PUBLIC_CONFIG, PUBLIC_OFFER_NAME: '' },
      { ...VALID_PUBLIC_CONFIG, PUBLIC_OFFER_NAME: 'N'.repeat(81) },
      { ...VALID_PUBLIC_CONFIG, PUBLIC_OFFER_SUMMARY: '' },
      { ...VALID_PUBLIC_CONFIG, PUBLIC_OFFER_SUMMARY: 'S'.repeat(241) },
    ];

    for (const environment of invalidEnvironments) {
      expect(parsePublicConfig(environment)).toEqual({ publicationReady: false });
    }
  });

  test('returns only the complete exact public configuration', () => {
    expect(parsePublicConfig(VALID_PUBLIC_CONFIG)).toEqual({
      publicationReady: true,
      contact: {
        url: 'https://example.test/contact',
        label: 'Contact the team',
      },
      offer: {
        name: 'Revenue Flow Guard',
        summary: 'Independent evidence for the checkout revenue path.',
      },
    });
  });
});

const PUBLIC_TEMPLATE = [
  '<main data-status="{{PUBLICATION_STATUS}}">',
  '<a href="{{PUBLIC_CONTACT_URL}}">{{PUBLIC_CONTACT_LABEL}}</a>',
  '<h1>{{PUBLIC_OFFER_NAME}}</h1>',
  '<p>{{PUBLIC_OFFER_SUMMARY}}</p>',
  '</main>',
].join('');

const PUBLIC_TOKENS = [
  '{{PUBLICATION_STATUS}}',
  '{{PUBLIC_CONTACT_URL}}',
  '{{PUBLIC_CONTACT_LABEL}}',
  '{{PUBLIC_OFFER_NAME}}',
  '{{PUBLIC_OFFER_SUMMARY}}',
];

test.describe('public HTML transformation', () => {
  test('replaces every ready token with HTML-escaped public values', () => {
    const rawValues = {
      url: 'https://example.test/contact?next=<private>&quote="value"&apostrophe=\'yes\'',
      label: 'Contact <sales> & support',
      name: 'Revenue "Flow" Guard',
      summary: "Proof isn't optional > shortcuts",
    };

    const transformed = transformPublicHtml(PUBLIC_TEMPLATE, {
      publicationReady: true,
      contact: {
        url: rawValues.url,
        label: rawValues.label,
      },
      offer: {
        name: rawValues.name,
        summary: rawValues.summary,
      },
    });

    for (const token of PUBLIC_TOKENS) {
      expect(transformed).not.toContain(token);
    }
    expect(transformed).toContain('data-status="ready"');
    expect(transformed).toContain(
      'https://example.test/contact?next=&lt;private&gt;&amp;quote=&quot;value&quot;&amp;apostrophe=&#39;yes&#39;',
    );
    expect(transformed).toContain('Contact &lt;sales&gt; &amp; support');
    expect(transformed).toContain('Revenue &quot;Flow&quot; Guard');
    expect(transformed).toContain('Proof isn&#39;t optional &gt; shortcuts');
    for (const value of Object.values(rawValues)) {
      expect(transformed).not.toContain(value);
    }
  });

  test('renders the exact publication-missing fallback for all public fields', () => {
    const transformed = transformPublicHtml(PUBLIC_TEMPLATE, {
      publicationReady: false,
    });

    expect(transformed).toBe(
      '<main data-status="publication-inputs-missing">' +
        '<a href="#publication-inputs-missing">Publication inputs missing</a>' +
        '<h1>Publication inputs missing</h1>' +
        '<p>Publication inputs missing</p>' +
        '</main>',
    );
    for (const token of PUBLIC_TOKENS) {
      expect(transformed).not.toContain(token);
    }
  });

  test('rejects a template containing only a subset of public tokens', () => {
    expect(() =>
      transformPublicHtml('<p>{{PUBLIC_OFFER_NAME}}</p>', {
        publicationReady: false,
      }),
    ).toThrow('Expected all public configuration tokens');
  });
});
