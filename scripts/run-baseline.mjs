import { spawn } from 'node:child_process';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { summarizePlaywrightJson } from './lib/playwright-json.mjs';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptsDirectory, '..');
const cliPath = path.join(projectRoot, 'node_modules', '@playwright', 'test', 'cli.js');
const artifactDirectory = path.join(projectRoot, 'artifacts', 'internal-proof');
const artifactPath = path.join(artifactDirectory, 'baseline.json');

function runPlaywright() {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.RFG_EXTERNAL_BASE_URL;
    const child = spawn(
      process.execPath,
      [cliPath, 'test', 'tests/api', 'tests/ui', '--reporter=json', '--retries=0'],
      {
        cwd: projectRoot,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );

    const stdout = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.on('error', () => resolve({ exitCode: null, stdout: '' }));
    child.on('close', (exitCode) => {
      resolve({ exitCode, stdout: Buffer.concat(stdout).toString('utf8') });
    });
  });
}

async function writeSummaryAtomically(summary) {
  await mkdir(artifactDirectory, { recursive: true });
  const temporaryPath = path.join(
    artifactDirectory,
    `.baseline-${process.pid}-${Date.now()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, `${JSON.stringify(summary, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await rename(temporaryPath, artifactPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function printSummary(summary, processPassed) {
  if (summary.tests === null) {
    console.log('Baseline failed: Playwright returned an invalid or incomplete JSON report.');
    return;
  }

  if (!processPassed) {
    console.log(
      `Baseline failed: ${summary.failed} of ${summary.tests} tests failed; ${summary.retries} retries.`,
    );
    return;
  }

  console.log(
    `Baseline passed: ${summary.tests} tests, ${summary.retries} retries, ${Math.round(summary.durationMs)} ms.`,
  );
}

const execution = await runPlaywright();
const summary = summarizePlaywrightJson(execution.stdout);
await writeSummaryAtomically(summary);

const passed = execution.exitCode === 0 && summary.status === 'passed';
printSummary(summary, passed);
if (!passed) {
  process.exitCode = 1;
}
