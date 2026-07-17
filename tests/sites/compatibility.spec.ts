import { test, expect, devices, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

async function assertNoOverflow(targetPage: Page) {
  await expect
    .poll(() =>
      targetPage.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
}

test.describe('sites artifact compatibility', () => {
  test('GET /__rfg/hosting-compatibility returns exact probe response', async ({
    page,
  }) => {
    expect(
      existsSync(
        resolve(process.cwd(), 'dist', '__rfg', 'hosting-compatibility'),
      ),
      'the compatibility response must come from worker execution, not a static asset',
    ).toBe(false);

    const response = await page.goto('/__rfg/hosting-compatibility');
    expect(response?.status()).toBe(200);

    const headers = response?.headers() ?? {};
    expect(headers['content-type']).toBe('application/json; charset=utf-8');
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['x-content-type-options']).toBe('nosniff');

    const text = await response!.text();
    expect(text).toBe(
      '{"schemaVersion":1,"kind":"rfg-sites-worker","status":"ok"}',
    );
    expect(JSON.parse(text)).toEqual({
      schemaVersion: 1,
      kind: 'rfg-sites-worker',
      status: 'ok',
    });
  });

  test('POST /__rfg/hosting-compatibility returns 405', async ({ page }) => {
    const response = await page.request.post('/__rfg/hosting-compatibility');
    expect(response.status()).toBe(405);
  });

  test('root returns 200 with static fallback content and no overflow', async ({
    browser,
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    expect(await response?.text()).toContain(
      'Live evidence requires JavaScript; no result is shown in this static view.',
    );

    const html = await page.content();
    expect(html).not.toContain('{{');
    expect(html).toContain(
      'Revenue Flow Guard \u2014 SaaS Release Confidence Sprint',
    );
    expect(html).toContain(
      'Protect one revenue-critical SaaS journey with risk-driven Playwright tests, CI evidence, and a maintainable handoff.',
    );
    expect(html).not.toContain('View the interactive demo');
    expect(html).toContain('Evidence unavailable or incomplete');

    const sourceEl = page.locator('[data-source-commit]');
    await expect(sourceEl).toHaveAttribute('data-source-commit', 'unavailable');

    const contactLink = page.locator(
      'a[href="https://github.com/RomainROCH"]',
    );
    await expect(contactLink).toBeVisible();
    await expect(contactLink).toHaveText('Contact Romain on GitHub');

    await assertNoOverflow(page);

    const pixelContext = await browser.newContext({ ...devices['Pixel 7'] });
    try {
      const pixelPage = await pixelContext.newPage();
      const pixelResponse = await pixelPage.goto('/');
      expect(pixelResponse?.status()).toBe(200);
      await assertNoOverflow(pixelPage);
    } finally {
      await pixelContext.close();
    }
  });

  test('case-study.html returns 200 with static fallback content and no overflow', async ({
    browser,
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const response = await page.goto('/case-study.html');
    expect(response?.status()).toBe(200);
    expect(await response?.text()).toContain(
      'Live evidence requires JavaScript; no result is shown in this static view.',
    );

    const html = await page.content();
    expect(html).not.toContain('{{');
    expect(html).toContain(
      'Revenue Flow Guard \u2014 SaaS Release Confidence Sprint',
    );
    expect(html).toContain(
      'Protect one revenue-critical SaaS journey with risk-driven Playwright tests, CI evidence, and a maintainable handoff.',
    );
    expect(html).not.toContain('View the interactive demo');
    expect(html).toContain('Evidence unavailable or incomplete');

    const sourceEl = page.locator('[data-source-commit]');
    await expect(sourceEl).toHaveAttribute('data-source-commit', 'unavailable');

    const contactLink = page.locator(
      'a[href="https://github.com/RomainROCH"]',
    );
    await expect(contactLink).toBeVisible();
    await expect(contactLink).toHaveText('Contact Romain on GitHub');

    await assertNoOverflow(page);

    const pixelContext = await browser.newContext({ ...devices['Pixel 7'] });
    try {
      const pixelPage = await pixelContext.newPage();
      const pixelResponse = await pixelPage.goto('/case-study.html');
      expect(pixelResponse?.status()).toBe(200);
      await assertNoOverflow(pixelPage);
    } finally {
      await pixelContext.close();
    }
  });

  test('style.css returns 200 with CSS content type', async ({ page }) => {
    const response = await page.goto('/style.css');
    expect(response?.status()).toBe(200);
    const contentType = response?.headers()['content-type'] ?? '';
    expect(contentType).toContain('css');
  });

  test('unknown path uses the truthful Pages fallback', async ({ page }) => {
    const response = await page.goto('/unknown-file-xyz.test');
    expect(response?.status()).toBe(200);
    const html = await page.content();
    expect(html).toContain(
      'Revenue Flow Guard \u2014 SaaS Release Confidence Sprint',
    );
    expect(html).toContain('Evidence unavailable or incomplete');
    expect(html).not.toContain('{{');
  });
});
