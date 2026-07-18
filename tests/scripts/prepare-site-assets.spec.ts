import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PREPARER = resolve(process.cwd(), 'scripts', 'prepare-site-assets.mjs');

function createTempRoot() {
  return mkdtempSync(join(tmpdir(), 'prepare-site-assets-'));
}

function removeTempRoot(root: string) {
  rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

function pathEntryExists(path: string) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function createSource(root: string, content = 'body { color: #102235; }\n') {
  mkdirSync(join(root, 'app'), { recursive: true });
  writeFileSync(join(root, 'app', 'style.css'), content, 'utf8');
}

function runPreparer(root: string) {
  return runPreparerArgs(['--root', root]);
}

function runPreparerArgs(args: string[]) {
  return spawnSync(process.execPath, [PREPARER, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
}

test('prepareSiteAssets copies the canonical CSS bytes and replaces stale output', () => {
  const root = createTempRoot();
  try {
    const canonical = 'body { color: #102235; }\n/* évidence */\n';
    createSource(root, canonical);
    mkdirSync(join(root, 'sites-app', 'public'), { recursive: true });
    writeFileSync(join(root, 'sites-app', 'public', 'style.css'), 'stale', 'utf8');
    writeFileSync(join(root, 'sites-app', 'public', 'sentinel.txt'), 'keep', 'utf8');

    const result = runPreparer(root);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(readFileSync(join(root, 'sites-app', 'public', 'style.css'))).toEqual(
      Buffer.from(canonical, 'utf8'),
    );
    expect(readFileSync(join(root, 'sites-app', 'public', 'sentinel.txt'), 'utf8')).toBe('keep');
  } finally {
    removeTempRoot(root);
  }
});

test('prepareSiteAssets rejects a relative root before touching output', () => {
  const result = runPreparer('relative/path');
  expect(result.status).not.toBe(0);
  expect(result.stderr.trim()).toBe('PREPARE_SITE_ASSETS: ERR_RELATIVE_ROOT');
});

test('prepareSiteAssets rejects unknown, incomplete, and extra arguments', () => {
  const root = createTempRoot();
  try {
    for (const args of [
      ['--unknown'],
      ['--root'],
      ['unexpected'],
      ['--root', root, 'extra'],
    ]) {
      const result = runPreparerArgs(args);
      expect(result.status).not.toBe(0);
      expect(result.stderr.trim()).toBe('PREPARE_SITE_ASSETS: ERR_USAGE');
    }
  } finally {
    removeTempRoot(root);
  }
});

test('prepareSiteAssets fails closed when canonical CSS is missing', () => {
  const root = createTempRoot();
  try {
    mkdirSync(join(root, 'sites-app', 'public'), { recursive: true });
    writeFileSync(join(root, 'sites-app', 'public', 'style.css'), 'stale', 'utf8');

    const result = runPreparer(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr.trim()).toBe('PREPARE_SITE_ASSETS: ERR_SOURCE_NOT_FILE');
    expect(existsSync(join(root, 'sites-app', 'public', 'style.css'))).toBe(false);
  } finally {
    removeTempRoot(root);
  }
});

test('prepareSiteAssets surfaces cleanup failure when stale output is not a file', () => {
  const root = createTempRoot();
  try {
    mkdirSync(join(root, 'sites-app', 'public', 'style.css'), { recursive: true });

    const result = runPreparer(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr.trim()).toBe(
      'PREPARE_SITE_ASSETS: ERR_DESTINATION_CLEANUP',
    );
  } finally {
    removeTempRoot(root);
  }
});

test('prepareSiteAssets removes a dangling destination link during source failure', async ({}, testInfo) => {
  const root = createTempRoot();
  const externalRoot = createTempRoot();
  try {
    const publicRoot = join(root, 'sites-app', 'public');
    mkdirSync(publicRoot, { recursive: true });
    const target = join(externalRoot, 'target');
    mkdirSync(target, { recursive: true });
    const link = join(publicRoot, 'style.css');
    try {
      symlinkSync(target, link, 'junction');
    } catch {
      testInfo.skip(true, 'directory symlink creation unavailable');
    }
    rmSync(target, { recursive: true, force: true });
    expect(pathEntryExists(link)).toBe(true);

    const result = runPreparer(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr.trim()).toBe('PREPARE_SITE_ASSETS: ERR_SOURCE_NOT_FILE');
    expect(pathEntryExists(link)).toBe(false);
  } finally {
    removeTempRoot(root);
    removeTempRoot(externalRoot);
  }
});

test('prepareSiteAssets reports a stable non-reflective destination failure', () => {
  const root = createTempRoot();
  try {
    createSource(root);
    mkdirSync(join(root, 'sites-app'), { recursive: true });
    writeFileSync(join(root, 'sites-app', 'public'), 'blocking file', 'utf8');

    const result = runPreparer(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr.trim()).toBe(
      'PREPARE_SITE_ASSETS: ERR_DESTINATION_WRITE',
    );
    expect(result.stderr).not.toContain(root);
  } finally {
    removeTempRoot(root);
  }
});

test('prepareSiteAssets resolves its default root from the script location', () => {
  const root = createTempRoot();
  try {
    createSource(root);
    const scriptsDir = join(root, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    const copiedPreparer = join(scriptsDir, 'prepare-site-assets.mjs');
    copyFileSync(PREPARER, copiedPreparer);
    const unrelatedCwd = join(root, 'unrelated');
    mkdirSync(unrelatedCwd, { recursive: true });

    const result = spawnSync(process.execPath, [copiedPreparer], {
      cwd: unrelatedCwd,
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(root, 'sites-app', 'public', 'style.css'))).toBe(true);
    expect(existsSync(join(unrelatedCwd, 'sites-app'))).toBe(false);
  } finally {
    removeTempRoot(root);
  }
});

test('prepareSiteAssets rejects a symlink source', async ({}, testInfo) => {
  const probeRoot = createTempRoot();
  let canSymlink = false;
  try {
    writeFileSync(join(probeRoot, 'source'), 'source', 'utf8');
    symlinkSync(join(probeRoot, 'source'), join(probeRoot, 'link'));
    canSymlink = true;
  } catch {
    // Symlink creation is unavailable for this account.
  } finally {
    removeTempRoot(probeRoot);
  }
  testInfo.skip(!canSymlink, 'symlink creation unavailable');

  const root = createTempRoot();
  try {
    mkdirSync(join(root, 'app'), { recursive: true });
    const target = join(root, 'target.css');
    writeFileSync(target, 'secret sentinel', 'utf8');
    symlinkSync(target, join(root, 'app', 'style.css'));

    const result = runPreparer(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr.trim()).toBe('PREPARE_SITE_ASSETS: ERR_SOURCE_NOT_FILE');
    expect(result.stderr).not.toContain('secret sentinel');
  } finally {
    removeTempRoot(root);
  }
});

test('prepareSiteAssets rejects a symlinked source ancestor', async ({}, testInfo) => {
  const root = createTempRoot();
  const externalRoot = createTempRoot();
  try {
    createSource(externalRoot, 'external sentinel');
    try {
      symlinkSync(join(externalRoot, 'app'), join(root, 'app'), 'junction');
    } catch {
      testInfo.skip(true, 'directory symlink creation unavailable');
    }

    const result = runPreparer(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr.trim()).toBe('PREPARE_SITE_ASSETS: ERR_SOURCE_NOT_FILE');
    expect(result.stderr).not.toContain('external sentinel');
    expect(existsSync(join(root, 'sites-app', 'public', 'style.css'))).toBe(false);
  } finally {
    removeTempRoot(root);
    removeTempRoot(externalRoot);
  }
});

test('prepareSiteAssets rejects a symlinked destination ancestor', async ({}, testInfo) => {
  const root = createTempRoot();
  const externalRoot = createTempRoot();
  try {
    createSource(root);
    mkdirSync(join(root, 'sites-app'), { recursive: true });
    writeFileSync(join(externalRoot, 'style.css'), 'external sentinel', 'utf8');
    try {
      symlinkSync(externalRoot, join(root, 'sites-app', 'public'), 'junction');
    } catch {
      testInfo.skip(true, 'directory symlink creation unavailable');
    }

    const result = runPreparer(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr.trim()).toBe('PREPARE_SITE_ASSETS: ERR_DESTINATION_PATH');
    expect(readFileSync(join(externalRoot, 'style.css'), 'utf8')).toBe(
      'external sentinel',
    );
  } finally {
    removeTempRoot(root);
    removeTempRoot(externalRoot);
  }
});
