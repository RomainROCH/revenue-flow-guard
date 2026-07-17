import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/sites',
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8788',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
  ],
  webServer: {
    command: 'wrangler pages dev --ip 127.0.0.1 --port 8788',
    url: 'http://127.0.0.1:8788/__rfg/hosting-compatibility',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
