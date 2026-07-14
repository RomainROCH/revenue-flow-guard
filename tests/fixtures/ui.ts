import type { Page } from '@playwright/test';
import { expect, test as isolatedTest } from './isolated-app';

type UiFixtures = {
  authenticatedPage: Page;
  externalNetworkBarriers: void;
};

export const test = isolatedTest.extend<UiFixtures>({
  externalNetworkBarriers: [
    async ({ isolatedApp, page }, use) => {
      if (isolatedApp.externalMode) {
        await page.route(`${isolatedApp.baseURL}/api/orders`, async (route) => {
          const response = await route.fetch();
          await isolatedApp.waitForOrderResponse();
          await route.fulfill({ response });
        });
        await page.route(`${isolatedApp.baseURL}/api/session`, async (route) => {
          const response = await route.fetch();
          await isolatedApp.waitForSessionResponse();
          await route.fulfill({ response });
        });
      }

      await use();
    },
    { auto: true },
  ],
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
