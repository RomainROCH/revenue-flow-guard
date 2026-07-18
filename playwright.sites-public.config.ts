import { defineConfig, devices } from '@playwright/test';
import { parseSitesPublicUrl } from './scripts/lib/sites-public-url.mjs';
import { execFileSync } from 'node:child_process';

const rawUrl = process.env.SITES_PUBLIC_URL;
const urlResult = parseSitesPublicUrl(rawUrl);
if (!urlResult.valid) {
  throw new Error('SITES_PUBLIC_URL validation failed');
}

const baseURL = urlResult.origin;

const rawSha = process.env.EXPECTED_SOURCE_COMMIT_SHA;
if (!rawSha || !/^[0-9a-f]{40}$/.test(rawSha)) {
  throw new Error('EXPECTED_SOURCE_COMMIT_SHA must be exactly 40 lowercase hex characters');
}

const actualSha = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: __dirname,
  encoding: 'utf8',
  windowsHide: true,
}).trim();
if (actualSha !== rawSha) {
  throw new Error('EXPECTED_SOURCE_COMMIT_SHA does not match repository HEAD');
}

const rawCiRunId = process.env.EXPECTED_CI_RUN_ID;
if (!rawCiRunId || !/^[1-9]\d*$/.test(rawCiRunId)) {
  throw new Error('EXPECTED_CI_RUN_ID must be a positive decimal string');
}

export default defineConfig({
  testDir: './tests/sites-public',
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
