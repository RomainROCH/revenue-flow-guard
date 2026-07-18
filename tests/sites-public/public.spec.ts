import { expect, test, devices, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EXPECTED_SOURCE_COMMIT_SHA = process.env.EXPECTED_SOURCE_COMMIT_SHA!;
const EXPECTED_CI_RUN_ID = process.env.EXPECTED_CI_RUN_ID!;
const EXPECTED_CI_RUN_URL = `https://github.com/RomainROCH/revenue-flow-guard/actions/runs/${EXPECTED_CI_RUN_ID}`;

const HOSTED_SCOPE_LIMITATION =
  'This hosted case study publishes commit-bound CI evidence. The synthetic checkout remains a local/source demonstration and is not exposed as a public account or payment service.';

const HEALTH_BYTES =
  '{"data":{"status":"ok","version":1,"testMode":false},"error":null}';

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../regressions/manifest.json'), 'utf8'),
) as {
  entries: Array<{
    id: string;
    testId: string;
    expectedSignature: string;
  }>;
};

async function assertNoOverflow(page: Page) {
  await expect.poll(() =>
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

async function assertCommercialPage(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  const html = await page.content();
  expect(html).toContain(HOSTED_SCOPE_LIMITATION);

  await expect(
    page.getByRole('heading', { level: 1 }),
  ).toHaveText('Protect the flow that pays you');

  await expect(
    page.getByText(
      'Revenue Flow Guard — SaaS Release Confidence Sprint',
      { exact: true },
    ).first(),
  ).toBeVisible();

  await expect(
    page.getByText(
      'Protect one revenue-critical SaaS journey with risk-driven Playwright tests, CI evidence, and a maintainable handoff.',
      { exact: true },
    ).first(),
  ).toBeVisible();

  await expect(page.locator('main')).toHaveAttribute(
    'data-source-commit',
    EXPECTED_SOURCE_COMMIT_SHA,
  );

  await expect(
    page.getByRole('link', { name: 'View source on GitHub' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/RomainROCH/revenue-flow-guard',
  );

  await expect(
    page.locator('main').getByRole('link', { name: `View CI run ${EXPECTED_CI_RUN_ID}` }),
  ).toHaveAttribute('href', EXPECTED_CI_RUN_URL);

  await expect(
    page.getByRole('link', { name: 'Contact Romain on GitHub' }),
  ).toHaveAttribute('href', 'https://github.com/RomainROCH');

  await assertNoOverflow(page);
}

test.describe('public smoke tests', () => {
  test('root and case-study routes render the exact commercial proof at desktop', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await assertCommercialPage(page, '/');
    await assertCommercialPage(page, '/case-study.html');
  });

  test('health route returns exact public bytes and headers', async ({
    request,
  }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe(
      'application/json; charset=utf-8',
    );
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(await response.text()).toBe(HEALTH_BYTES);
  });

  test('evidence route returns exact commit-bound evidence with no-store and nosniff', async ({
    request,
  }) => {
    const response = await request.get('/evidence/latest.json');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe(
      'application/json; charset=utf-8',
    );
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');

    const body = JSON.parse(await response.text());
    expect(Object.keys(body).sort()).toEqual([
      'baseline',
      'complete',
      'faults',
      'generatedAt',
      'sanitized',
      'schemaVersion',
      'source',
    ]);
    expect(body.schemaVersion).toBe(1);
    expect(body.complete).toBe(true);
    expect(body.sanitized).toBe(true);
    expect(body.source.commitSha).toBe(EXPECTED_SOURCE_COMMIT_SHA);
    expect(body.source.ciRunId).toBe(EXPECTED_CI_RUN_ID);
    expect(body.source.ciRunUrl).toBe(EXPECTED_CI_RUN_URL);
    expect(body.baseline).toMatchObject({
      status: 'passed',
      tests: expect.any(Number),
      retries: 0,
      durationMs: expect.any(Number),
    });
    expect(body.baseline.tests).toBeGreaterThan(0);
    expect(body.faults).toHaveLength(manifest.entries.length);
    const expectedIds = manifest.entries.map(({ id }) => id).sort();
    const actualIds = body.faults.map((f: { id: string }) => f.id).sort();
    expect(actualIds).toEqual(expectedIds);
    for (const fault of body.faults) {
      const contract = manifest.entries.find(({ id }) => id === fault.id);
      expect(contract).toBeDefined();
      expect(fault.testId).toBe(contract!.testId);
      expect(fault.expectedSignature).toBe(contract!.expectedSignature);
      expect(fault.observedSignature).toBe(contract!.expectedSignature);
      expect(fault.status).toBe('detected');
      expect(Object.keys(fault).sort()).toEqual([
        'expectedSignature',
        'id',
        'observedSignature',
        'status',
        'testId',
      ]);
    }
    expect(typeof body.generatedAt).toBe('string');
  });

  test('Pixel 7 viewport has no horizontal overflow', async ({
    browser,
  }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL!;
    const context = await browser.newContext({ ...devices['Pixel 7'], baseURL });
    try {
      const pixelPage = await context.newPage();
      const response = await pixelPage.goto('/');
      expect(response?.status()).toBe(200);
      await assertNoOverflow(pixelPage);

      const caseStudyResponse = await pixelPage.goto('/case-study.html');
      expect(caseStudyResponse?.status()).toBe(200);
      await assertNoOverflow(pixelPage);
    } finally {
      await context.close();
    }
  });

  test('account, payment, order, test-control, and unknown GET routes return 404 with no cookie', async ({
    request,
  }) => {
    for (const path of [
      '/api/session',
      '/api/products',
      '/api/payment-token',
      '/api/orders',
      '/api/__test/reset',
      '/__rfg/hosting-compatibility',
      '/unknown-file-xyz.test',
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
      expect(response.headers()['content-type'], path).toBe('text/html; charset=utf-8');
      expect(response.headers()['set-cookie'], path).toBeUndefined();
      const text = await response.text();
      expect(text, path).toContain('Page not found');
      expect(text, path).toContain('This page does not exist');
      expect(text, path).not.toContain('{{');
      expect(text, path).not.toContain(EXPECTED_SOURCE_COMMIT_SHA);
    }
  });

  test('POST routes do not expose a partial checkout mutation surface', async ({
    request,
  }) => {
    for (const path of ['/api/session', '/api/payment-token', '/api/orders']) {
      const response = await request.post(path, {
        data: { sentinel: 'SECRET_SENTINEL' },
      });
      expect(response.status(), path).toBe(404);
      expect(response.headers()['content-type'], path).toBe('text/html; charset=utf-8');
      expect(response.headers()['set-cookie'], path).toBeUndefined();
      const text = await response.text();
      expect(text, path).toContain('Page not found');
      expect(text, path).toContain('This page does not exist');
      expect(text, path).not.toContain('SECRET_SENTINEL');
      expect(text, path).not.toContain(EXPECTED_SOURCE_COMMIT_SHA);
    }
  });

  test('GitHub Actions run metadata matches the expected public source', async () => {
    const response = await fetch(
      `https://api.github.com/repos/RomainROCH/revenue-flow-guard/actions/runs/${EXPECTED_CI_RUN_ID}`,
    );
    expect(response.ok).toBe(true);
    const run = await response.json() as {
      repository: { full_name: string };
      id: number;
      head_sha: string;
      status: string;
      conclusion: string;
    };
    expect(run.repository.full_name).toBe('RomainROCH/revenue-flow-guard');
    expect(String(run.id)).toBe(EXPECTED_CI_RUN_ID);
    expect(run.head_sha).toBe(EXPECTED_SOURCE_COMMIT_SHA);
    expect(run.status).toBe('completed');
    expect(run.conclusion).toBe('success');
  });
});
