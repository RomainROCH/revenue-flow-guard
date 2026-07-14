export type PlaywrightJsonSummary = {
  status: 'passed' | 'failed';
  tests: number | null;
  passed: number | null;
  failed: number | null;
  retries: number | null;
  durationMs: number | null;
};

export function summarizePlaywrightJson(raw: string): PlaywrightJsonSummary;
