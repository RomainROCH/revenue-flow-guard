import { expect, test } from '@playwright/test';
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const FINALIZER = resolve(process.cwd(), 'scripts', 'finalize-site-build.mjs');

const TEST_PROJECT_ID = `appgprj_${'0'.repeat(32)}`;
const VALID_HOSTING_JSON = JSON.stringify({ project_id: TEST_PROJECT_ID });

function removeTempRoot(root: string) {
  rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'finalize-site-test-'));
}

function createValidSiteAppDist(root: string) {
  const dist = join(root, 'sites-app', 'dist');
  mkdirSync(join(dist, 'client'), { recursive: true });
  writeFileSync(join(dist, 'client', 'index.html'), '<html></html>', 'utf8');
  mkdirSync(join(dist, 'client', 'assets'), { recursive: true });
  writeFileSync(join(dist, 'client', 'assets', 'app.js'), 'export {};', 'utf8');
  writeFileSync(
    join(dist, 'client', 'assets', 'logo.bin'),
    Buffer.from([0, 255, 1, 254]),
  );
  mkdirSync(join(dist, 'server'), { recursive: true });
  writeFileSync(join(dist, 'server', 'index.js'), 'export default () => {};', 'utf8');
  mkdirSync(join(dist, 'server', 'chunks'), { recursive: true });
  writeFileSync(join(dist, 'server', 'chunks', 'route.js'), 'export {};', 'utf8');
}

function listRelativeFiles(root: string, current = root): string[] {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(current, entry.name);
    if (entry.isDirectory()) {
      return listRelativeFiles(root, absolutePath);
    }
    return [absolutePath.slice(root.length + 1).replaceAll('\\', '/')];
  }).sort();
}

function createValidHostingJson(root: string) {
  mkdirSync(join(root, '.openai'), { recursive: true });
  writeFileSync(join(root, '.openai', 'hosting.json'), VALID_HOSTING_JSON, 'utf8');
}

function runFinalizer(root: string) {
  return spawnSync(process.execPath, [FINALIZER, '--root', root], {
    timeout: 30_000,
    encoding: 'utf8',
    windowsHide: true,
  });
}

test('finalizeSiteBuild produces exact artifact root structure', () => {
  const root = createTempRoot();
  try {
    createValidSiteAppDist(root);
    createValidHostingJson(root);

    const result = runFinalizer(root);

    expect(result.status).toBe(0);
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');

    const dist = join(root, 'dist');
    expect(existsSync(dist)).toBe(true);
    expect(existsSync(join(dist, 'client', 'index.html'))).toBe(true);
    expect(existsSync(join(dist, 'server', 'index.js'))).toBe(true);
    expect(readFileSync(join(dist, 'package.json'), 'utf8')).toBe(
      '{"type":"module"}\n',
    );
    expect(existsSync(join(dist, '.openai', 'hosting.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dist, '.openai', 'hosting.json'), 'utf8'))).toEqual(
      JSON.parse(VALID_HOSTING_JSON),
    );
    expect(existsSync(join(dist, '_worker.js'))).toBe(false);

    const sourceDist = join(root, 'sites-app', 'dist');
    expect(listRelativeFiles(dist)).toEqual([
      '.openai/hosting.json',
      'package.json',
      ...listRelativeFiles(sourceDist),
    ].sort());
    for (const relativePath of listRelativeFiles(sourceDist)) {
      expect(readFileSync(join(dist, relativePath))).toEqual(
        readFileSync(join(sourceDist, relativePath)),
      );
    }
    expect(
      readdirSync(root).some((entry) => entry.startsWith('.rfg-finalize-')),
    ).toBe(false);
  } finally {
    removeTempRoot(root);
  }
});

test('finalizeSiteBuild replaces stale root dist and preserves sibling sentinel', () => {
  const root = createTempRoot();
  try {
    createValidSiteAppDist(root);
    createValidHostingJson(root);

    const staleRoot = join(root, 'dist');
    mkdirSync(staleRoot, { recursive: true });
    writeFileSync(join(staleRoot, 'stale.txt'), 'should be removed', 'utf8');

    const sibling = join(root, 'sibling');
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'sentinel.txt'), 'should survive', 'utf8');

    const result = runFinalizer(root);

    expect(result.status).toBe(0);
    expect(existsSync(join(root, 'dist', 'stale.txt'))).toBe(false);
    expect(existsSync(join(root, 'dist', 'client', 'index.html'))).toBe(true);
    expect(existsSync(join(root, 'dist', '.openai', 'hosting.json'))).toBe(true);
    expect(readFileSync(join(sibling, 'sentinel.txt'), 'utf8')).toBe('should survive');
  } finally {
    removeTempRoot(root);
  }
});

const INVALID_FIXTURES: Array<{
  name: string;
  expectedCode: string;
  setup: (root: string) => void;
  outputCanBeCleaned?: boolean;
}> = [
  {
    name: 'relative root',
    expectedCode: 'ERR_RELATIVE_ROOT',
    setup: () => {},
    outputCanBeCleaned: false,
  },
  {
    name: 'missing hosting ancestor',
    expectedCode: 'ERR_HOSTING_ANCESTOR_INVALID',
    setup: (root) => {
      createValidSiteAppDist(root);
    },
  },
  {
    name: 'missing hosting JSON',
    expectedCode: 'ERR_HOSTING_NOT_FILE',
    setup: (root) => {
      createValidSiteAppDist(root);
      mkdirSync(join(root, '.openai'), { recursive: true });
    },
  },
  {
    name: 'malformed hosting JSON',
    expectedCode: 'ERR_HOSTING_INVALID_JSON',
    setup: (root) => {
      createValidSiteAppDist(root);
      mkdirSync(join(root, '.openai'), { recursive: true });
      writeFileSync(join(root, '.openai', 'hosting.json'), 'not json', 'utf8');
    },
  },
  {
    name: 'hosting JSON is not an object',
    expectedCode: 'ERR_HOSTING_NOT_OBJECT',
    setup: (root) => {
      createValidSiteAppDist(root);
      mkdirSync(join(root, '.openai'), { recursive: true });
      writeFileSync(join(root, '.openai', 'hosting.json'), 'null', 'utf8');
    },
  },
  {
    name: 'missing client directory',
    expectedCode: 'ERR_MISSING_CLIENT_DIR',
    setup: (root) => {
      createValidHostingJson(root);
      const dist = join(root, 'sites-app', 'dist');
      mkdirSync(join(dist, 'server'), { recursive: true });
      writeFileSync(join(dist, 'server', 'index.js'), 'export default () => {};', 'utf8');
    },
  },
  {
    name: 'missing server/index.js',
    expectedCode: 'ERR_MISSING_SERVER_INDEX',
    setup: (root) => {
      createValidHostingJson(root);
      const dist = join(root, 'sites-app', 'dist');
      mkdirSync(join(dist, 'client'), { recursive: true });
      writeFileSync(join(dist, 'client', 'index.html'), '<html></html>', 'utf8');
    },
  },
  {
    name: 'unexpected extra hosting key',
    expectedCode: 'ERR_HOSTING_EXTRA_KEYS',
    setup: (root) => {
      createValidSiteAppDist(root);
      mkdirSync(join(root, '.openai'), { recursive: true });
      writeFileSync(
        join(root, '.openai', 'hosting.json'),
        JSON.stringify({ project_id: TEST_PROJECT_ID, extra: 'bad' }),
        'utf8',
      );
    },
  },
  {
    name: 'unexpected artifact _worker.js',
    expectedCode: 'ERR_SOURCE_WORKER_JS',
    setup: (root) => {
      createValidSiteAppDist(root);
      createValidHostingJson(root);
      writeFileSync(
        join(root, 'sites-app', 'dist', '_worker.js'),
        'export default {};',
        'utf8',
      );
    },
  },
];

for (const {
  name,
  expectedCode,
  setup,
  outputCanBeCleaned = true,
} of INVALID_FIXTURES) {
  test(`finalizeSiteBuild rejects invalid fixture: ${name}`, () => {
    const root = createTempRoot();
    try {
      setup(root);

      const staleRoot = join(root, 'dist');
      mkdirSync(staleRoot, { recursive: true });
      writeFileSync(join(staleRoot, 'stale.txt'), 'must be removed', 'utf8');

      const sibling = join(root, 'sibling');
      mkdirSync(sibling, { recursive: true });
      writeFileSync(join(sibling, 'sentinel.txt'), 'must survive', 'utf8');

      const result = runFinalizer(
        name === 'relative root' ? 'relative/path' : root,
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr.trim()).toBe(`FINALIZE_SITE_BUILD: ${expectedCode}`);
      expect(result.stderr).not.toContain(TEST_PROJECT_ID);

      expect(existsSync(join(root, 'dist'))).toBe(!outputCanBeCleaned);
      expect(readFileSync(join(sibling, 'sentinel.txt'), 'utf8')).toBe('must survive');
    } finally {
      removeTempRoot(root);
    }
  });
}

test('finalizeSiteBuild resolves its default root from the script location', () => {
  const root = createTempRoot();
  try {
    createValidSiteAppDist(root);
    createValidHostingJson(root);
    const scriptsDir = join(root, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    const copiedFinalizer = join(scriptsDir, 'finalize-site-build.mjs');
    copyFileSync(FINALIZER, copiedFinalizer);

    const unrelatedCwd = join(root, 'unrelated-cwd');
    mkdirSync(unrelatedCwd, { recursive: true });
    const result = spawnSync(process.execPath, [copiedFinalizer], {
      cwd: unrelatedCwd,
      timeout: 30_000,
      encoding: 'utf8',
      windowsHide: true,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(root, 'dist', 'client', 'index.html'))).toBe(true);
    expect(existsSync(join(unrelatedCwd, 'dist'))).toBe(false);
  } finally {
    removeTempRoot(root);
  }
});

test('finalizeSiteBuild rejects unsupported filesystem entries', async ({}, testInfo) => {
  testInfo.skip(process.platform === 'win32', 'portable FIFO creation is unavailable on Windows');

  const root = createTempRoot();
  try {
    createValidSiteAppDist(root);
    createValidHostingJson(root);
    const fifoPath = join(root, 'sites-app', 'dist', 'client', 'unsupported.fifo');
    const fifo = spawnSync('mkfifo', [fifoPath], { encoding: 'utf8' });
    expect(fifo.status, fifo.stderr).toBe(0);

    const result = runFinalizer(root);
    expect(result.status).not.toBe(0);
    expect(result.stderr.trim()).toBe(
      'FINALIZE_SITE_BUILD: ERR_SOURCE_UNSUPPORTED_ENTRY',
    );
    expect(existsSync(join(root, 'dist'))).toBe(false);
  } finally {
    removeTempRoot(root);
  }
});

test('finalizeSiteBuild rejects symlink within sites-app/dist', async ({}, testInfo) => {
  let canSymlink = false;
  const probeRoot = mkdtempSync(join(tmpdir(), 'finalize-site-symlink-probe-'));
  try {
    const probe = join(probeRoot, 'source');
    writeFileSync(probe, 'probe', 'utf8');
    const link = join(probeRoot, 'link');
    symlinkSync(probe, link);
    canSymlink = true;
  } catch {
    // symlink creation not available
  } finally {
    removeTempRoot(probeRoot);
  }
  testInfo.skip(!canSymlink, 'symlink creation not available');

  const root = createTempRoot();
  try {
    createValidSiteAppDist(root);
    createValidHostingJson(root);

    symlinkSync(
      join(root, 'sites-app', 'dist', 'client', 'index.html'),
      join(root, 'sites-app', 'dist', 'client', 'evil-link.html'),
    );

    const staleRoot = join(root, 'dist');
    mkdirSync(staleRoot, { recursive: true });
    writeFileSync(join(staleRoot, 'stale.txt'), 'must be removed', 'utf8');

    const sibling = join(root, 'sibling');
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'sentinel.txt'), 'must survive', 'utf8');

    const result = runFinalizer(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr.trim()).toBe('FINALIZE_SITE_BUILD: ERR_SOURCE_SYMLINK');
    expect(existsSync(join(root, 'dist'))).toBe(false);
    expect(readFileSync(join(sibling, 'sentinel.txt'), 'utf8')).toBe('must survive');
  } finally {
    removeTempRoot(root);
  }
});

test('finalizeSiteBuild rejects .openai as symlink/junction', () => {
  const root = createTempRoot();
  try {
    createValidSiteAppDist(root);
    createValidHostingJson(root);

    rmSync(join(root, '.openai'), { recursive: true });
    const fakeOpenai = join(root, 'fake-openai');
    mkdirSync(fakeOpenai, { recursive: true });
    writeFileSync(join(fakeOpenai, 'hosting.json'), VALID_HOSTING_JSON, 'utf8');
    symlinkSync(
      fakeOpenai,
      join(root, '.openai'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const staleRoot = join(root, 'dist');
    mkdirSync(staleRoot, { recursive: true });
    writeFileSync(join(staleRoot, 'stale.txt'), 'must be removed', 'utf8');

    const sibling = join(root, 'sibling');
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'sentinel.txt'), 'must survive', 'utf8');

    const result = runFinalizer(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr.trim()).toBe('FINALIZE_SITE_BUILD: ERR_HOSTING_ANCESTOR_INVALID');
    expect(result.stderr).not.toContain(TEST_PROJECT_ID);
    expect(existsSync(join(root, 'dist'))).toBe(false);
    expect(readFileSync(join(sibling, 'sentinel.txt'), 'utf8')).toBe('must survive');
  } finally {
    removeTempRoot(root);
  }
});

test('finalizeSiteBuild rejects sites-app as symlink/junction', () => {
  const root = createTempRoot();
  try {
    createValidSiteAppDist(root);
    createValidHostingJson(root);

    rmSync(join(root, 'sites-app'), { recursive: true });
    const fakeSitesApp = join(root, 'fake-sites-app');
    mkdirSync(join(fakeSitesApp, 'dist', 'client'), { recursive: true });
    writeFileSync(join(fakeSitesApp, 'dist', 'client', 'index.html'), '<html></html>', 'utf8');
    mkdirSync(join(fakeSitesApp, 'dist', 'server'), { recursive: true });
    writeFileSync(join(fakeSitesApp, 'dist', 'server', 'index.js'), 'export default () => {};', 'utf8');
    symlinkSync(
      fakeSitesApp,
      join(root, 'sites-app'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const staleRoot = join(root, 'dist');
    mkdirSync(staleRoot, { recursive: true });
    writeFileSync(join(staleRoot, 'stale.txt'), 'must be removed', 'utf8');

    const sibling = join(root, 'sibling');
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'sentinel.txt'), 'must survive', 'utf8');

    const result = runFinalizer(root);

    expect(result.status).not.toBe(0);
    expect(result.stderr.trim()).toBe('FINALIZE_SITE_BUILD: ERR_SOURCE_ANCESTOR_INVALID');
    expect(result.stderr).not.toContain(TEST_PROJECT_ID);
    expect(existsSync(join(root, 'dist'))).toBe(false);
    expect(readFileSync(join(sibling, 'sentinel.txt'), 'utf8')).toBe('must survive');
  } finally {
    removeTempRoot(root);
  }
});
