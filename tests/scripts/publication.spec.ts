import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '..', '..');
const validator = resolve(repositoryRoot, 'scripts', 'validate-publication-inputs.mjs');

async function removeTempDir(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

const REQUIRED_KEYS = [
  'approvedBy', 'approvedAt', 'repository', 'visibility',
  'description', 'offerName', 'offerSummary', 'contactUrl',
  'contactLabel', 'hostingProvider', 'siteSlug', 'accessMode',
] as const;

const VALID_RECORD: Record<string, unknown> = {
  approvedBy: 'user',
  approvedAt: '2026-07-15T12:00:00.000Z',
  repository: 'RomainROCH/revenue-flow-guard',
  visibility: 'public',
  description: 'Risk-driven Playwright demo proving six revenue regressions.',
  offerName: 'Revenue Flow Guard Sprint',
  offerSummary: 'Protect one revenue-critical SaaS journey with risk-driven Playwright tests, CI evidence, and a maintainable handoff.',
  contactUrl: 'https://github.com/RomainROCH',
  contactLabel: 'Contact Romain on GitHub',
  hostingProvider: 'codex-sites',
  siteSlug: 'revenue-flow-guard',
  accessMode: 'public',
};

async function withInputs(
  content: string | null,
  assertion: (root: string) => void,
) {
  const root = await mkdtemp(join(tmpdir(), 'publication-inputs-'));
  try {
    if (content !== null) {
      await writeFile(join(root, '.publication-inputs.json'), content, 'utf8');
    }
    await assertion(root);
  } finally {
    await removeTempDir(root);
  }
}

function runValidator(root: string) {
  return spawnSync(process.execPath, [validator, '--root', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
  });
}

function expectRejected(root: string) {
  const result = runValidator(root);
  expect(result.status, result.stderr || result.stdout).toBe(1);
  expect(`${result.stdout}\n${result.stderr}`).toContain('PUBLICATION_INPUTS');
  return result;
}

function expectAccepted(root: string) {
  const result = runValidator(root);
  expect(result.status, result.stderr || result.stdout).toBe(0);
  return result;
}

test.describe('validate-publication-inputs', () => {
  test('rejects a missing .publication-inputs.json', async () => {
    await withInputs(null, (root) => {
      const result = runValidator(root);
      expect(result.status, result.stderr || result.stdout).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'PUBLICATION_INPUTS:approval record is required',
      );
    });
  });

  test('rejects non-object and invalid JSON content', async () => {
    for (const content of ['null', '"string"', '42', '[]', '{broken json']) {
      await withInputs(content, (root) => expectRejected(root));
    }
  });

  test('requires approval by the user', async () => {
    for (const approvedBy of ['agent', 'admin', '', null, 42]) {
      await withInputs(
        JSON.stringify({ ...VALID_RECORD, approvedBy }, null, 2),
        (root) => expectRejected(root),
      );
    }
  });

  for (const key of REQUIRED_KEYS) {
    test(`rejects missing key ${key}`, async () => {
      const { [key]: _, ...partial } = VALID_RECORD;
      await withInputs(JSON.stringify(partial, null, 2), (root) => expectRejected(root));
    });
  }

  test('rejects an extra unexpected key', async () => {
    await withInputs(
      JSON.stringify({ ...VALID_RECORD, extraKey: 'value' }, null, 2),
      (root) => expectRejected(root),
    );
  });

  test('rejects an unparseable approvedAt', async () => {
    for (const approvedAt of [
      'not-a-date',
      '',
      '2026-13-01T00:00:00Z',
      '2026-02-30T00:00:00Z',
      '2026-01-01T24:00:00Z',
      '2026-01-01T00:60:00Z',
      '2026-01-01T00:00:00+25:00',
      null,
      true,
      42,
    ]) {
      await withInputs(
        JSON.stringify({ ...VALID_RECORD, approvedAt }, null, 2),
        (root) => expectRejected(root),
      );
    }
  });

  test('rejects a malformed repository value', async () => {
    for (const repository of ['no-slash', '/nouser', 'org/', '', 'spaces /repo', 42, null]) {
      await withInputs(
        JSON.stringify({ ...VALID_RECORD, repository }, null, 2),
        (root) => expectRejected(root),
      );
    }
  });

  test('rejects an invalid siteSlug', async () => {
    for (const siteSlug of ['UPPERCASE', 'has space', '', 'trailing-', '-leading', 'special!chars', 42, null]) {
      await withInputs(
        JSON.stringify({ ...VALID_RECORD, siteSlug }, null, 2),
        (root) => expectRejected(root),
      );
    }
  });

  test('rejects out-of-range offerName, offerSummary, contactLabel, and description', async () => {
    await withInputs(
      JSON.stringify({ ...VALID_RECORD, offerName: '' }, null, 2),
      (root) => expectRejected(root),
    );
    await withInputs(
      JSON.stringify({ ...VALID_RECORD, offerName: 'X'.repeat(81) }, null, 2),
      (root) => expectRejected(root),
    );
    await withInputs(
      JSON.stringify({ ...VALID_RECORD, offerName: 42 }, null, 2),
      (root) => expectRejected(root),
    );
    await withInputs(
      JSON.stringify({ ...VALID_RECORD, offerSummary: '' }, null, 2),
      (root) => expectRejected(root),
    );
    await withInputs(
      JSON.stringify({ ...VALID_RECORD, offerSummary: 'X'.repeat(241) }, null, 2),
      (root) => expectRejected(root),
    );
    await withInputs(
      JSON.stringify({ ...VALID_RECORD, contactLabel: '' }, null, 2),
      (root) => expectRejected(root),
    );
    await withInputs(
      JSON.stringify({ ...VALID_RECORD, contactLabel: 'X'.repeat(81) }, null, 2),
      (root) => expectRejected(root),
    );
    await withInputs(
      JSON.stringify({ ...VALID_RECORD, description: '' }, null, 2),
      (root) => expectRejected(root),
    );
    await withInputs(
      JSON.stringify({ ...VALID_RECORD, description: 'X'.repeat(241) }, null, 2),
      (root) => expectRejected(root),
    );
    await withInputs(
      JSON.stringify({ ...VALID_RECORD, description: null }, null, 2),
      (root) => expectRejected(root),
    );
  });

  test('rejects an empty or non-string hostingProvider', async () => {
    for (const hostingProvider of ['', ' ', 'X'.repeat(81), null, 42]) {
      await withInputs(
        JSON.stringify({ ...VALID_RECORD, hostingProvider }, null, 2),
        (root) => expectRejected(root),
      );
    }
  });

  test('rejects a non-HTTPS contact URL using URL parsing', async () => {
    for (const contactUrl of ['http://example.test', 'ftp://example.test', '', 'not-a-url', '//example.test']) {
      await withInputs(
        JSON.stringify({ ...VALID_RECORD, contactUrl }, null, 2),
        (root) => expectRejected(root),
      );
    }
  });

  test('rejects visibility and accessMode other than public', async () => {
    for (const visibility of ['private', 'internal', '', 'PUBLIC']) {
      await withInputs(
        JSON.stringify({ ...VALID_RECORD, visibility }, null, 2),
        (root) => expectRejected(root),
      );
    }
    for (const accessMode of ['restricted', 'private', '', 'PUBLIC']) {
      await withInputs(
        JSON.stringify({ ...VALID_RECORD, accessMode }, null, 2),
        (root) => expectRejected(root),
      );
    }
  });

  test('accepts a valid exact record and prints approved metadata', async () => {
    await withInputs(JSON.stringify(VALID_RECORD, null, 2), (root) => {
      const result = expectAccepted(root);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(output).toContain('RomainROCH/revenue-flow-guard');
      expect(output).toContain('github.com');
      expect(output).toContain('codex-sites');
      expect(output).toContain('revenue-flow-guard');
      expect(output).toContain('public');
    });
  });
});

test.describe('.env.example contracts', () => {
  const EXPECTED_ENV_KEYS = [
    'RFG_PUBLIC_REPOSITORY',
    'RFG_PUBLIC_DESCRIPTION',
    'RFG_PUBLIC_OFFER_NAME',
    'RFG_PUBLIC_OFFER_SUMMARY',
    'RFG_PUBLIC_CONTACT_URL',
    'RFG_PUBLIC_CONTACT_LABEL',
    'RFG_PUBLIC_HOSTING_PROVIDER',
    'RFG_PUBLIC_SITE_SLUG',
    'RFG_PUBLIC_VISIBILITY',
    'RFG_PUBLIC_ACCESS_MODE',
  ] as const;

  test('declares every required RFG_PUBLIC_* key with an empty placeholder', async () => {
    const content = await readFile(join(repositoryRoot, '.env.example'), 'utf8');
    const actualKeys = content
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('RFG_PUBLIC_'))
      .map((line) => line.split('=', 1)[0])
      .sort();
    expect(actualKeys).toEqual([...EXPECTED_ENV_KEYS].sort());
    for (const key of EXPECTED_ENV_KEYS) {
      const linePattern = new RegExp(`^${key}=$`, 'm');
      expect(content, `${key} should be present with empty value`).toMatch(linePattern);
    }
  });

  test('contains no real approved values', async () => {
    const content = await readFile(join(repositoryRoot, '.env.example'), 'utf8');
    expect(content).not.toMatch(/RomainROCH|ghp_|gh[ous]_|codex-sites/);
  });
});

test.describe('validate-publication target', () => {
  const publicationValidator = resolve(
    repositoryRoot,
    'scripts',
    'validate-publication.mjs',
  );

  function run(publicUrl: string | undefined) {
    const env = { ...process.env };
    delete env.RFG_EXTERNAL_BASE_URL;
    if (publicUrl === undefined) delete env.PUBLIC_URL;
    else env.PUBLIC_URL = publicUrl;

    return spawnSync(process.execPath, [publicationValidator], {
      cwd: repositoryRoot,
      env,
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    });
  }

  test('requires one clean HTTPS PUBLIC_URL', () => {
    for (const publicUrl of [
      undefined,
      'http://example.test',
      'https://user:pass@example.test',
      'https://example.test/path?token=value',
      'https://example.test/#fragment',
      'not-a-url',
    ]) {
      const result = run(publicUrl);
      expect(result.status, result.stderr || result.stdout).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain('PUBLICATION:');
    }
  });

  test('accepts an HTTPS root URL and prints only its host', () => {
    const result = run('https://revenue-flow-guard.example/');
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('revenue-flow-guard.example');
    expect(output).not.toContain('https://');
  });
});

test.describe('release-check orchestration', () => {
  const releaseCheck = resolve(repositoryRoot, 'scripts', 'release-check.mjs');

  async function withReleaseRepo(
    scripts: Record<string, string>,
    assertion: (root: string) => void | Promise<void>,
  ) {
    const root = await mkdtemp(join(tmpdir(), 'release-check-'));
    try {
      spawnSync('git', ['init'], { cwd: root, encoding: 'utf8', timeout: 5_000, windowsHide: true });
      spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: root, encoding: 'utf8', timeout: 5_000, windowsHide: true });
      spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root, encoding: 'utf8', timeout: 5_000, windowsHide: true });
      const seqLog = join(root, 'release-seq.log');
      const packageScripts: Record<string, string> = {};
      for (const [name, exitCode] of Object.entries(scripts)) {
        packageScripts[name] = [
          `node -e `,
          `"require('fs').appendFileSync('${seqLog.replace(/\\/g, '/')}','${name}\\n','utf8');`,
          `process.exit(${exitCode})"`,
        ].join('');
      }
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({ name: 'release-fixture', private: true, scripts: packageScripts }, null, 2),
        'utf8',
      );
      await writeFile(
        join(root, '.gitignore'),
        'node_modules/\nrelease-seq.log\n',
        'utf8',
      );
      spawnSync('git', ['add', '-A'], { cwd: root, encoding: 'utf8', timeout: 5_000, windowsHide: true });
      spawnSync('git', ['commit', '-m', 'init'], { cwd: root, encoding: 'utf8', timeout: 5_000, windowsHide: true });

      await assertion(root);
    } finally {
      await removeTempDir(root);
    }
  }

  const CANONICAL_SCRIPTS = [
    'lint', 'typecheck', 'test:sites', 'test:repeat', 'verify:quality',
    'build:evidence', 'validate:public-artifacts', 'scan:secrets',
    'validate:docs', 'validate:repo', 'validate:workflows',
    'validate:publication-inputs',
  ] as const;

  test('runs every canonical script in declared order and stops on first failure', async () => {
    const failIndex = 4;
    const scripts: Record<string, string> = {};
    for (let i = 0; i < CANONICAL_SCRIPTS.length; i++) {
      scripts[CANONICAL_SCRIPTS[i]] = i === failIndex ? '1' : '0';
    }

    await withReleaseRepo(scripts, (root) => {
      const result = spawnSync(process.execPath, [releaseCheck, '--root', root], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        timeout: 15_000,
        windowsHide: true,
      });

      expect(result.status, result.stderr || result.stdout).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        `npm run ${CANONICAL_SCRIPTS[failIndex]}`,
      );
      const logContent = readFileSync(join(root, 'release-seq.log'), 'utf8');
      const ran = logContent.trim().split('\n');
      expect(ran.length).toBe(failIndex + 1);
      for (let i = 0; i <= failIndex; i++) {
        expect(ran[i]).toBe(CANONICAL_SCRIPTS[i]);
      }
    });
  });

  test('stops at a dirty Git worktree before publication validation', async () => {
    const scripts = Object.fromEntries(
      CANONICAL_SCRIPTS.map((name) => [name, '0']),
    );

    await withReleaseRepo(scripts, async (root) => {
      await writeFile(join(root, 'dirty.txt'), 'not committed\n', 'utf8');
      const result = spawnSync(process.execPath, [releaseCheck, '--root', root], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        timeout: 15_000,
        windowsHide: true,
      });

      expect(result.status, result.stderr || result.stdout).toBe(1);
      expect(`${result.stdout}\n${result.stderr}`).toContain('git status');
      const ran = readFileSync(join(root, 'release-seq.log'), 'utf8')
        .trim()
        .split('\n');
      expect(ran).not.toContain('validate:publication-inputs');
    });
  });

  test('includes test:public last when PUBLIC_URL is set', async () => {
    const scripts: Record<string, string> = {};
    for (const name of CANONICAL_SCRIPTS) {
      scripts[name] = '0';
    }
    scripts['test:public'] = '0';

    await withReleaseRepo(scripts, (root) => {
      const result = spawnSync(process.execPath, [releaseCheck, '--root', root], {
        cwd: repositoryRoot,
        env: { ...process.env, PUBLIC_URL: 'https://example.test' },
        encoding: 'utf8',
        timeout: 15_000,
        windowsHide: true,
      });

      expect(result.status, result.stderr || result.stdout).toBe(0);
      const logContent = readFileSync(join(root, 'release-seq.log'), 'utf8');
      const ran = logContent.trim().split('\n');
      expect(ran[ran.length - 1]).toBe('test:public');
    });
  });
});

test.describe('PowerShell wrappers', () => {
  const exportScript = resolve(repositoryRoot, 'scripts', 'export-publication-env.ps1');
  const publishScript = resolve(repositoryRoot, 'scripts', 'publish-repository.ps1');

  async function withPowerShellRoot(assertion: (root: string) => Promise<void>) {
    const root = await mkdtemp(join(tmpdir(), 'publication-pwsh-'));
    try {
      await mkdir(join(root, 'scripts'), { recursive: true });
      await writeFile(
        join(root, 'scripts', 'gh.cmd'),
        '@echo off\r\necho %*>> "%~dp0gh-arguments.txt"\r\nif "%1 %2"=="repo view" (\r\n  if defined GH_FAKE_VIEW_ERROR echo %GH_FAKE_VIEW_ERROR% 1>&2\r\n  if defined GH_FAKE_VIEW_STDOUT echo %GH_FAKE_VIEW_STDOUT%\r\n  exit /b 1\r\n)\r\nexit /b 0\r\n',
        'utf8',
      );
      await writeFile(
        join(root, 'scripts', 'git.cmd'),
        '@echo off\r\necho %*>> "%~dp0git-arguments.txt"\r\nif "%1 %2"=="branch --show-current" echo main\r\nexit /b 0\r\n',
        'utf8',
      );
      await assertion(root);
    } finally {
      await removeTempDir(root);
    }
  }

  function pwshSpawn(root: string, command: string) {
    return spawnSync('powershell.exe', [
      '-NoProfile', '-NonInteractive',
      '-Command', `& { ${command} }`,
    ], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    });
  }

  test('export-publication-env.ps1 fails closed when .publication-inputs.json is absent', async () => {
    await withPowerShellRoot(async (root) => {
      const result = pwshSpawn(
        root,
        `$ErrorActionPreference='Stop'; . "${exportScript}" 2>&1; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`,
      );
      expect(result.status, result.stderr || result.stdout).toBe(1);
      expect(result.stderr).toContain('PUBLICATION_INPUTS');
    });
  });

  test('a failed dot-source keeps the caller alive and clears stale variables', async () => {
    await withPowerShellRoot(async (root) => {
      const result = pwshSpawn(
        root,
        `$env:RFG_PUBLIC_REPOSITORY='stale-value'; try { . "${exportScript}" } catch { Write-Output 'VALIDATION_CAUGHT' }; Write-Output 'SHELL_ALIVE'; if (Test-Path Env:RFG_PUBLIC_REPOSITORY) { Write-Output "STALE=$env:RFG_PUBLIC_REPOSITORY" }`,
      );

      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain('VALIDATION_CAUGHT');
      expect(result.stdout).toContain('SHELL_ALIVE');
      expect(result.stdout).not.toContain('STALE=');
    });
  });

  test('export-publication-env.ps1 exports every RFG_PUBLIC_* variable from a valid record', async () => {
    await withPowerShellRoot(async (root) => {
      await writeFile(
        join(root, '.publication-inputs.json'),
        JSON.stringify(VALID_RECORD, null, 2),
        'utf8',
      );

      const result = pwshSpawn(
        root,
        `$ErrorActionPreference='Stop'; . "${exportScript}"; Get-ChildItem Env:RFG_PUBLIC_* | ForEach-Object { Write-Output "$($_.Name)=$($_.Value)" }`,
      );
      expect(result.status, result.stderr || result.stdout).toBe(0);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(output).toContain('RFG_PUBLIC_REPOSITORY=RomainROCH/revenue-flow-guard');
      expect(output).toContain('RFG_PUBLIC_DESCRIPTION=Risk-driven Playwright demo proving six revenue regressions.');
      expect(output).toContain('RFG_PUBLIC_OFFER_NAME=Revenue Flow Guard Sprint');
      expect(output).toContain('RFG_PUBLIC_OFFER_SUMMARY=Protect one revenue-critical SaaS journey');
      expect(output).toContain('RFG_PUBLIC_CONTACT_URL=https://github.com/RomainROCH');
      expect(output).toContain('RFG_PUBLIC_CONTACT_LABEL=Contact Romain on GitHub');
      expect(output).toContain('RFG_PUBLIC_HOSTING_PROVIDER=codex-sites');
      expect(output).toContain('RFG_PUBLIC_SITE_SLUG=revenue-flow-guard');
      expect(output).toContain('RFG_PUBLIC_VISIBILITY=public');
      expect(output).toContain('RFG_PUBLIC_ACCESS_MODE=public');
      expect(output).not.toMatch(/ghp_|gh[ous]_/);
    });
  });

  test('publish-repository.ps1 rejects missing validated variables before calling gh', async () => {
    await withPowerShellRoot(async (root) => {
      const envPath = `${join(root, 'scripts')}${require('path').delimiter}${process.env.PATH || ''}`;
      const result = pwshSpawn(
        root,
        `$env:PATH='${envPath.replace(/\\/g, '\\\\')}'; Get-ChildItem Env:RFG_PUBLIC_* -ErrorAction SilentlyContinue | Remove-Item; $ErrorActionPreference='Stop'; & "${publishScript}" 2>&1; exit $LASTEXITCODE`,
      );

      expect(result.status, result.stderr || result.stdout).not.toBe(0);
      const ghWasInvoked = await readFile(
        join(root, 'scripts', 'gh-arguments.txt'),
        'utf8',
      ).then(
        () => true,
        () => false,
      );
      expect(ghWasInvoked).toBe(false);
    });
  });

  test('publish-repository.ps1 rejects non-public visibility before calling gh', async () => {
    await withPowerShellRoot(async (root) => {
      const envPath = `${join(root, 'scripts')}${require('path').delimiter}${process.env.PATH || ''}`;
      await writeFile(
        join(root, '.publication-inputs.json'),
        JSON.stringify({ ...VALID_RECORD, visibility: 'private' }, null, 2),
        'utf8',
      );

      const result = pwshSpawn(
        root,
        `$env:PATH='${envPath.replace(/\\/g, '\\\\')}'; $ErrorActionPreference='Stop'; . "${exportScript}"; & "${publishScript}" 2>&1; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`,
      );
      expect(result.status, result.stderr || result.stdout).not.toBe(0);
      const argumentsLog = join(root, 'scripts', 'gh-arguments.txt');
      const ghWasInvoked = await readFile(argumentsLog, 'utf8').then(
        () => true,
        () => false,
      );
      expect(ghWasInvoked).toBe(false);
    });
  });

  test('publish-repository.ps1 invokes gh with proper arguments on an approved record', async () => {
    await withPowerShellRoot(async (root) => {
      const envPath = `${join(root, 'scripts')}${require('path').delimiter}${process.env.PATH || ''}`;
      await writeFile(
        join(root, '.publication-inputs.json'),
        JSON.stringify(VALID_RECORD, null, 2),
        'utf8',
      );

      const result = pwshSpawn(
        root,
        `$env:PATH='${envPath.replace(/\\/g, '\\\\')}'; $ErrorActionPreference='Stop'; . "${exportScript}"; & "${publishScript}" 2>&1; exit $LASTEXITCODE`,
      );
      expect(result.status, result.stderr || result.stdout).toBe(0);
      const ghArguments = await readFile(
        join(root, 'scripts', 'gh-arguments.txt'),
        'utf8',
      );
      expect(ghArguments).toContain(
        'repo view RomainROCH/revenue-flow-guard',
      );
      expect(ghArguments).toContain(
        'repo create RomainROCH/revenue-flow-guard',
      );
      expect(ghArguments).toContain('--public');
      expect(ghArguments).toContain('--description');
    });
  });

  test('publish-repository.ps1 creates only after the canonical GitHub not-found diagnostic', async () => {
    await withPowerShellRoot(async (root) => {
      const envPath = `${join(root, 'scripts')}${require('path').delimiter}${process.env.PATH || ''}`;
      await writeFile(
        join(root, '.publication-inputs.json'),
        JSON.stringify(VALID_RECORD, null, 2),
        'utf8',
      );

      const result = pwshSpawn(
        root,
        `$env:PATH='${envPath.replace(/\\/g, '\\\\')}'; $env:GH_FAKE_VIEW_ERROR='GraphQL: Could not resolve to a Repository'; $ErrorActionPreference='Stop'; . "${exportScript}"; & "${publishScript}" 2>&1; exit $LASTEXITCODE`,
      );

      expect(result.status, result.stderr || result.stdout).toBe(0);
      const ghArguments = await readFile(
        join(root, 'scripts', 'gh-arguments.txt'),
        'utf8',
      );
      expect(ghArguments).toContain('repo view');
      expect(ghArguments).toContain('repo create');
    });
  });

  test('publish-repository.ps1 refuses creation when repo lookup has a diagnostic error', async () => {
    await withPowerShellRoot(async (root) => {
      const envPath = `${join(root, 'scripts')}${require('path').delimiter}${process.env.PATH || ''}`;
      await writeFile(
        join(root, '.publication-inputs.json'),
        JSON.stringify(VALID_RECORD, null, 2),
        'utf8',
      );

      const result = pwshSpawn(
        root,
        `$env:PATH='${envPath.replace(/\\/g, '\\\\')}'; $env:GH_FAKE_VIEW_ERROR='simulated network failure'; $ErrorActionPreference='Stop'; . "${exportScript}"; & "${publishScript}" 2>&1; exit $LASTEXITCODE`,
      );

      expect(result.status, result.stderr || result.stdout).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'PUBLICATION_REPOSITORY: repository lookup failed; refusing to create',
      );
      const ghArguments = await readFile(
        join(root, 'scripts', 'gh-arguments.txt'),
        'utf8',
      );
      expect(ghArguments).toContain('repo view');
      expect(ghArguments).not.toContain('repo create');
    });
  });

  test('publish-repository.ps1 does not treat a missing network host as a missing repository', async () => {
    await withPowerShellRoot(async (root) => {
      const envPath = `${join(root, 'scripts')}${require('path').delimiter}${process.env.PATH || ''}`;
      await writeFile(
        join(root, '.publication-inputs.json'),
        JSON.stringify(VALID_RECORD, null, 2),
        'utf8',
      );

      const result = pwshSpawn(
        root,
        `$env:PATH='${envPath.replace(/\\/g, '\\\\')}'; $env:GH_FAKE_VIEW_STDOUT='dial tcp: host not found'; $ErrorActionPreference='Stop'; . "${exportScript}"; & "${publishScript}" 2>&1; exit $LASTEXITCODE`,
      );

      expect(result.status, result.stderr || result.stdout).not.toBe(0);
      const ghArguments = await readFile(
        join(root, 'scripts', 'gh-arguments.txt'),
        'utf8',
      );
      expect(ghArguments).toContain('repo view');
      expect(ghArguments).not.toContain('repo create');
    });
  });
});
