import { summarizePlaywrightJson } from './lib/playwright-json.mjs';
import { basename, dirname, resolve } from 'node:path';
export { validateExternalBaseUrl } from './lib/external-base-url.mjs';

const RFG_SIGNATURE = /RFG:[A-Z0-9_]+:[A-Z0-9][A-Z0-9_.-]*/g;

function hasExactKeys(value, expectedKeys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort())
  );
}

export function validateHealthContract(payload) {
  const valid =
    hasExactKeys(payload, ['data', 'error']) &&
    payload.error === null &&
    hasExactKeys(payload.data, ['status', 'testMode', 'version']) &&
    payload.data.status === 'ok' &&
    payload.data.version === 1 &&
    payload.data.testMode === true;

  return valid
    ? { valid: true, code: 'VALID_HEALTH_CONTRACT' }
    : { valid: false, code: 'INVALID_HEALTH_CONTRACT' };
}

export function validateStateContract(payload, expectedFaultId) {
  const valid =
    typeof expectedFaultId === 'string' &&
    expectedFaultId.length > 0 &&
    hasExactKeys(payload, ['data', 'error']) &&
    payload.error === null &&
    hasExactKeys(payload.data, [
      'faultId',
      'orderCount',
      'orderRequestCount',
      'pendingOrderCount',
    ]) &&
    payload.data.faultId === expectedFaultId &&
    payload.data.orderCount === 0 &&
    payload.data.pendingOrderCount === 0 &&
    payload.data.orderRequestCount === 0;

  return valid
    ? { valid: true, code: 'VALID_STATE_CONTRACT' }
    : { valid: false, code: 'INVALID_STATE_CONTRACT' };
}

function appendErrorText(texts, error) {
  if (error === null || typeof error !== 'object') return;
  if (typeof error.message === 'string') texts.push(error.message);
  if (typeof error.stack === 'string') texts.push(error.stack);
}

function failedResult(testResult) {
  return ['failed', 'timedOut', 'interrupted'].includes(testResult?.status);
}

function collectFailures(report) {
  const failures = [];

  function visitSuite(suite, depth, inheritedFile, describeTitles) {
    if (suite === null || typeof suite !== 'object') return;
    const file = typeof suite.file === 'string' ? suite.file : inheritedFile;
    const nextDescribeTitles =
      depth > 0 && typeof suite.title === 'string' && suite.title.length > 0
        ? [...describeTitles, suite.title]
        : describeTitles;

    if (Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        if (spec === null || typeof spec !== 'object' || !Array.isArray(spec.tests)) continue;
        const specFile = typeof spec.file === 'string' ? spec.file : file;
        const specTitle = typeof spec.title === 'string' ? spec.title : '';

        for (const test of spec.tests) {
          if (test === null || typeof test !== 'object' || !Array.isArray(test.results)) continue;
          const failingResults = test.results.filter(failedResult);
          if (test.status !== 'unexpected' && failingResults.length === 0) continue;

          const texts = [];
          for (const result of failingResults) {
            appendErrorText(texts, result.error);
            if (Array.isArray(result.errors)) {
              for (const error of result.errors) appendErrorText(texts, error);
            }
          }

          const normalizedFile = typeof specFile === 'string' ? specFile.replaceAll('\\', '/') : '';
          failures.push({
            testId: [normalizedFile, ...nextDescribeTitles, specTitle].join(' › '),
            signatures: new Set(texts.flatMap((text) => text.match(RFG_SIGNATURE) ?? [])),
          });
        }
      }
    }

    if (Array.isArray(suite.suites)) {
      for (const child of suite.suites) {
        visitSuite(child, depth + 1, file, nextDescribeTitles);
      }
    }
  }

  for (const suite of report.suites) visitSuite(suite, 0, '', []);
  return failures;
}

function parseStrictReport(raw) {
  let summary;
  let report;
  try {
    summary = summarizePlaywrightJson(raw);
    report = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    report === null ||
    typeof report !== 'object' ||
    !Array.isArray(report.suites) ||
    summary === null ||
    typeof summary !== 'object' ||
    ['tests', 'passed', 'failed', 'retries', 'durationMs'].some(
      (field) => summary[field] === null,
    )
  ) {
    return null;
  }

  return { report, summary };
}

function normalizeFailureTestId(observedTestId, expectedTestId) {
  if (observedTestId === expectedTestId) return expectedTestId;

  const [observedFile, ...observedTitles] = observedTestId.split(' › ');
  const [expectedFile, ...expectedTitles] = expectedTestId.split(' › ');
  if (
    expectedFile === `tests/${observedFile}` &&
    observedTitles.length === expectedTitles.length &&
    observedTitles.every((title, index) => title === expectedTitles[index])
  ) {
    return expectedTestId;
  }

  return observedTestId;
}

export function classifyFaultReport(raw, mapping) {
  const parsed = parseStrictReport(raw);
  if (parsed === null) {
    return { detected: false, code: 'MALFORMED_PLAYWRIGHT_REPORT' };
  }

  if (parsed.summary.status === 'passed') {
    return { detected: false, code: 'EXPECTED_TEST_DID_NOT_FAIL' };
  }
  if (parsed.summary.retries !== 0) {
    return { detected: false, code: 'RETRIES_PRESENT' };
  }
  const failures = collectFailures(parsed.report);
  if (failures.length === 0) {
    return { detected: false, code: 'MALFORMED_PLAYWRIGHT_REPORT' };
  }
  if (failures.length > 1) {
    return { detected: false, code: 'MULTIPLE_TESTS_FAILED' };
  }
  if (
    parsed.summary.tests !== 1 ||
    parsed.summary.passed !== 0 ||
    parsed.summary.failed !== 1
  ) {
    return { detected: false, code: 'UNEXPECTED_TEST_COUNT' };
  }

  const [failure] = failures;
  const normalizedTestId = normalizeFailureTestId(
    failure.testId,
    mapping.testId,
  );
  if (normalizedTestId !== mapping.testId) {
    return { detected: false, code: 'UNEXPECTED_TEST_FAILED' };
  }

  if (failure.signatures.size === 0) {
    return { detected: false, code: 'EXPECTED_SIGNATURE_MISSING' };
  }
  if (failure.signatures.size > 1) {
    return { detected: false, code: 'MULTIPLE_REGRESSION_SIGNATURES' };
  }

  const [observedSignature] = failure.signatures;
  if (observedSignature !== mapping.expectedSignature) {
    return { detected: false, code: 'UNEXPECTED_REGRESSION_SIGNATURE' };
  }

  return {
    detected: true,
    code: 'EXPECTED_REGRESSION_DETECTED',
    testId: normalizedTestId,
    signature: observedSignature,
  };
}

const EXECUTION_FAILURE_CODES = Object.freeze({
  process_timeout: 'PROCESS_TIMEOUT',
  spawn_error: 'SPAWN_ERROR',
  browser_launch_error: 'BROWSER_LAUNCH_ERROR',
  fixture_error: 'FIXTURE_ERROR',
  server_exit: 'SERVER_EXITED',
});

export function classifyFaultRun({ mapping, report, execution }) {
  const failureCode = EXECUTION_FAILURE_CODES[execution?.kind];
  if (failureCode !== undefined) {
    return { detected: false, code: failureCode };
  }
  if (execution?.kind !== 'completed') {
    return { detected: false, code: 'FIXTURE_ERROR' };
  }
  return classifyFaultReport(report, mapping);
}

function directInvocation() {
  if (!process.argv[1]) return false;
  return basename(resolve(process.argv[1])) === 'prove-regressions.mjs';
}

function parseCliArguments(args) {
  if (args.length === 0) return {};
  if (
    args.length === 2 &&
    args[0] === '--expected-signature-override' &&
    args[1].length > 0
  ) {
    return { expectedSignatureOverride: args[1] };
  }

  throw new Error('REGRESSION_PROOF:invalid arguments');
}

async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  const root = resolve(dirname(resolve(process.argv[1])), '..');
  const { runRegressionProof } = await import(
    './lib/fault-orchestrator.mjs'
  );
  const proof = await runRegressionProof({ root, ...options });

  for (const fault of proof.faults) {
    process.stdout.write(`${fault.id}: ${fault.status}\n`);
  }
  if (proof.status !== 'passed') process.exitCode = 1;
}

if (directInvocation()) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Regression proof failed: ${message}\n`);
    process.exitCode = 1;
  });
}
