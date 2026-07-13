import type { Page } from '@playwright/test';
import { expect, test as isolatedTest } from './isolated-app';

type UiFixtures = {
  authenticatedPage: Page;
};

export const test = isolatedTest.extend<UiFixtures>({
  authenticatedPage: async ({ isolatedApp, page }, use) => {
    const response = await page.request.post(
      `${isolatedApp.baseURL}/api/session`,
      {
        data: { username: 'demo', password: 'demo' },
      },
    );
    expect(response.status()).toBe(201);

    await use(page);
  },
});

export { expect };
