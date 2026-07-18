import { expect, test, devices, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  SITES_CI_RUN_ID,
  SITES_CI_RUN_URL,
  SITES_EVIDENCE,
  SITES_RUNTIME_ENV,
  SITES_SOURCE_SHA,
} from './runtime-fixture';

const HOSTED_SCOPE_LIMITATION =
  'This hosted case study publishes commit-bound CI evidence. The synthetic checkout remains a local/source demonstration and is not exposed as a public account or payment service.';
const HEALTH_BYTES =
  '{"data":{"status":"ok","version":1,"testMode":false},"error":null}';
const UNAVAILABLE_EVIDENCE_BYTES =
  '{"data":null,"error":{"code":"EVIDENCE_UNAVAILABLE","message":"Public evidence is unavailable."}}';

type BuiltHandler = (
  request: Request,
  context?: { waitUntil(promise: Promise<unknown>): void },
) => Promise<Response>;

async function assertNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(0);
}

async function assertCommercialPage(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  const html = await page.content();
  expect(html).not.toContain('{{');
  expect(html).not.toContain('View the interactive demo');
  expect(html).not.toContain('Live evidence requires JavaScript');
  expect(html).toContain(HOSTED_SCOPE_LIMITATION);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Protect the flow that pays you',
  );
  await expect(page.getByText(SITES_RUNTIME_ENV.PUBLIC_OFFER_NAME, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(SITES_RUNTIME_ENV.PUBLIC_OFFER_SUMMARY, { exact: true }).first()).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('data-source-commit', SITES_SOURCE_SHA);
  await expect(page.getByTestId('live-evidence')).toContainText(
    '103 baseline tests passed with zero retries.',
  );
  await expect(page.getByTestId('live-evidence')).toContainText(
    '6 of 6 synthetic regressions detected.',
  );
  await expect(page.getByTestId('live-evidence').getByRole('link', {
    name: `View CI run ${SITES_CI_RUN_ID}`,
  })).toHaveAttribute('href', SITES_CI_RUN_URL);
  await expect(page.getByRole('link', { name: 'View source on GitHub' })).toHaveAttribute(
    'href',
    'https://github.com/RomainROCH/revenue-flow-guard',
  );
  await expect(page.getByRole('link', { name: SITES_RUNTIME_ENV.PUBLIC_CONTACT_LABEL })).toHaveAttribute(
    'href',
    SITES_RUNTIME_ENV.PUBLIC_CONTACT_URL,
  );
  await assertNoOverflow(page);
}

test.describe('vinext commercial runtime', () => {
  test('root and case-study routes render the exact server-side commercial proof', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await assertCommercialPage(page, '/');
    await assertCommercialPage(page, '/case-study.html');
  });

  test('health route returns exact public bytes and headers', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/json; charset=utf-8');
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(await response.text()).toBe(HEALTH_BYTES);
  });

  test('evidence route returns exact commit-bound evidence and headers', async ({ request }) => {
    const response = await request.get('/evidence/latest.json');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/json; charset=utf-8');
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(await response.text()).toBe(JSON.stringify(SITES_EVIDENCE));
  });

  test('account, payment, order, test-control, and unknown paths are controlled 404s', async ({ request }) => {
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
      expect(response.headers()['set-cookie'], path).toBeUndefined();
      expect(await response.text(), path).not.toContain('{{');
    }
  });

  test('POST routes do not expose a partial checkout mutation surface', async ({ request }) => {
    for (const path of ['/api/session', '/api/payment-token', '/api/orders']) {
      const response = await request.post(path, { data: { sentinel: 'SECRET_SENTINEL' } });
      expect(response.status(), path).toBe(404);
      expect(response.headers()['set-cookie'], path).toBeUndefined();
      expect(await response.text(), path).not.toContain('SECRET_SENTINEL');
    }
  });

  test('Pixel 7 and JavaScript-disabled contexts preserve the complete SSR proof', async ({ browser }) => {
    const pixel = await browser.newContext({ ...devices['Pixel 7'] });
    const noScript = await browser.newContext({
      ...devices['Desktop Chrome'],
      javaScriptEnabled: false,
    });
    try {
      await assertCommercialPage(await pixel.newPage(), '/');
      await assertCommercialPage(await noScript.newPage(), '/case-study.html');
    } finally {
      await pixel.close();
      await noScript.close();
    }
  });

  test('keyboard order exposes source, exact CI proof, then contact with visible focus', async ({ page }) => {
    await page.goto('/');
    const expectedHrefs = [
      'https://github.com/RomainROCH/revenue-flow-guard',
      SITES_CI_RUN_URL,
      SITES_RUNTIME_ENV.PUBLIC_CONTACT_URL,
    ];
    for (const href of expectedHrefs) {
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus')).toHaveAttribute('href', href);
      const outlineStyle = await page.locator(':focus').evaluate((element) =>
        getComputedStyle(element).outlineStyle,
      );
      expect(outlineStyle).not.toBe('none');
    }
  });

  test('200 percent layout stays readable without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto('/');
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });
    await assertNoOverflow(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('built handler reads evidence at request time and fails closed without reflection', async () => {
    const handlerUrl = pathToFileURL(resolve('dist', 'server', 'index.js')).href;
    const module = await import(`${handlerUrl}?runtime=${Date.now()}`) as {
      default: BuiltHandler | { default?: BuiltHandler };
    };
    const handler = typeof module.default === 'function'
      ? module.default
      : module.default.default;
    expect(typeof handler).toBe('function');
    expect(handler?.length).toBe(2);

    const previous = Object.fromEntries(
      Object.keys(SITES_RUNTIME_ENV).map((key) => [key, process.env[key]]),
    );
    const context = { waitUntil: (_promise: Promise<unknown>) => {} };
    try {
      Object.assign(process.env, SITES_RUNTIME_ENV);
      const ready = await handler!(
        new Request('http://site.test/evidence/latest.json'),
        context,
      );
      expect(ready.status).toBe(200);
      expect(await ready.text()).toBe(JSON.stringify(SITES_EVIDENCE));

      const invalidEvidenceValues: Array<string | undefined> = [
        undefined,
        '{malformed:SECRET_SENTINEL',
        JSON.stringify({ ...SITES_EVIDENCE, complete: false }),
        JSON.stringify({
          ...SITES_EVIDENCE,
          source: {
            ...SITES_EVIDENCE.source,
            ciRunUrl:
              `https://github.com/another-owner/another-repo/actions/runs/${SITES_CI_RUN_ID}`,
          },
        }),
        JSON.stringify({
          ...SITES_EVIDENCE,
          source: { ...SITES_EVIDENCE.source, ciRunId: null, ciRunUrl: null },
        }),
        JSON.stringify({
          ...SITES_EVIDENCE,
          source: { ...SITES_EVIDENCE.source, commitSha: 'b'.repeat(40) },
        }),
      ];
      for (const value of invalidEvidenceValues) {
        if (value === undefined) {
          delete process.env.PUBLIC_EVIDENCE_JSON;
        } else {
          process.env.PUBLIC_EVIDENCE_JSON = value;
        }
        const unavailable = await handler!(
          new Request('http://site.test/evidence/latest.json'),
          context,
        );
        expect(unavailable.status).toBe(503);
        const body = await unavailable.text();
        expect(body).toBe(UNAVAILABLE_EVIDENCE_BYTES);
        expect(body).not.toContain('SECRET_SENTINEL');
        expect(body).not.toContain('another-owner');
      }

      Object.assign(process.env, SITES_RUNTIME_ENV);
      process.env.PUBLIC_CONTACT_URL = 'http://SECRET_SENTINEL.example.test';
      const invalidConfigPage = await handler!(
        new Request('http://site.test/'),
        context,
      );
      expect(invalidConfigPage.status).toBe(200);
      const invalidConfigHtml = await invalidConfigPage.text();
      expect(invalidConfigHtml).toContain('Publication inputs missing');
      expect(invalidConfigHtml).not.toContain('SECRET_SENTINEL');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
