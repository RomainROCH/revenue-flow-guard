import { readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runProcess } from './lib/process.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'artifacts', 'internal-proof', 'baseline.json');
const proofPath = join(root, 'artifacts', 'internal-proof', 'regressions.json');

function childEnvironment() {
  const env = { ...process.env };
  delete env.RFG_EXTERNAL_BASE_URL;
  delete env.DEMO_TEST_TOKEN;
  delete env.DEMO_TEST_MODE;
  return env;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

function isPassingBaseline(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.status === 'passed' &&
    Number.isInteger(value.tests) &&
    value.tests > 0 &&
    value.passed === value.tests &&
    value.failed === 0 &&
    value.retries === 0 &&
    typeof value.durationMs === 'number' &&
    Number.isFinite(value.durationMs) &&
    value.durationMs >= 0
  );
}

function isPassingProof(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    value.status !== 'passed' ||
    !Array.isArray(value.faults) ||
    value.faults.length !== 6
  ) {
    return false;
  }

  return (
    new Set(value.faults.map((fault) => fault?.id)).size === 6 &&
    value.faults.every(
      (fault) =>
        fault !== null &&
        typeof fault === 'object' &&
        fault.status === 'detected' &&
        fault.code === 'EXPECTED_REGRESSION_DETECTED' &&
        fault.observedSignature === fault.expectedSignature,
    )
  );
}

async function executeScript(script, timeoutMs) {
  return runProcess({
    command: process.execPath,
    args: [join(root, 'scripts', script)],
    cwd: root,
    env: childEnvironment(),
    timeoutMs,
    maxStdoutBytes: 1_048_576,
  });
}

async function verifyQuality() {
  await rm(proofPath, { force: true });

  const baselineExecution = await executeScript('run-baseline.mjs', 120_000);
  const baseline = await readJson(baselinePath);
  if (
    baselineExecution.kind !== 'exit' ||
    baselineExecution.exitCode !== 0 ||
    baselineExecution.stdoutTruncated ||
    !isPassingBaseline(baseline)
  ) {
    throw new Error('baseline gate failed');
  }

  const proofExecution = await executeScript('prove-regressions.mjs', 420_000);
  const proof = await readJson(proofPath);
  if (
    proofExecution.kind !== 'exit' ||
    proofExecution.exitCode !== 0 ||
    proofExecution.stdoutTruncated ||
    !isPassingProof(proof)
  ) {
    throw new Error('regression proof gate failed');
  }

  process.stdout.write(
    `Quality verified: ${baseline.tests} baseline tests; 6 regression signatures detected.\n`,
  );
}

verifyQuality().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Quality verification failed: ${message}\n`);
  process.exitCode = 1;
});
