import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { summarizePlaywrightJson } from '../../scripts/lib/playwright-json.mjs';

type Summary = {
  status: 'passed' | 'failed';
  tests: number | null;
  passed: number | null;
  failed: number | null;
  retries: number | null;
  durationMs: number | null;
};

function fixture(name: string): string {
  return readFileSync(join(__dirname, '..', 'fixtures', 'playwright-json', name), 'utf8');
}

test.describe('Playwright JSON summary', () => {
  test('normalizes an all-pass reporter result', () => {
    const expected: Summary = {
      status: 'passed',
      tests: 2,
      passed: 2,
      failed: 0,
      retries: 0,
      durationMs: 420,
    };

    expect(summarizePlaywrightJson(fixture('all-pass.json'))).toEqual(expected);
  });

  test('marks an unexpected test failure as failed', () => {
    const expected: Summary = {
      status: 'failed',
      tests: 2,
      passed: 1,
      failed: 1,
      retries: 0,
      durationMs: 530,
    };

    expect(summarizePlaywrightJson(fixture('failed.json'))).toEqual(expected);
  });

  test('treats a retried flaky test as a failure even when its final attempt passes', () => {
    const expected: Summary = {
      status: 'failed',
      tests: 1,
      passed: 0,
      failed: 1,
      retries: 1,
      durationMs: 310,
    };

    expect(summarizePlaywrightJson(fixture('flaky-retried.json'))).toEqual(expected);
  });

  test('treats a skipped test as a failure', () => {
    const report = JSON.parse(fixture('all-pass.json'));
    report.stats.expected = 1;
    report.stats.skipped = 1;
    report.suites[0].specs[1].tests[0].status = 'skipped';
    report.suites[0].specs[1].tests[0].results[0].status = 'skipped';

    const expected: Summary = {
      status: 'failed',
      tests: 2,
      passed: 1,
      failed: 1,
      retries: 0,
      durationMs: 420,
    };

    expect(summarizePlaywrightJson(JSON.stringify(report))).toEqual(expected);
  });

  test('fails closed on malformed JSON without inventing totals', () => {
    const expected: Summary = {
      status: 'failed',
      tests: null,
      passed: null,
      failed: null,
      retries: null,
      durationMs: null,
    };

    expect(summarizePlaywrightJson(fixture('malformed.json'))).toEqual(expected);
  });

  test('fails closed when a reporter test has no results without inventing totals', () => {
    const expected: Summary = {
      status: 'failed',
      tests: null,
      passed: null,
      failed: null,
      retries: null,
      durationMs: null,
    };

    expect(summarizePlaywrightJson(fixture('missing-results.json'))).toEqual(expected);
  });
});
