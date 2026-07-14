import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPublicEvidence, renderPublicSummary } from './lib/public-evidence.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const internalDirectory = path.join(repoRoot, 'artifacts', 'internal-proof');
const publicDirectory = path.join(repoRoot, 'artifacts', 'public-evidence');

function runGit(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repoRoot,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) child.kill();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > 64 * 1024) child.kill();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`git exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

async function readInternalJson(fileName) {
  try {
    return JSON.parse(await readFile(path.join(internalDirectory, fileName), 'utf8'));
  } catch {
    return null;
  }
}

function githubMetadata() {
  const runId = process.env.GITHUB_RUN_ID?.trim();
  const server = process.env.GITHUB_SERVER_URL?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (!runId || !/^[1-9]\d*$/.test(runId) || !server || !repository) {
    return { ciRunId: null, ciRunUrl: null };
  }

  try {
    const base = new URL(server);
    if (
      base.protocol !== 'https:' ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== '' && base.pathname !== '/'
    ) {
      return { ciRunId: null, ciRunUrl: null };
    }
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
      return { ciRunId: null, ciRunUrl: null };
    }
    return {
      ciRunId: runId,
      ciRunUrl: `${base.origin}/${repository}/actions/runs/${runId}`,
    };
  } catch {
    return { ciRunId: null, ciRunUrl: null };
  }
}

async function writeAtomic(filePath, content) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function main() {
  const commitSha = await runGit(['rev-parse', 'HEAD']);
  const requiredGatesPassed =
    process.env.RFG_REQUIRED_GATES_PASSED === undefined ||
    process.env.RFG_REQUIRED_GATES_PASSED === 'true';
  const [baseline, regressions] = requiredGatesPassed
    ? await Promise.all([
        readInternalJson('baseline.json'),
        readInternalJson('regressions.json'),
      ])
    : [null, null];
  const metadata = githubMetadata();
  const evidence = buildPublicEvidence({
    baseline,
    regressions,
    commitSha,
    ...metadata,
    generatedAt: new Date().toISOString(),
  });

  // A build always starts from an untrusted candidate. Only the independent
  // public-artifact validator may promote `sanitized` to true.
  evidence.sanitized = false;

  await rm(publicDirectory, { recursive: true, force: true });
  await mkdir(publicDirectory, { recursive: true });
  try {
    await Promise.all([
      writeAtomic(
        path.join(publicDirectory, 'evidence.json'),
        `${JSON.stringify(evidence, null, 2)}\n`,
      ),
      writeAtomic(path.join(publicDirectory, 'summary.html'), renderPublicSummary(evidence)),
    ]);
  } catch (error) {
    await rm(publicDirectory, { recursive: true, force: true });
    throw error;
  }

  process.stdout.write(
    evidence.complete
      ? 'Built an unvalidated complete evidence candidate.\n'
      : 'Built an incomplete fail-closed evidence candidate.\n',
  );
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Evidence build failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}
