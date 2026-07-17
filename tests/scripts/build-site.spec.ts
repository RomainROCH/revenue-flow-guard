import { expect, test } from '@playwright/test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

async function loadBuildSite() {
  const mod = await import('../../scripts/build-site.mjs') as {
    buildSite: (options: {
      sourceRoot: string;
      outputRoot: string;
    }) => Promise<void>;
  };
  return mod.buildSite;
}

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'build-site-test-'));
}

function removeTempRoot(root: string) {
  rmSync(root, { recursive: true, force: true });
}

function createRequiredInputs(root: string) {
  mkdirSync(join(root, 'app'), { recursive: true });
  mkdirSync(join(root, 'sites'), { recursive: true });
  const origHtml = readFileSync(
    resolve(process.cwd(), 'app', 'case-study.html'),
    'utf8',
  );
  writeFileSync(join(root, 'app', 'case-study.html'), origHtml, 'utf8');
  const origJs = readFileSync(
    resolve(process.cwd(), 'app', 'case-study.js'),
    'utf8',
  );
  writeFileSync(join(root, 'app', 'case-study.js'), origJs, 'utf8');
  const origCss = readFileSync(
    resolve(process.cwd(), 'app', 'style.css'),
    'utf8',
  );
  writeFileSync(join(root, 'app', 'style.css'), origCss, 'utf8');
  writeFileSync(
    join(root, 'sites', 'compatibility-worker.mjs'),
    `export default { async fetch(request, env) { return env.ASSETS.fetch(request); } };`,
    'utf8',
  );
}

const EXPECTED_ARTIFACTS = [
  '_worker.js',
  'index.html',
  'case-study.html',
  'case-study.js',
  'style.css',
];

test('buildSite produces the exact artifact root structure', async () => {
  const tempRoot = createTempRoot();
  try {
    createRequiredInputs(tempRoot);
    const outputRoot = join(tempRoot, 'dist');
    const buildSite = await loadBuildSite();
    await buildSite({ sourceRoot: tempRoot, outputRoot });

    expect(existsSync(outputRoot)).toBe(true);
    const entries = readdirSync(outputRoot).sort();
    expect(entries).toEqual([...EXPECTED_ARTIFACTS].sort());
  } finally {
    removeTempRoot(tempRoot);
  }
});

test('built HTML files contain no unresolved template tokens and use approved fallback content', async () => {
  const tempRoot = createTempRoot();
  try {
    createRequiredInputs(tempRoot);
    const outputRoot = join(tempRoot, 'dist');
    const buildSite = await loadBuildSite();
    await buildSite({ sourceRoot: tempRoot, outputRoot });

    for (const name of ['index.html', 'case-study.html']) {
      const html = readFileSync(join(outputRoot, name), 'utf8');

      expect(html).not.toMatch(/\{\{/);
      expect(html).toContain('data-source-commit="unavailable"');
      expect(html).toContain('https://github.com/RomainROCH');
      expect(html).toContain('Contact Romain on GitHub');
      expect(html).toContain('Revenue Flow Guard \u2014 SaaS Release Confidence Sprint');
      expect(html).toContain(
        'Protect one revenue-critical SaaS journey with risk-driven Playwright tests, CI evidence, and a maintainable handoff.',
      );
      expect(html).not.toContain('View the interactive demo');
      expect(html).toContain(
        'Live evidence requires JavaScript; no result is shown in this static view.',
      );
    }
  } finally {
    removeTempRoot(tempRoot);
  }
});

test('buildSite removes stale output before writing', async () => {
  const tempRoot = createTempRoot();
  try {
    createRequiredInputs(tempRoot);
    const outputRoot = join(tempRoot, 'dist');
    mkdirSync(outputRoot, { recursive: true });
    writeFileSync(join(outputRoot, 'stale.txt'), 'should be removed', 'utf8');

    const buildSite = await loadBuildSite();
    await buildSite({ sourceRoot: tempRoot, outputRoot });

    expect(existsSync(join(outputRoot, 'stale.txt'))).toBe(false);
    expect(existsSync(join(outputRoot, '_worker.js'))).toBe(true);
    expect(existsSync(join(outputRoot, 'index.html'))).toBe(true);
  } finally {
    removeTempRoot(tempRoot);
  }
});

test('buildSite source must use node:fs/promises and forbid synchronous fs APIs', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'scripts', 'build-site.mjs'),
    'utf8',
  );
  expect(source).toMatch(/from\s+['"]node:fs\/promises['"]/);
  expect(source).not.toMatch(/\bexistsSync\b/);
  expect(source).not.toMatch(/\brmSync\b/);
  expect(source).not.toMatch(/\bmkdirSync\b/);
  expect(source).not.toMatch(/\breadFileSync\b/);
  expect(source).not.toMatch(/\bwriteFileSync\b/);
  expect(source).not.toMatch(/\bcopyFileSync\b/);
});

test('buildSite rejects non-dist sibling output and leaves sentinel intact', async () => {
  const tempRoot = createTempRoot();
  try {
    createRequiredInputs(tempRoot);
    const sentinelContent = 'should survive build';
    const siblingRoot = join(tempRoot, 'not-dist');
    mkdirSync(siblingRoot, { recursive: true });
    writeFileSync(join(siblingRoot, 'sentinel.txt'), sentinelContent, 'utf8');

    const buildSite = await loadBuildSite();
    await expect(
      buildSite({ sourceRoot: tempRoot, outputRoot: siblingRoot }),
    ).rejects.toThrow();

    expect(existsSync(siblingRoot)).toBe(true);
    expect(readFileSync(join(siblingRoot, 'sentinel.txt'), 'utf8')).toBe(
      sentinelContent,
    );
  } finally {
    removeTempRoot(tempRoot);
  }
});

test('buildSite rejects case-variant DIST output on case-sensitive platforms', async () => {
  test.skip(
    process.platform === 'win32',
    'Case-insensitive filesystem cannot distinguish DIST from dist',
  );

  const tempRoot = createTempRoot();
  try {
    createRequiredInputs(tempRoot);
    const distRoot = join(tempRoot, 'DIST');
    mkdirSync(distRoot, { recursive: true });
    writeFileSync(join(distRoot, 'sentinel.txt'), 'must survive', 'utf8');

    const buildSite = await loadBuildSite();
    await expect(
      buildSite({ sourceRoot: tempRoot, outputRoot: distRoot }),
    ).rejects.toThrow();
    expect(readFileSync(join(distRoot, 'sentinel.txt'), 'utf8')).toBe(
      'must survive',
    );
  } finally {
    removeTempRoot(tempRoot);
  }
});

test('buildSite rejects input with missing template token and does not write dist', async () => {
  const tempRoot = createTempRoot();
  try {
    createRequiredInputs(tempRoot);
    const htmlPath = join(tempRoot, 'app', 'case-study.html');
    const origHtml = readFileSync(htmlPath, 'utf8');
    writeFileSync(htmlPath, origHtml.replace('{{PUBLICATION_STATUS}}', ''), 'utf8');

    const outputRoot = join(tempRoot, 'dist');
    mkdirSync(outputRoot, { recursive: true });
    writeFileSync(join(outputRoot, 'stale.txt'), 'must be removed', 'utf8');
    const buildSite = await loadBuildSite();
    await expect(
      buildSite({ sourceRoot: tempRoot, outputRoot }),
    ).rejects.toThrow();

    expect(existsSync(outputRoot)).toBe(false);
  } finally {
    removeTempRoot(tempRoot);
  }
});

test('buildSite rejects input with missing nav marker and does not write dist', async () => {
  const tempRoot = createTempRoot();
  try {
    createRequiredInputs(tempRoot);
    const htmlPath = join(tempRoot, 'app', 'case-study.html');
    const origHtml = readFileSync(htmlPath, 'utf8');
    writeFileSync(
      htmlPath,
      origHtml.replace(
        '<a href="/">View the interactive demo</a>',
        '<a href="/">Different link text</a>',
      ),
      'utf8',
    );

    const outputRoot = join(tempRoot, 'dist');
    mkdirSync(outputRoot, { recursive: true });
    writeFileSync(join(outputRoot, 'stale.txt'), 'must be removed', 'utf8');
    const buildSite = await loadBuildSite();
    await expect(
      buildSite({ sourceRoot: tempRoot, outputRoot }),
    ).rejects.toThrow();

    expect(existsSync(outputRoot)).toBe(false);
  } finally {
    removeTempRoot(tempRoot);
  }
});
