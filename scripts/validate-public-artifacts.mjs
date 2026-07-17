import { spawn } from 'node:child_process';
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
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

async function validateDownloaded(root) {
  try {
    const publicEvidenceDir = path.join(root, 'public-evidence');
    const validationDir = path.join(root, 'validation');
    const commitSha = await runGit(['rev-parse', 'HEAD']);

    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new Error('downloaded root is not a directory or is a symlink');
    }
    const rootEntries = (await readdir(root)).sort();
    if (JSON.stringify(rootEntries) !== JSON.stringify(['public-evidence', 'validation'])) {
      throw new Error('downloaded root contains unexpected entries');
    }

    for (const dir of [publicEvidenceDir, validationDir]) {
      const stats = await lstat(dir);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error('directory is missing, not a directory, or a symlink');
      }
    }

    const validationEntries = (await readdir(validationDir)).sort();
    if (JSON.stringify(validationEntries) !== JSON.stringify(['secret-scan.json'])) {
      throw new Error('validation directory contains unexpected files');
    }

    await scanPublicEvidenceDirectory({
      directory: publicEvidenceDir,
      trackedFiles: [],
      allowlist: [],
      commitSha,
    });

    const evidencePath = path.join(publicEvidenceDir, 'evidence.json');
    const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
    const validation = validatePublicEvidence(evidence, { currentCommitSha: commitSha });
    if (!validation.valid || evidence.complete !== true || evidence.sanitized !== true) {
      throw new Error('downloaded evidence is invalid, incomplete, or not yet sanitized');
    }

    const summaryPath = path.join(publicEvidenceDir, 'summary.html');
    const summaryContent = await readFile(summaryPath, 'utf8');
    if (summaryContent !== renderPublicSummary(evidence)) {
      throw new Error('downloaded summary does not match rendered evidence');
    }

    const scanPath = path.join(validationDir, 'secret-scan.json');
    const scanStats = await lstat(scanPath);
    if (!scanStats.isFile() || scanStats.isSymbolicLink() || scanStats.size > 1_048_576) {
      throw new Error('secret-scan.json is invalid, a symlink, or too large');
    }
    const scanBytes = await readFile(scanPath);
    if (scanBytes.includes(0)) {
      throw new Error('secret-scan.json contains binary content');
    }
    let scanReport;
    try {
      scanReport = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(scanBytes));
    } catch {
      throw new Error('secret-scan.json is not valid UTF-8 or not valid JSON');
    }
    if (
      scanReport === null ||
      typeof scanReport !== 'object' ||
      Array.isArray(scanReport) ||
      JSON.stringify(Object.keys(scanReport).sort()) !==
        JSON.stringify(['commitSha', 'matches', 'scannedFiles', 'validatorVersion']) ||
      scanReport.commitSha !== commitSha ||
      !Number.isSafeInteger(scanReport.scannedFiles) ||
      scanReport.scannedFiles <= 0 ||
      scanReport.matches !== 0 ||
      scanReport.validatorVersion !== 'secret-scanner-v1'
    ) {
      throw new Error('secret scan report is structurally invalid');
    }

    process.stdout.write('Downloaded public evidence validated.\n');
  } catch (error) {
    process.stderr.write(
      `Downloaded public evidence validation failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exitCode = 1;
  }
}

async function main() {
  const downloadedRoot = process.argv[2];
  const extraPositional = process.argv.slice(3);

  if (downloadedRoot !== undefined) {
    if (extraPositional.length > 0) {
      process.stderr.write(
        'validate-public-artifacts.mjs accepts at most one positional argument.\n',
      );
      process.exitCode = 1;
      return;
    }
    await validateDownloaded(downloadedRoot);
    return;
  }

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
