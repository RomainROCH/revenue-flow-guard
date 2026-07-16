import { devices, type Page } from '@playwright/test';
import { expect, test } from '../fixtures/ui';

const { entries: FAULTS } = require('../../regressions/manifest.json') as {
  entries: Array<{ id: string; testId: string; expectedSignature: string }>;
};

function validEvidence() {
  return {
    schemaVersion: 1,
    complete: true,
    sanitized: true,
    source: {
      commitSha: 'a'.repeat(40),
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
      observedSignature: expectedSignature,
      status: 'detected',
    })),
  };
}

const SMOKE_ENVIRONMENT = {
  PUBLIC_CONTACT_URL: 'https://example.test/contact',
  PUBLIC_CONTACT_LABEL: 'Contact the Revenue Flow Guard team',
  PUBLIC_OFFER_NAME: 'Revenue Flow Guard — SaaS Release Confidence Sprint',
  PUBLIC_OFFER_SUMMARY:
    'Protect one revenue-critical SaaS journey with risk-driven Playwright tests, CI evidence, and a maintainable handoff.',
  SOURCE_COMMIT_SHA: 'a'.repeat(40),
  PUBLIC_EVIDENCE_JSON: JSON.stringify(validEvidence()),
};

const externalBaseUrl =
  process.env.RFG_EXTERNAL_BASE_URL ?? process.env.PUBLIC_URL;
if (
  process.env.RFG_EXTERNAL_BASE_URL === undefined &&
  process.env.PUBLIC_URL !== undefined
) {
  process.env.RFG_EXTERNAL_BASE_URL = process.env.PUBLIC_URL;
}

async function assertNoOverflow(targetPage: Page) {
  await expect
    .poll(() =>
      targetPage.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
}

const PUBLIC_URLS = [
  { path: '/', name: 'index', html: true },
  { path: '/case-study.html', name: 'case study', html: true },
  { path: '/api/health', name: 'health', html: false },
  { path: '/evidence/latest.json', name: 'evidence', html: false },
] as const;

test.describe('public smoke tests', () => {
  test.use({
    applicationOptions:
      externalBaseUrl === undefined ? { environment: SMOKE_ENVIRONMENT } : {},
  });

  for (const { path, name, html } of PUBLIC_URLS) {
    test(`smokes ${name} at 1280x720 and Pixel 7${html ? ' without overflow' : ''}`, async ({
      browser,
      isolatedApp,
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      const response = await page.goto(`${isolatedApp.baseURL}${path}`);
      expect(response?.status()).toBe(200);
      if (html) await assertNoOverflow(page);

      const pixelContext = await browser.newContext({ ...devices['Pixel 7'] });
      try {
        const pixelPage = await pixelContext.newPage();
        const pixelResponse = await pixelPage.goto(`${isolatedApp.baseURL}${path}`);
        expect(pixelResponse?.status()).toBe(200);
        if (html) await assertNoOverflow(pixelPage);
      } finally {
        await pixelContext.close();
      }
    });
  }

  test('requires HTTPS Secure HttpOnly and SameSite=Strict in external mode', async ({
    isolatedApp,
    page,
  }) => {
    test.skip(!isolatedApp.externalMode, 'only runs in external mode');

    expect(isolatedApp.baseURL).toMatch(/^https:/);

    const response = await page.request.post(`${isolatedApp.baseURL}/api/session`, {
      data: { username: 'demo', password: 'demo' },
    });
    expect(response.status()).toBe(201);

    const setCookie = response.headers()['set-cookie'] ?? '';
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
  });
});
