const EXPECTED_FAULT_COUNT = 6;
const EXPECTED_FAULT_IDS = new Set([
  'AUTH_BYPASS',
  'CLIENT_PRICE_TRUST',
  'DUPLICATE_ORDER',
  'EMPTY_CART_ACCEPTED',
  'PAYMENT_DECLINE_HIDDEN',
  'SUBMIT_CONTROL_MISSING',
]);
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const SIGNATURE_PATTERN = /^RFG:[A-Z0-9_]+:[A-Z0-9_]+$/;

function hasExactKeys(value, expectedKeys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort())
  );
}

function isIsoDate(value) {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validCiSource(source) {
  const local = source.ciRunId === null && source.ciRunUrl === null;
  if (local) return true;
  if (
    typeof source.ciRunId !== 'string' ||
    !/^[1-9]\d*$/.test(source.ciRunId) ||
    typeof source.ciRunUrl !== 'string'
  ) {
    return false;
  }
  try {
    const url = new URL(source.ciRunUrl);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      url.pathname.endsWith(`/actions/runs/${source.ciRunId}`)
    );
  } catch {
    return false;
  }
}

function validBaselineInput(baseline) {
  return (
    baseline !== null &&
    typeof baseline === 'object' &&
    baseline.status === 'passed' &&
    isNonNegativeInteger(baseline.tests) &&
    baseline.tests > 0 &&
    isNonNegativeInteger(baseline.passed) &&
    baseline.passed === baseline.tests &&
    baseline.failed === 0 &&
    baseline.retries === 0 &&
    isNonNegativeNumber(baseline.durationMs)
  );
}

function validRegressionFault(fault) {
  return (
    fault !== null &&
    typeof fault === 'object' &&
    typeof fault.id === 'string' &&
    /^[A-Z0-9_]+$/.test(fault.id) &&
    typeof fault.testId === 'string' &&
    fault.testId.includes(' › ') &&
    typeof fault.expectedSignature === 'string' &&
    SIGNATURE_PATTERN.test(fault.expectedSignature) &&
    fault.observedSignature === fault.expectedSignature &&
    fault.status === 'detected'
  );
}

function validRegressionInput(regressions) {
  if (
    regressions === null ||
    typeof regressions !== 'object' ||
    regressions.status !== 'passed' ||
    !Array.isArray(regressions.faults) ||
    regressions.faults.length !== EXPECTED_FAULT_COUNT ||
    !regressions.faults.every(validRegressionFault)
  ) {
    return false;
  }

  return (
    regressions.faults.every((fault) => EXPECTED_FAULT_IDS.has(fault.id)) &&
    ['id', 'testId', 'expectedSignature'].every(
      (field) =>
        new Set(regressions.faults.map((fault) => fault[field])).size === EXPECTED_FAULT_COUNT,
    )
  );
}

function unavailableBaseline() {
  return {
    status: 'unavailable',
    tests: null,
    retries: null,
    durationMs: null,
  };
}

export function buildPublicEvidence({
  baseline,
  regressions,
  commitSha,
  ciRunId = null,
  ciRunUrl = null,
  generatedAt,
}) {
  const complete = validBaselineInput(baseline) && validRegressionInput(regressions);
  return {
    schemaVersion: 1,
    source: { commitSha, ciRunId, ciRunUrl },
    generatedAt,
    complete,
    sanitized: false,
    baseline: complete
      ? {
          status: 'passed',
          tests: baseline.tests,
          retries: baseline.retries,
          durationMs: baseline.durationMs,
        }
      : unavailableBaseline(),
    faults: complete
      ? regressions.faults.map(
          ({ id, testId, expectedSignature, observedSignature, status }) => ({
          id,
          testId,
          expectedSignature,
          observedSignature,
          status,
          }),
        )
      : [],
  };
}

function validSource(source) {
  return (
    hasExactKeys(source, ['ciRunId', 'ciRunUrl', 'commitSha']) &&
    typeof source.commitSha === 'string' &&
    SHA_PATTERN.test(source.commitSha) &&
    validCiSource(source)
  );
}

function validPublishedBaseline(baseline, complete) {
  if (!hasExactKeys(baseline, ['durationMs', 'retries', 'status', 'tests'])) return false;
  if (!complete) {
    return (
      baseline.status === 'unavailable' &&
      baseline.tests === null &&
      baseline.retries === null &&
      baseline.durationMs === null
    );
  }
  return (
    baseline.status === 'passed' &&
    isNonNegativeInteger(baseline.tests) &&
    baseline.tests > 0 &&
    baseline.retries === 0 &&
    isNonNegativeNumber(baseline.durationMs)
  );
}

function validPublishedFault(fault) {
  return (
    hasExactKeys(fault, [
      'expectedSignature',
      'id',
      'observedSignature',
      'status',
      'testId',
    ]) &&
    validRegressionFault(fault)
  );
}

export function validatePublicEvidence(evidence, { currentCommitSha } = {}) {
  if (evidence?.schemaVersion !== 1) {
    return { valid: false, code: 'UNSUPPORTED_PUBLIC_EVIDENCE_SCHEMA' };
  }
  if (evidence?.source?.commitSha !== currentCommitSha) {
    return { valid: false, code: 'PUBLIC_EVIDENCE_COMMIT_MISMATCH' };
  }

  const rootValid =
    hasExactKeys(evidence, [
      'baseline',
      'complete',
      'faults',
      'generatedAt',
      'sanitized',
      'schemaVersion',
      'source',
    ]) &&
    validSource(evidence.source) &&
    isIsoDate(evidence.generatedAt) &&
    typeof evidence.complete === 'boolean' &&
    typeof evidence.sanitized === 'boolean' &&
    validPublishedBaseline(evidence.baseline, evidence.complete) &&
    Array.isArray(evidence.faults);

  if (!rootValid) return { valid: false, code: 'INVALID_PUBLIC_EVIDENCE' };
  if (!evidence.complete) {
    return evidence.sanitized === false && evidence.faults.length === 0
      ? { valid: true, code: 'VALID_PUBLIC_EVIDENCE' }
      : { valid: false, code: 'INVALID_PUBLIC_EVIDENCE' };
  }

  if (
    evidence.faults.length !== EXPECTED_FAULT_COUNT ||
    !evidence.faults.every(validPublishedFault) ||
    !evidence.faults.every((fault) => EXPECTED_FAULT_IDS.has(fault.id)) ||
    !['id', 'testId', 'expectedSignature'].every(
      (field) =>
        new Set(evidence.faults.map((fault) => fault[field])).size === EXPECTED_FAULT_COUNT,
    )
  ) {
    return { valid: false, code: 'INVALID_PUBLIC_EVIDENCE' };
  }
  return { valid: true, code: 'VALID_PUBLIC_EVIDENCE' };
}
function escapePublicHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderPublicSummary(evidence) {
  const verified = evidence.complete === true && evidence.sanitized === true;
  const result = verified
    ? `<p><strong>${escapePublicHtml(evidence.baseline.tests)} baseline tests passed with zero retries.</strong></p>
       <p><strong>${escapePublicHtml(evidence.faults.length)} of ${escapePublicHtml(evidence.faults.length)} synthetic regressions were detected.</strong></p>
       <ul>${evidence.faults.map((fault) => `<li>${escapePublicHtml(fault.id)} — ${escapePublicHtml(fault.observedSignature)}</li>`).join('')}</ul>`
    : '<p><strong>Evidence unavailable or incomplete.</strong></p><p>No success totals are published until validation and sanitization both pass.</p>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Revenue Flow Guard evidence</title>
</head>
<body>
  <main>
    <h1>Revenue Flow Guard evidence</h1>
    <p>This report demonstrates deterministic detection of deliberately injected synthetic faults in the demo application. It is not production-customer evidence.</p>
    ${result}
    <p>Commit: <code>${escapePublicHtml(evidence.source.commitSha)}</code></p>
  </main>
</body>
</html>
`;
}
