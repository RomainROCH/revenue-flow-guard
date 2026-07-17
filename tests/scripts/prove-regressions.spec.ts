import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyFaultReport,
  classifyFaultRun,
  validateExternalBaseUrl,
  validateHealthContract,
  validateStateContract,
} from '../../scripts/prove-regressions.mjs';
import {
  runProcess,
  startManagedProcess,
} from '../../scripts/lib/process.mjs';

const MAPPING = Object.freeze({
  id: 'AUTH_BYPASS',
  testId:
    'tests/api/catalog.spec.ts › GET /api/products requires a known session and leaks no catalogue data',
  expectedSignature: ['RFG', 'AUTH_BYPASS', 'AUTH_REQUIRED'].join(':'),
});

const OTHER_SIGNATURE = [
  'RFG',
  'CLIENT_PRICE_TRUST',
  'CLIENT_AMOUNT_FORBIDDEN',
].join(':');

const UI_MAPPING = Object.freeze({
  id: 'SUBMIT_CONTROL_MISSING',
  testId:
    'tests/ui/checkout.spec.ts › safe demonstration checkout › disables every submission path while the first order is pending',
  expectedSignature: [
    'RFG',
    'SUBMIT_CONTROL_MISSING',
    'SUBMIT_DISABLED',
  ].join(':'),
});

function makeReport(
  failures: Array<{
    testId: string;
    message?: string;
    stack?: string;
  }>,
) {
  const specs = failures.map((failure) => {
    const [file, ...titles] = failure.testId.split(' › ');
    const title = titles.join(' › ');

    return {
      file,
      title,
      ok: false,
      tests: [
        {
          expectedStatus: 'passed',
          status: 'unexpected',
          results: [
            {
              retry: 0,
              status: 'failed',
              duration: 5,
              error: {
                message: failure.message ?? 'assertion failed',
                stack: failure.stack ?? failure.message ?? 'assertion failed',
              },
              errors: [
                {
                  message: failure.message ?? 'assertion failed',
                  stack: failure.stack ?? failure.message ?? 'assertion failed',
                },
              ],
              stdout: [],
              stderr: [],
            },
          ],
        },
      ],
    };
  });

  const byFile = new Map<string, typeof specs>();
  for (const spec of specs) {
    const existing = byFile.get(spec.file) ?? [];
    existing.push(spec);
    byFile.set(spec.file, existing);
  }

  return JSON.stringify({
    suites: [...byFile.entries()].map(([file, fileSpecs]) => ({
      title: file,
      file,
      specs: fileSpecs,
      suites: [],
    })),
    errors: [],
    stats: {
      startTime: '2026-07-14T00:00:00.000Z',
      duration: failures.length * 5,
      expected: 0,
      skipped: 0,
      unexpected: failures.length,
      flaky: 0,
    },
  });
}

function makePassingReport() {
  return JSON.stringify({
    suites: [
      {
        title: 'tests/api/catalog.spec.ts',
        file: 'tests/api/catalog.spec.ts',
        suites: [],
        specs: [
          {
            file: 'tests/api/catalog.spec.ts',
            title:
              'GET /api/products requires a known session and leaks no catalogue data',
            ok: true,
            tests: [
              {
                expectedStatus: 'passed',
                status: 'expected',
                results: [
                  {
                    retry: 0,
                    status: 'passed',
                    duration: 5,
                    errors: [],
                    stdout: [],
                    stderr: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    errors: [],
    stats: {
      startTime: '2026-07-14T00:00:00.000Z',
      duration: 5,
      expected: 1,
      skipped: 0,
      unexpected: 0,
      flaky: 0,
    },
  });
}

function makeNestedUiReport() {
  return JSON.stringify({
    suites: [
      {
        title: 'tests/ui/checkout.spec.ts',
        file: 'tests/ui/checkout.spec.ts',
        specs: [],
        suites: [
          {
            title: 'safe demonstration checkout',
            file: 'tests/ui/checkout.spec.ts',
            suites: [],
            specs: [
              {
                file: 'tests/ui/checkout.spec.ts',
                title: 'disables every submission path while the first order is pending',
                ok: false,
                tests: [
                  {
                    expectedStatus: 'passed',
                    status: 'unexpected',
                    results: [
                      {
                        retry: 0,
                        status: 'failed',
                        duration: 5,
                        error: {
                          message: UI_MAPPING.expectedSignature,
                          stack: UI_MAPPING.expectedSignature,
                        },
                        errors: [
                          {
                            message: UI_MAPPING.expectedSignature,
                            stack: UI_MAPPING.expectedSignature,
                          },
                        ],
                        stdout: [],
                        stderr: [],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    errors: [],
    stats: {
      startTime: '2026-07-14T00:00:00.000Z',
      duration: 5,
      expected: 0,
      skipped: 0,
      unexpected: 1,
      flaky: 0,
    },
  });
}

test.describe('fault report classification', () => {
  test('detects exactly one mapped failure carrying exactly the expected RFG value', () => {
    const report = makeReport([
      {
        testId: MAPPING.testId,
        message: MAPPING.expectedSignature,
      },
    ]);

    expect(classifyFaultReport(report, MAPPING)).toEqual({
      detected: true,
      code: 'EXPECTED_REGRESSION_DETECTED',
      testId: MAPPING.testId,
      signature: MAPPING.expectedSignature,
    });
  });

  test('normalizes reporter files that are relative to the configured tests root', () => {
    const report = JSON.parse(
      makeReport([
        { testId: MAPPING.testId, message: MAPPING.expectedSignature },
      ]),
    );
    report.suites[0].file = 'api/catalog.spec.ts';
    report.suites[0].specs[0].file = 'api/catalog.spec.ts';

    expect(classifyFaultReport(JSON.stringify(report), MAPPING)).toEqual({
      detected: true,
      code: 'EXPECTED_REGRESSION_DETECTED',
      testId: MAPPING.testId,
      signature: MAPPING.expectedSignature,
    });
  });

  test('allows the same expected RFG value to be repeated in message and stack', () => {
    const report = makeReport([
      {
        testId: MAPPING.testId,
        message: `Error: ${MAPPING.expectedSignature}`,
        stack: `Error: ${MAPPING.expectedSignature}\n  at checkout.spec.ts:1:1`,
      },
    ]);

    expect(classifyFaultReport(report, MAPPING).detected).toBe(true);
  });

  test('reconstructs the canonical testId through a nested UI describe suite', () => {
    expect(classifyFaultReport(makeNestedUiReport(), UI_MAPPING)).toEqual({
      detected: true,
      code: 'EXPECTED_REGRESSION_DETECTED',
      testId: UI_MAPPING.testId,
      signature: UI_MAPPING.expectedSignature,
    });
  });

  test('fails closed when no test failed', () => {
    expect(classifyFaultReport(makePassingReport(), MAPPING)).toEqual({
      detected: false,
      code: 'EXPECTED_TEST_DID_NOT_FAIL',
    });
  });

  test('distinguishes a wrong failed test from the expected regression', () => {
    const report = makeReport([
      {
        testId: 'tests/api/catalog.spec.ts › an unrelated test',
        message: MAPPING.expectedSignature,
      },
    ]);

    expect(classifyFaultReport(report, MAPPING)).toEqual({
      detected: false,
      code: 'UNEXPECTED_TEST_FAILED',
    });
  });

  test('rejects every report containing more than one failed test', () => {
    const report = makeReport([
      { testId: MAPPING.testId, message: MAPPING.expectedSignature },
      {
        testId: 'tests/api/catalog.spec.ts › an unrelated test',
        message: 'another failure',
      },
    ]);

    expect(classifyFaultReport(report, MAPPING)).toEqual({
      detected: false,
      code: 'MULTIPLE_TESTS_FAILED',
    });
  });

  test('rejects a run that executed any test beyond the mapped failure', () => {
    const report = JSON.parse(
      makeReport([
        { testId: MAPPING.testId, message: MAPPING.expectedSignature },
      ]),
    );
    const passingReport = JSON.parse(makePassingReport());
    report.suites[0].specs.push(...passingReport.suites[0].specs);
    report.stats.expected = 1;
    report.stats.duration += passingReport.stats.duration;

    expect(classifyFaultReport(JSON.stringify(report), MAPPING)).toEqual({
      detected: false,
      code: 'UNEXPECTED_TEST_COUNT',
    });
  });

  test('rejects a mapped failure produced after any retry', () => {
    const report = JSON.parse(
      makeReport([
        { testId: MAPPING.testId, message: MAPPING.expectedSignature },
      ]),
    );
    report.suites[0].specs[0].tests[0].results[0].retry = 1;

    expect(classifyFaultReport(JSON.stringify(report), MAPPING)).toEqual({
      detected: false,
      code: 'RETRIES_PRESENT',
    });
  });

  test('distinguishes wrong, missing, and multiple distinct RFG values', () => {
    expect(
      classifyFaultReport(
        makeReport([{ testId: MAPPING.testId, message: OTHER_SIGNATURE }]),
        MAPPING,
      ),
    ).toEqual({ detected: false, code: 'UNEXPECTED_REGRESSION_SIGNATURE' });

    expect(
      classifyFaultReport(
        makeReport([{ testId: MAPPING.testId, message: 'ordinary assertion failure' }]),
        MAPPING,
      ),
    ).toEqual({ detected: false, code: 'EXPECTED_SIGNATURE_MISSING' });

    expect(
      classifyFaultReport(
        makeReport([
          {
            testId: MAPPING.testId,
            message: `${MAPPING.expectedSignature} ${OTHER_SIGNATURE}`,
          },
        ]),
        MAPPING,
      ),
    ).toEqual({ detected: false, code: 'MULTIPLE_REGRESSION_SIGNATURES' });
  });

  test('fails closed on malformed JSON', () => {
    expect(classifyFaultReport('{not-json', MAPPING)).toEqual({
      detected: false,
      code: 'MALFORMED_PLAYWRIGHT_REPORT',
    });
  });
});

test.describe('fault execution classification', () => {
  for (const [kind, code] of [
    ['process_timeout', 'PROCESS_TIMEOUT'],
    ['spawn_error', 'SPAWN_ERROR'],
    ['browser_launch_error', 'BROWSER_LAUNCH_ERROR'],
    ['fixture_error', 'FIXTURE_ERROR'],
    ['server_exit', 'SERVER_EXITED'],
  ] as const) {
    test(`${kind} can never count as a detected regression`, () => {
      expect(
        classifyFaultRun({
          mapping: MAPPING,
          report: makeReport([
            { testId: MAPPING.testId, message: MAPPING.expectedSignature },
          ]),
          execution: { kind },
        }),
      ).toEqual({ detected: false, code });
    });
  }
});

test.describe('isolated app preflight contracts', () => {
  test('accepts only the exact healthy test-mode payload', () => {
    const healthy = {
      data: { status: 'ok', version: 1, testMode: true },
      error: null,
    };

    expect(validateHealthContract(healthy)).toEqual({
      valid: true,
      code: 'VALID_HEALTH_CONTRACT',
    });

    for (const invalid of [
      { data: { status: 'ok', version: 1, testMode: false }, error: null },
      { data: { status: 'ok', version: 1, testMode: true, extra: true }, error: null },
      { data: { status: 'ok', version: 1, testMode: true } },
    ]) {
      expect(validateHealthContract(invalid)).toEqual({
        valid: false,
        code: 'INVALID_HEALTH_CONTRACT',
      });
    }
  });

  test('requires the expected fault and every current-state counter at zero', () => {
    const resetState = {
      data: {
        faultId: MAPPING.id,
        orderCount: 0,
        pendingOrderCount: 0,
        orderRequestCount: 0,
      },
      error: null,
    };

    expect(validateStateContract(resetState, MAPPING.id)).toEqual({
      valid: true,
      code: 'VALID_STATE_CONTRACT',
    });

    for (const invalid of [
      { ...resetState, data: { ...resetState.data, faultId: 'NONE' } },
      { ...resetState, data: { ...resetState.data, orderCount: 1 } },
      { ...resetState, data: { ...resetState.data, pendingOrderCount: 1 } },
      { ...resetState, data: { ...resetState.data, orderRequestCount: 1 } },
      { ...resetState, data: { ...resetState.data, extra: 0 } },
    ]) {
      expect(validateStateContract(invalid, MAPPING.id)).toEqual({
        valid: false,
        code: 'INVALID_STATE_CONTRACT',
      });
    }
  });
});

test.describe('external app URL boundary', () => {
  test('accepts only explicit valid ports on the runner loopback address', () => {
    expect(validateExternalBaseUrl('http://127.0.0.1:1')).toEqual({
      valid: true,
      code: 'VALID_EXTERNAL_BASE_URL',
      normalizedUrl: 'http://127.0.0.1:1',
    });
    expect(validateExternalBaseUrl('http://127.0.0.1:65535')).toEqual({
      valid: true,
      code: 'VALID_EXTERNAL_BASE_URL',
      normalizedUrl: 'http://127.0.0.1:65535',
    });
  });

  test('rejects credentials, paths, queries, hashes, implicit or invalid ports, and every other host', () => {
    for (const candidate of [
      'http://user:pass@127.0.0.1:4173',
      'http://127.0.0.1:4173/api',
      'http://127.0.0.1:4173?token=secret',
      'http://127.0.0.1:4173#fragment',
      'http://127.0.0.1',
      'http://127.0.0.1:0',
      'http://127.0.0.1:65536',
      'https://127.0.0.1:4173',
      'http://localhost:4173',
      'http://[::1]:4173',
      'http://192.168.1.10:4173',
    ]) {
      expect(validateExternalBaseUrl(candidate), candidate).toEqual({
        valid: false,
        code: 'INVALID_EXTERNAL_BASE_URL',
      });
    }
  });
});

test('runProcess times out and leaves no long-lived child behind', async () => {
  test.setTimeout(2_000);
  const fixture = join(__dirname, '..', 'fixtures', 'process', 'long-lived.mjs');

  const result = await runProcess({
    command: process.execPath,
    args: [fixture],
    timeoutMs: 300,
  });

  expect(result.kind).toBe('timeout');
  const childPid = Number(result.stdout.trim());
  expect(Number.isInteger(childPid) && childPid > 0).toBe(true);

  await expect
    .poll(
      () => {
        try {
          process.kill(childPid, 0);
          return true;
        } catch {
          return false;
        }
      },
      { timeout: 1_000, intervals: [20, 50, 100] },
    )
    .toBe(false);
});

test('runProcess captures stderr separately from stdout', async () => {
  const fixture = join(__dirname, '..', 'fixtures', 'process', 'stderr.mjs');

  const result = await runProcess({
    command: process.execPath,
    args: [fixture],
    timeoutMs: 1_000,
  });

  expect(result.kind).toBe('exit');
  if (result.kind !== 'exit') return;
  expect(result.stdout).toBe('public-output');
  expect(result.stderr).toBe('diagnostic-output');
  expect(result.stderrTruncated).toBe(false);
});

test('runProcess reports bounded output truncation on timeout', async () => {
  test.setTimeout(2_000);
  const fixture = join(__dirname, '..', 'fixtures', 'process', 'long-lived.mjs');

  const result = await runProcess({
    command: process.execPath,
    args: [fixture],
    timeoutMs: 300,
    maxStdoutBytes: 1,
  });

  expect(result.kind).toBe('timeout');
  if (result.kind !== 'timeout') return;
  expect(result.stdout).toHaveLength(1);
  expect(result.stdoutTruncated).toBe(true);
  expect(result.stderrTruncated).toBe(false);
});

test('startManagedProcess returns the complete safe spawn-error shape', () => {
  const result = startManagedProcess({
    command: process.execPath,
    cwd: 42 as unknown as string,
  });

  expect(result).toEqual({
    kind: 'spawn_error',
    stdout: '',
    stdoutTruncated: false,
    stderr: '',
    stderrTruncated: false,
  });
});

test('runProcess waits for descendant stdio pipes to close', async () => {
  const fixture = join(__dirname, '..', 'fixtures', 'process', 'descendant-holds-pipe.mjs');
  const cwd = await mkdtemp(join(tmpdir(), 'prove-regressions-'));

  try {
    const result = await runProcess({
      command: process.execPath,
      args: [fixture],
      timeoutMs: 2_000,
      cwd,
    });

    expect(result.kind).toBe('exit');
    if (result.kind !== 'exit') return;

    expect(result.stdout).toContain('DESCENDANT_PIPE_CLOSED');

    await rm(cwd, { recursive: true, force: true });
  } finally {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rm(cwd, { recursive: true, force: true });
        break;
      } catch {
        if (attempt < 4) await new Promise((r) => setTimeout(r, 100));
      }
    }
  }
});
