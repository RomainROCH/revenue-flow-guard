'use strict';

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const CI_RUN_ID_PATTERN = /^[1-9][0-9]*$/;
const REQUIRED_FAULTS = Object.freeze({
  AUTH_BYPASS: Object.freeze({
    testId:
      'tests/api/catalog.spec.ts › GET /api/products requires a known session and leaks no catalogue data',
    expectedSignature: 'RFG:AUTH_BYPASS:AUTH_REQUIRED',
  }),
  CLIENT_PRICE_TRUST: Object.freeze({
    testId:
      'tests/api/orders.spec.ts › POST /api/orders enforces exact top-level and item fields and forbids client prices or totals',
    expectedSignature: 'RFG:CLIENT_PRICE_TRUST:CLIENT_AMOUNT_FORBIDDEN',
  }),
  DUPLICATE_ORDER: Object.freeze({
    testId:
      'tests/api/orders.spec.ts › a successful order uses canonical item order, server totals, an opaque id, and replays exactly once',
    expectedSignature: 'RFG:DUPLICATE_ORDER:IDEMPOTENT_REPLAY',
  }),
  EMPTY_CART_ACCEPTED: Object.freeze({
    testId:
      'tests/api/orders.spec.ts › POST /api/orders maps empty, duplicate, unknown, and invalid-quantity items to INVALID_ITEMS without stock changes',
    expectedSignature: 'RFG:EMPTY_CART_ACCEPTED:EMPTY_CART_REJECTED',
  }),
  PAYMENT_DECLINE_HIDDEN: Object.freeze({
    testId:
      'tests/ui/checkout.spec.ts › safe demonstration checkout › shows a declined-payment message, preserves the cart, and uses a new key for a new attempt',
    expectedSignature: 'RFG:PAYMENT_DECLINE_HIDDEN:DECLINE_VISIBLE',
  }),
  SUBMIT_CONTROL_MISSING: Object.freeze({
    testId:
      'tests/ui/checkout.spec.ts › safe demonstration checkout › disables every submission path while the first order is pending',
    expectedSignature: 'RFG:SUBMIT_CONTROL_MISSING:SUBMIT_DISABLED',
  }),
});
const REQUIRED_FAULT_IDS = Object.freeze(Object.keys(REQUIRED_FAULTS));

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isObject(value)) {
    return false;
  }

  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  return actualKeys.length === sortedExpectedKeys.length &&
    actualKeys.every((key, index) => key === sortedExpectedKeys[index]);
}

function isIsoTimestamp(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isValidCiSource(source) {
  if (source.ciRunId === null || source.ciRunUrl === null) {
    return source.ciRunId === null && source.ciRunUrl === null;
  }

  if (
    typeof source.ciRunId !== 'string' ||
    !CI_RUN_ID_PATTERN.test(source.ciRunId) ||
    typeof source.ciRunUrl !== 'string'
  ) {
    return false;
  }

  try {
    const url = new URL(source.ciRunUrl);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    return url.protocol === 'https:' &&
      url.hostname === 'github.com' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      pathSegments.length === 5 &&
      pathSegments[2] === 'actions' &&
      pathSegments[3] === 'runs' &&
      pathSegments[4] === source.ciRunId;
  } catch {
    return false;
  }
}

function isValidSource(source, currentCommitSha) {
  return hasExactKeys(source, ['commitSha', 'ciRunId', 'ciRunUrl']) &&
    COMMIT_SHA_PATTERN.test(source.commitSha) &&
    source.commitSha === currentCommitSha &&
    isValidCiSource(source);
}

function isValidBaseline(baseline) {
  return hasExactKeys(baseline, ['status', 'tests', 'retries', 'durationMs']) &&
    baseline.status === 'passed' &&
    Number.isSafeInteger(baseline.tests) &&
    baseline.tests > 0 &&
    baseline.retries === 0 &&
    typeof baseline.durationMs === 'number' &&
    Number.isFinite(baseline.durationMs) &&
    baseline.durationMs >= 0;
}

function isValidFault(fault) {
  if (
    !hasExactKeys(fault, [
      'id',
      'testId',
      'expectedSignature',
      'observedSignature',
      'status',
    ]) ||
    !Object.hasOwn(REQUIRED_FAULTS, fault.id)
  ) {
    return false;
  }

  const contract = REQUIRED_FAULTS[fault.id];
  return fault.testId === contract.testId &&
    fault.expectedSignature === contract.expectedSignature &&
    fault.observedSignature === contract.expectedSignature &&
    fault.status === 'detected';
}

function areValidFaults(faults) {
  if (!Array.isArray(faults) || faults.length !== REQUIRED_FAULT_IDS.length) {
    return false;
  }

  const ids = new Set();
  const testIds = new Set();
  const signatures = new Set();

  for (const fault of faults) {
    if (
      !isValidFault(fault) ||
      ids.has(fault.id) ||
      testIds.has(fault.testId) ||
      signatures.has(fault.expectedSignature)
    ) {
      return false;
    }

    ids.add(fault.id);
    testIds.add(fault.testId);
    signatures.add(fault.expectedSignature);
  }

  return REQUIRED_FAULT_IDS.every((id) => ids.has(id));
}

function isValidEvidence(evidence, currentCommitSha) {
  return hasExactKeys(evidence, [
    'schemaVersion',
    'complete',
    'sanitized',
    'source',
    'generatedAt',
    'baseline',
    'faults',
  ]) &&
    evidence.schemaVersion === 1 &&
    evidence.complete === true &&
    evidence.sanitized === true &&
    isValidSource(evidence.source, currentCommitSha) &&
    isIsoTimestamp(evidence.generatedAt) &&
    isValidBaseline(evidence.baseline) &&
    areValidFaults(evidence.faults);
}

function parsePublicEvidence(environment) {
  const currentCommitSha = environment?.SOURCE_COMMIT_SHA;
  const serializedEvidence = environment?.PUBLIC_EVIDENCE_JSON;

  if (
    typeof currentCommitSha !== 'string' ||
    !COMMIT_SHA_PATTERN.test(currentCommitSha) ||
    typeof serializedEvidence !== 'string'
  ) {
    return { available: false };
  }

  try {
    const evidence = JSON.parse(serializedEvidence);
    if (!isValidEvidence(evidence, currentCommitSha)) {
      return { available: false };
    }

    return { available: true, evidence };
  } catch {
    return { available: false };
  }
}

module.exports = { parsePublicEvidence };
