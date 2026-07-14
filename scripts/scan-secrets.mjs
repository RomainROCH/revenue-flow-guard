import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  scanPublicEvidenceDirectory,
  validateSecretAllowlist,
} from './lib/secret-scanner.mjs';

const VALIDATOR_VERSION = 'secret-scanner-v1';
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDirectory = path.join(repoRoot, 'artifacts', 'public-evidence');
const validationDirectory = path.join(repoRoot, 'artifacts', 'validation');
const reportPath = path.join(validationDirectory, 'secret-scan.json');
const allowlistPath = path.join(repoRoot, 'scripts', 'secret-scan-allowlist.json');

function runGit(args, { binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repoRoot,
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    const chunks = [];
    let size = 0;
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) child.kill();
      else chunks.push(chunk);
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) reject(new Error(`git exited with code ${code}`));
      else {
        const output = Buffer.concat(chunks);
        resolve(binary ? output : output.toString('utf8').trim());
      }
    });
  });
}

function isForbiddenEnvironmentPath(relativePath) {
  const name = path.posix.basename(relativePath.replaceAll('\\', '/'));
  return name.startsWith('.env') && name !== '.env.example';
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function passesLuhn(value) {
  let sum = 0;
  let doubleDigit = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function repositoryCandidates(text) {
  const candidates = [];
  const markers = [
    ['ghp', '_'].join(''),
    ['github', '_pat_'].join(''),
    ['sk', '-proj-'].join(''),
    ['sk', '_live_'].join(''),
    ['xoxb', '-'].join(''),
    ['rfg', '_test_control_token_'].join(''),
  ];
  for (const marker of markers) {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const expression = new RegExp(`${escaped}[A-Za-z0-9_-]{16,}`, 'g');
    for (const match of text.matchAll(expression)) candidates.push(match[0]);
  }

  const privateKeyMarker = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
  if (text.includes(privateKeyMarker)) candidates.push(privateKeyMarker);

  const cookieMarker = ['rfg', '_session='].join('');
  const cookieExpression = new RegExp(`${cookieMarker}[A-Za-z0-9._~-]{8,}`, 'g');
  for (const match of text.matchAll(cookieExpression)) candidates.push(match[0]);

  for (const match of text.matchAll(/(?<!\d)\d{13,19}(?!\d)/g)) {
    if (passesLuhn(match[0])) candidates.push(match[0]);
  }
  return candidates;
}

function scanRepositoryText(text, allowedHashes) {
  return repositoryCandidates(text).filter((value) => !allowedHashes.has(sha256(value))).length;
}

async function scanTrackedFiles(trackedFiles, allowedHashes) {
  let scannedFiles = 0;
  let matches = 0;
  for (const relativePath of trackedFiles) {
    if (!relativePath) continue;
    if (isForbiddenEnvironmentPath(relativePath)) {
      throw new Error(`tracked environment file is forbidden: ${relativePath}`);
    }
    const absolutePath = path.resolve(repoRoot, relativePath);
    const relativeCheck = path.relative(repoRoot, absolutePath);
    if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
      throw new Error('git returned a path outside the repository');
    }
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) throw new Error(`tracked symbolic link is forbidden: ${relativePath}`);
    if (!stats.isFile()) throw new Error(`tracked non-file entry is forbidden: ${relativePath}`);
    if (stats.size > MAX_FILE_BYTES) continue;

    const buffer = await readFile(absolutePath);
    if (buffer.includes(0)) continue;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    scannedFiles += 1;
    matches += scanRepositoryText(text, allowedHashes);
  }
  return { scannedFiles, matches };
}

async function main() {
  await mkdir(validationDirectory, { recursive: true });
  await rm(reportPath, { force: true });

  const now = new Date().toISOString();
  const allowlistRaw = JSON.parse(await readFile(allowlistPath, 'utf8'));
  const validatedAllowlist = validateSecretAllowlist(allowlistRaw, { now });
  const allowedHashes = new Set(validatedAllowlist.map((entry) => entry.sha256));
  const [commitSha, trackedBuffer] = await Promise.all([
    runGit(['rev-parse', 'HEAD']),
    runGit(['ls-files', '-z'], { binary: true }),
  ]);
  const trackedFiles = trackedBuffer.toString('utf8').split('\0').filter(Boolean);
  const repositoryResult = await scanTrackedFiles(trackedFiles, allowedHashes);
  if (repositoryResult.matches !== 0) {
    throw new Error(`repository secret scan found ${repositoryResult.matches} match(es)`);
  }

  const publicResult = await scanPublicEvidenceDirectory({
    directory: publicDirectory,
    trackedFiles,
    allowlist: [],
    commitSha,
    now,
  });
  const report = {
    commitSha,
    scannedFiles: repositoryResult.scannedFiles + publicResult.scannedFiles,
    matches: 0,
    validatorVersion: VALIDATOR_VERSION,
  };
  const temporaryPath = `${reportPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  await rename(temporaryPath, reportPath);
  process.stdout.write(`Secret scan passed for ${report.scannedFiles} files.\n`);
}

main().catch(async () => {
  // Findings may themselves contain credentials. Keep values out of terminal
  // output and rely on the non-zero exit plus deliberately absent artifacts.
  await Promise.all([
    rm(reportPath, { force: true }),
    rm(publicDirectory, { recursive: true, force: true }),
  ]).catch(() => {});
  process.stderr.write('Secret scan failed; no validation report was written.\n');
  process.exitCode = 1;
});
