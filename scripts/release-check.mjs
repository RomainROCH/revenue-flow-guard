import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runProcess } from './lib/process.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const NPM = process.platform === 'win32' ? 'cmd.exe' : 'npm';
const NPM_ARGS_PREFIX = process.platform === 'win32' ? ['/c', 'npm.cmd'] : [];
const GIT = process.platform === 'win32' ? 'git.exe' : 'git';

function parseRoot(argv) {
  if (argv.length === 0) {
    return resolve(SCRIPT_DIR, '..');
  }
  if (argv.length !== 2 || argv[0] !== '--root') {
    process.stderr.write('usage: release-check.mjs [--root <absolute path>]\n');
    process.exit(1);
  }
  if (!isAbsolute(argv[1])) {
    process.stderr.write('--root must be an absolute path\n');
    process.exit(1);
  }
  return resolve(argv[1]);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function checkResult(result, label) {
  if (result.kind === 'spawn_error') {
    fail(`Failed to spawn: ${label}`);
  }
  if (result.kind === 'timeout') {
    fail(`Timed out: ${label}`);
  }
  if (result.kind === 'exit') {
    if (result.signal !== null) {
      fail(`Killed by signal ${result.signal}: ${label}`);
    }
    if (result.exitCode !== 0) {
        const output = result.stdout.trim();
        if (output) process.stderr.write(`${output}\n`);
        const diag = result.stderr?.trim();
        if (diag) process.stderr.write(`${diag}\n`);
        fail(`npm run ${label}`);
      }
      if (result.stdoutTruncated) {
        fail(`Truncated stdout: ${label}`);
      }
      if (result.stderrTruncated) {
        fail(`Truncated stderr: ${label}`);
      }
  }
}

async function runNpm(scriptName, cwd, env) {
  const result = await runProcess({
    command: NPM,
    args: [...NPM_ARGS_PREFIX, 'run', scriptName],
    cwd,
    env,
    timeoutMs: 300_000,
  });
  checkResult(result, scriptName);
}

const CANONICAL_SCRIPTS = [
  'lint',
  'typecheck',
  'test:repeat',
  'verify:quality',
  'build:evidence',
  'validate:public-artifacts',
  'scan:secrets',
  'validate:docs',
  'validate:repo',
  'validate:workflows',
];

async function main() {
  const root = parseRoot(process.argv.slice(2));

  const baseEnv = { ...process.env };

  for (const script of CANONICAL_SCRIPTS) {
    const env = { ...baseEnv };
    if (script === 'build:evidence') {
      env.RFG_REQUIRED_GATES_PASSED = 'true';
    }
    await runNpm(script, root, env);
  }

  const gitStatusResult = await runProcess({
    command: GIT,
    args: ['status', '--porcelain', '--untracked-files=all'],
    cwd: root,
    env: baseEnv,
    timeoutMs: 30_000,
  });
  if (gitStatusResult.kind === 'spawn_error') {
    fail('Failed to spawn git status');
  }
  if (gitStatusResult.kind === 'timeout') {
    fail('Timed out: git status');
  }
  if (gitStatusResult.kind === 'exit') {
    if (gitStatusResult.signal !== null) {
      fail(`Killed by signal ${gitStatusResult.signal}: git status`);
    }
    if (gitStatusResult.exitCode !== 0) {
      fail(`git status exited with code ${gitStatusResult.exitCode}`);
    }
    if (gitStatusResult.stdoutTruncated) {
      fail('Truncated stdout: git status');
    }
    if (gitStatusResult.stderrTruncated) {
      fail('Truncated stderr: git status');
    }
    const output = gitStatusResult.stdout.trim();
    if (output.length > 0) {
      process.stderr.write(`${output}\n`);
      fail('git status: dirty worktree');
    }
  }

  const fsckResult = await runProcess({
    command: GIT,
    args: ['fsck', '--no-dangling'],
    cwd: root,
    env: baseEnv,
    timeoutMs: 30_000,
  });
  if (fsckResult.kind === 'spawn_error') {
    fail('Failed to spawn git fsck');
  }
  if (fsckResult.kind === 'timeout') {
    fail('Timed out: git fsck');
  }
  if (fsckResult.kind === 'exit') {
    if (fsckResult.signal !== null) {
      fail(`Killed by signal ${fsckResult.signal}: git fsck`);
    }
    if (fsckResult.exitCode !== 0) {
      const output = fsckResult.stdout.trim();
      if (output) process.stderr.write(`${output}\n`);
      const diag = fsckResult.stderr?.trim();
      if (diag) process.stderr.write(`${diag}\n`);
      fail('git fsck: repository integrity check failed');
    }
    if (fsckResult.stdoutTruncated) {
      fail('Truncated stdout: git fsck');
    }
    if (fsckResult.stderrTruncated) {
      fail('Truncated stderr: git fsck');
    }
  }

  const publicationInputsResult = await runProcess({
    command: NPM,
    args: [...NPM_ARGS_PREFIX, 'run', 'validate:publication-inputs'],
    cwd: root,
    env: baseEnv,
    timeoutMs: 30_000,
  });
  if (publicationInputsResult.kind === 'spawn_error') {
    fail('Failed to spawn validate:publication-inputs');
  }
  if (publicationInputsResult.kind === 'timeout') {
    fail('Timed out: validate:publication-inputs');
  }
  if (publicationInputsResult.kind === 'exit') {
    if (publicationInputsResult.signal !== null) {
      fail(`Killed by signal ${publicationInputsResult.signal}: validate:publication-inputs`);
    }
    if (publicationInputsResult.exitCode !== 0) {
      const output = publicationInputsResult.stdout.trim();
      if (output) process.stderr.write(`${output}\n`);
      const diag = publicationInputsResult.stderr?.trim();
      if (diag) process.stderr.write(`${diag}\n`);
      fail('npm run validate:publication-inputs');
    }
    if (publicationInputsResult.stdoutTruncated) {
      fail('Truncated stdout: validate:publication-inputs');
    }
    if (publicationInputsResult.stderrTruncated) {
      fail('Truncated stderr: validate:publication-inputs');
    }
  }

  const publicUrl = baseEnv.PUBLIC_URL;
  if (publicUrl && typeof publicUrl === 'string' && publicUrl.length > 0) {
    await runNpm('test:public', root, baseEnv);
  }

  process.stdout.write('Release check passed.\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
