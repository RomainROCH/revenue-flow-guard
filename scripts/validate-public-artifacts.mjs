import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderPublicSummary, validatePublicEvidence } from './lib/public-evidence.mjs';
import { scanPublicEvidenceDirectory } from './lib/secret-scanner.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDirectory = path.join(repoRoot, 'artifacts');
const publicDirectory = path.join(artifactsDirectory, 'public-evidence');

function runGit(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repoRoot,
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) child.kill();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`git exited with code ${code}`));
    });
  });
}

async function main() {
  const commitSha = await runGit(['rev-parse', 'HEAD']);
  const candidate = JSON.parse(await readFile(path.join(publicDirectory, 'evidence.json'), 'utf8'));
  const validation = validatePublicEvidence(candidate, { currentCommitSha: commitSha });
  if (!validation.valid || candidate.sanitized !== false) {
    throw new Error('evidence candidate is invalid, stale, or already promoted');
  }
  if (candidate.complete !== true) {
    process.stderr.write(
      'Public evidence validation failed: safe incomplete evidence was preserved.\n',
    );
    process.exitCode = 1;
    return;
  }

  const stagingDirectory = path.join(
    artifactsDirectory,
    `.public-evidence-staging-${process.pid}-${Date.now()}`,
  );
  const promoted = { ...candidate, sanitized: true };

  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { recursive: false });
  try {
    await Promise.all([
      writeFile(
        path.join(stagingDirectory, 'evidence.json'),
        `${JSON.stringify(promoted, null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' },
      ),
      writeFile(path.join(stagingDirectory, 'summary.html'), renderPublicSummary(promoted), {
        encoding: 'utf8',
        flag: 'wx',
      }),
    ]);

    const promotedValidation = validatePublicEvidence(promoted, { currentCommitSha: commitSha });
    if (!promotedValidation.valid) throw new Error('promoted evidence is structurally invalid');
    await scanPublicEvidenceDirectory({
      directory: stagingDirectory,
      trackedFiles: [],
      allowlist: [],
      commitSha,
      now: new Date().toISOString(),
    });

    // The old directory contains only the unvalidated sanitized:false candidate.
    // It is removed only after the staged sanitized:true pair has passed every gate.
    await rm(publicDirectory, { recursive: true, force: true });
    await rename(stagingDirectory, publicDirectory);
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }

  process.stdout.write('Validated and sanitized public evidence.\n');
}

main().catch(async (error) => {
  // Never preserve a previously promoted result after a failed validation run.
  await rm(publicDirectory, { recursive: true, force: true }).catch(() => {});
  process.stderr.write(`Public evidence validation failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
  process.exitCode = 1;
});
