import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import { startManagedProcess, runProcess } from './process.mjs';
import {
  classifyFaultRun,
  validateHealthContract,
  validateStateContract,
} from '../prove-regressions.mjs';
import {
  loadRegressionManifest,
  validateRegressionManifest,
} from '../validate-regression-manifest.mjs';

const LOOPBACK_HOST = '127.0.0.1';
const HEALTH_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 1_000;
const PLAYWRIGHT_TIMEOUT_MS = 60_000;
const REPORT_LIMIT_BYTES = 4 * 1_048_576;
const SIGNATURE_PATTERN = /RFG:[A-Z0-9_]+:[A-Z0-9][A-Z0-9_.-]*/g;

class InfrastructureFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => {
    const timer = setTimeout(resolveDelay, milliseconds);
    timer.unref?.();
  });
}

function hasExactKeys(value, expectedKeys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort())
  );
}

function reserveLoopbackPort() {
  return new Promise((resolvePort, reject) => {
    const reservation = createServer();
    reservation.unref();
    reservation.once('error', reject);
    reservation.listen(0, LOOPBACK_HOST, () => {
      const address = reservation.address();
      if (address === null || typeof address === 'string') {
        reservation.close(() => reject(new InfrastructureFailure('PORT_RESERVATION_FAILED')));
        return;
      }
      reservation.close((error) => {
        if (error) reject(error);
        else resolvePort(address.port);
      });
    });
  });
}

async function readJsonResponse(response, expectedStatus, failureCode) {
  if (response.status !== expectedStatus) throw new InfrastructureFailure(failureCode);
  try {
    return await response.json();
  } catch {
    throw new InfrastructureFailure(failureCode);
  }
}

function controlledFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function waitForHealthyServer(baseUrl, server) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (server.exited) throw new InfrastructureFailure('SERVER_EXITED');
    try {
      const response = await controlledFetch(`${baseUrl}/api/health`);
      const payload = await readJsonResponse(response, 200, 'INVALID_HEALTH_CONTRACT');
      if (!validateHealthContract(payload).valid) {
        throw new InfrastructureFailure('INVALID_HEALTH_CONTRACT');
      }
      return;
    } catch (error) {
      if (error instanceof InfrastructureFailure) throw error;
      await delay(100);
    }
  }
  throw new InfrastructureFailure('HEALTH_TIMEOUT');
}

async function activateAndVerifyFault(baseUrl, token, faultId) {
  const headers = {
    'Content-Type': 'application/json',
    'X-RFG-Test-Token': token,
  };
  const activationResponse = await controlledFetch(`${baseUrl}/__test/fault`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ faultId }),
  });
  const activation = await readJsonResponse(
    activationResponse,
    200,
    'FAULT_ACTIVATION_FAILED',
  );
  if (
    !hasExactKeys(activation, ['data', 'error']) ||
    activation.error !== null ||
    !hasExactKeys(activation.data, ['faultId']) ||
    activation.data.faultId !== faultId
  ) {
    throw new InfrastructureFailure('FAULT_ACTIVATION_FAILED');
  }

  const stateResponse = await controlledFetch(`${baseUrl}/__test/state`, {
    headers,
  });
  const state = await readJsonResponse(stateResponse, 200, 'INVALID_STATE_CONTRACT');
  if (!validateStateContract(state, faultId).valid) {
    throw new InfrastructureFailure('INVALID_STATE_CONTRACT');
  }
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function playwrightEnvironment(baseUrl) {
  const {
    DEMO_TEST_MODE: _testMode,
    DEMO_TEST_TOKEN: _testToken,
    HOST: _host,
    PORT: _port,
    PUBLIC_BASE_URL: _publicBaseUrl,
    RFG_EXTERNAL_BASE_URL: _externalBaseUrl,
    ...safeEnvironment
  } = process.env;
  return { ...safeEnvironment, RFG_EXTERNAL_BASE_URL: baseUrl };
}

function executionFailure(kind) {
  return { mapping: null, report: '', execution: { kind } };
}

function inspectReporterFailure(raw) {
  if (/browserType\.launch|Executable doesn't exist|browser executable/i.test(raw)) {
    return 'browser_launch_error';
  }
  try {
    const report = JSON.parse(raw);
    if (Array.isArray(report?.errors) && report.errors.length > 0) return 'fixture_error';
  } catch {
    return null;
  }
  return null;
}

function observedSignature(raw) {
  const signatures = new Set(raw.match(SIGNATURE_PATTERN) ?? []);
  return signatures.size === 1 ? [...signatures][0] : null;
}

function statusForClassification(classification) {
  if (classification.detected) return 'detected';
  if (
    classification.code === 'UNEXPECTED_REGRESSION_SIGNATURE' ||
    classification.code === 'EXPECTED_SIGNATURE_MISSING' ||
    classification.code === 'MULTIPLE_REGRESSION_SIGNATURES'
  ) {
    return 'signature_mismatch';
  }
  if (classification.code === 'EXPECTED_TEST_DID_NOT_FAIL') return 'not_detected';
  if (
    classification.code === 'UNEXPECTED_TEST_FAILED' ||
    classification.code === 'MULTIPLE_TESTS_FAILED'
  ) {
    return 'unexpected_failure';
  }
  return 'infrastructure_failure';
}

function sanitizedFault(mapping, classification, raw = '') {
  return {
    id: mapping.id,
    testId: mapping.testId,
    expectedSignature: mapping.expectedSignature,
    status: statusForClassification(classification),
    observedSignature: classification.detected
      ? classification.signature
      : observedSignature(raw),
    code: classification.code,
  };
}

function infrastructureFault(mapping, code) {
  return {
    id: mapping.id,
    testId: mapping.testId,
    expectedSignature: mapping.expectedSignature,
    status: 'infrastructure_failure',
    observedSignature: null,
    code,
  };
}

async function runMappedFault(root, mapping) {
  const port = await reserveLoopbackPort();
  const baseUrl = `http://${LOOPBACK_HOST}:${port}`;
  const token = randomBytes(32).toString('hex');
  const server = startManagedProcess({
    command: process.execPath,
    args: [join(root, 'server.js')],
    cwd: root,
    env: {
      ...process.env,
      HOST: LOOPBACK_HOST,
      PORT: String(port),
      PUBLIC_BASE_URL: baseUrl,
      DEMO_TEST_MODE: '1',
      DEMO_TEST_TOKEN: token,
    },
    maxStdoutBytes: 64 * 1_024,
  });

  if (server.kind === 'spawn_error') {
    return infrastructureFault(mapping, 'SPAWN_ERROR');
  }

  try {
    await waitForHealthyServer(baseUrl, server);
    await activateAndVerifyFault(baseUrl, token, mapping.id);

    const finalTitle = mapping.testId.split(' › ').at(-1);
    const playwright = await runProcess({
      command: process.execPath,
      args: [
        join(root, 'node_modules', '@playwright', 'test', 'cli.js'),
        'test',
        mapping.testId.split(' › ')[0],
        '--grep',
        `${escapeRegularExpression(finalTitle)}$`,
        '--project=chromium',
        '--reporter=json',
        '--retries=0',
        '--workers=1',
      ],
      cwd: root,
      env: playwrightEnvironment(baseUrl),
      timeoutMs: PLAYWRIGHT_TIMEOUT_MS,
      maxStdoutBytes: REPORT_LIMIT_BYTES,
    });

    if (server.exited) {
      const classification = classifyFaultRun({
        ...executionFailure('server_exit'),
        mapping,
      });
      return sanitizedFault(mapping, classification);
    }
    if (playwright.kind === 'timeout') {
      const classification = classifyFaultRun({
        ...executionFailure('process_timeout'),
        mapping,
      });
      return sanitizedFault(mapping, classification);
    }
    if (playwright.kind === 'spawn_error') {
      const classification = classifyFaultRun({
        ...executionFailure('spawn_error'),
        mapping,
      });
      return sanitizedFault(mapping, classification);
    }
    if (playwright.stdoutTruncated) {
      return infrastructureFault(mapping, 'REPORT_TOO_LARGE');
    }

    const reporterFailure = inspectReporterFailure(playwright.stdout);
    if (reporterFailure !== null) {
      const classification = classifyFaultRun({
        ...executionFailure(reporterFailure),
        mapping,
      });
      return sanitizedFault(mapping, classification);
    }
    if (playwright.exitCode !== 0 && playwright.exitCode !== 1) {
      return infrastructureFault(mapping, 'UNEXPECTED_PROCESS_EXIT');
    }

    const classification = classifyFaultRun({
      mapping,
      report: playwright.stdout,
      execution: { kind: 'completed' },
    });
    if (
      (classification.detected && playwright.exitCode !== 1) ||
      (!classification.detected && playwright.exitCode === 1 &&
        classification.code === 'EXPECTED_TEST_DID_NOT_FAIL')
    ) {
      return infrastructureFault(mapping, 'AMBIGUOUS_PROCESS_EXIT');
    }
    return sanitizedFault(mapping, classification, playwright.stdout);
  } catch (error) {
    return infrastructureFault(
      mapping,
      error instanceof InfrastructureFailure ? error.code : 'FIXTURE_ERROR',
    );
  } finally {
    await server.stop();
  }
}

async function writeProofAtomically(root, proof) {
  const target = join(root, 'artifacts', 'internal-proof', 'regressions.json');
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify(proof, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function assertManifestValidation(validation) {
  if (validation === false || validation?.valid === false) {
    throw new InfrastructureFailure('INVALID_REGRESSION_MANIFEST');
  }
  if (Array.isArray(validation) && validation.length > 0) {
    throw new InfrastructureFailure('INVALID_REGRESSION_MANIFEST');
  }
}

export async function runRegressionProof({ root, expectedSignatureOverride } = {}) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new TypeError('REGRESSION_PROOF_ROOT_REQUIRED');
  }
  if (
    expectedSignatureOverride !== undefined &&
    (typeof expectedSignatureOverride !== 'string' ||
      expectedSignatureOverride.length === 0 ||
      expectedSignatureOverride.length > 200)
  ) {
    throw new TypeError('EXPECTED_SIGNATURE_OVERRIDE_INVALID');
  }

  const resolvedRoot = resolve(root);
  const manifest = await loadRegressionManifest(resolvedRoot);
  assertManifestValidation(
    await validateRegressionManifest(manifest, { root: resolvedRoot }),
  );

  const faults = [];
  for (const [index, entry] of manifest.entries.entries()) {
    const mapping = {
      ...entry,
      expectedSignature:
        index === 0 && expectedSignatureOverride !== undefined
          ? expectedSignatureOverride
          : entry.expectedSignature,
    };
    faults.push(await runMappedFault(resolvedRoot, mapping));
  }

  const proof = {
    schemaVersion: 1,
    status:
      faults.length === 6 && faults.every((fault) => fault.status === 'detected')
        ? 'passed'
        : 'failed',
    faults,
  };
  await writeProofAtomically(resolvedRoot, proof);
  return proof;
}
