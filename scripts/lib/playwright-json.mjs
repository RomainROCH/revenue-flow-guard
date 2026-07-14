const INVALID_SUMMARY = Object.freeze({
  status: 'failed',
  tests: null,
  passed: null,
  failed: null,
  retries: null,
  durationMs: null,
});

const TEST_OUTCOMES = new Set(['expected', 'unexpected', 'flaky', 'skipped']);
const RESULT_OUTCOMES = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);

function invalidSummary() {
  return { ...INVALID_SUMMARY };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isNonNegativeFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function resultMatchesOutcome(outcome, results) {
  const finalStatus = results.at(-1).status;

  if (outcome === 'expected') {
    return finalStatus === 'passed';
  }

  if (outcome === 'unexpected') {
    return ['failed', 'timedOut', 'interrupted'].includes(finalStatus);
  }

  if (outcome === 'flaky') {
    return (
      finalStatus === 'passed' &&
      results.some((result) => result.retry > 0) &&
      results.slice(0, -1).some((result) => ['failed', 'timedOut', 'interrupted'].includes(result.status))
    );
  }

  return finalStatus === 'skipped';
}

function collectTests(suites) {
  if (!Array.isArray(suites)) {
    return null;
  }

  const tests = [];
  const pending = [...suites];

  while (pending.length > 0) {
    const suite = pending.pop();
    if (!isRecord(suite)) {
      return null;
    }

    if (suite.suites !== undefined) {
      if (!Array.isArray(suite.suites)) {
        return null;
      }
      pending.push(...suite.suites);
    }

    if (suite.specs !== undefined) {
      if (!Array.isArray(suite.specs)) {
        return null;
      }

      for (const spec of suite.specs) {
        if (!isRecord(spec) || !Array.isArray(spec.tests) || spec.tests.length === 0) {
          return null;
        }
        tests.push(...spec.tests);
      }
    }

    if (suite.suites === undefined && suite.specs === undefined) {
      return null;
    }
  }

  return tests;
}

function inspectTests(tests) {
  const outcomes = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  let retries = 0;

  for (const serializedTest of tests) {
    if (
      !isRecord(serializedTest) ||
      !TEST_OUTCOMES.has(serializedTest.status) ||
      !Array.isArray(serializedTest.results) ||
      serializedTest.results.length === 0
    ) {
      return null;
    }

    for (const result of serializedTest.results) {
      if (
        !isRecord(result) ||
        !RESULT_OUTCOMES.has(result.status) ||
        !isNonNegativeInteger(result.retry) ||
        !isNonNegativeFiniteNumber(result.duration)
      ) {
        return null;
      }

      if (result.retry > 0) {
        retries += 1;
      }
    }

    if (!resultMatchesOutcome(serializedTest.status, serializedTest.results)) {
      return null;
    }

    outcomes[serializedTest.status] += 1;
  }

  return { outcomes, retries };
}

export function summarizePlaywrightJson(raw) {
  let report;
  try {
    report = JSON.parse(raw);
  } catch {
    return invalidSummary();
  }

  if (
    !isRecord(report) ||
    !isRecord(report.stats) ||
    !Array.isArray(report.errors) ||
    !isNonNegativeInteger(report.stats.expected) ||
    !isNonNegativeInteger(report.stats.skipped) ||
    !isNonNegativeInteger(report.stats.unexpected) ||
    !isNonNegativeInteger(report.stats.flaky) ||
    !isNonNegativeFiniteNumber(report.stats.duration)
  ) {
    return invalidSummary();
  }

  const tests = collectTests(report.suites);
  if (tests === null || tests.length === 0) {
    return invalidSummary();
  }

  const inspection = inspectTests(tests);
  if (inspection === null) {
    return invalidSummary();
  }

  const expectedOutcomes = {
    expected: report.stats.expected,
    unexpected: report.stats.unexpected,
    flaky: report.stats.flaky,
    skipped: report.stats.skipped,
  };

  if (
    Object.entries(expectedOutcomes).some(
      ([outcome, count]) => inspection.outcomes[outcome] !== count,
    )
  ) {
    return invalidSummary();
  }

  const total = Object.values(expectedOutcomes).reduce((sum, count) => sum + count, 0);
  if (total !== tests.length) {
    return invalidSummary();
  }

  const failed = report.stats.skipped + report.stats.unexpected + report.stats.flaky;
  const status =
    failed === 0 && inspection.retries === 0 && report.errors.length === 0 ? 'passed' : 'failed';

  return {
    status,
    tests: total,
    passed: report.stats.expected,
    failed,
    retries: inspection.retries,
    durationMs: report.stats.duration,
  };
}
