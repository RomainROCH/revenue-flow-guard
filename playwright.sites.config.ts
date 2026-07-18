import { defineConfig, devices } from '@playwright/test';

import { SITES_RUNTIME_ENV } from './tests/sites/runtime-fixture';

export default defineConfig({
  testDir: './tests/sites',
  testMatch: '**/commercial-runtime.spec.ts',
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8788',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: {
    command: 'npm run start:site -- --hostname 127.0.0.1 --port 8788',
    url: 'http://127.0.0.1:8788/api/health',
    env: {
      ...process.env,
      ...SITES_RUNTIME_ENV,
      NODE_ENV: 'production',
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
