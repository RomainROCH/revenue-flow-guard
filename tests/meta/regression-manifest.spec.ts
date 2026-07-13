import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '../..');
const manifestPath = path.join(repositoryRoot, 'regressions', 'manifest.json');
const testIdSeparator = ' › ';

const expectedMappings = [
  {
    id: 'AUTH_BYPASS',
    testId:
      'tests/api/catalog.spec.ts › GET /api/products requires a known session and leaks no catalogue data',
  },
  {
    id: 'CLIENT_PRICE_TRUST',
    testId:
      'tests/api/orders.spec.ts › POST /api/orders enforces exact top-level and item fields and forbids client prices or totals',
  },
  {
    id: 'DUPLICATE_ORDER',
    testId:
      'tests/api/orders.spec.ts › a successful order uses canonical item order, server totals, an opaque id, and replays exactly once',
  },
  {
    id: 'EMPTY_CART_ACCEPTED',
    testId:
      'tests/api/orders.spec.ts › POST /api/orders maps empty, duplicate, unknown, and invalid-quantity items to INVALID_ITEMS without stock changes',
  },
  {
    id: 'PAYMENT_DECLINE_HIDDEN',
    testId:
      'tests/ui/checkout.spec.ts › safe demonstration checkout › shows a declined-payment message, preserves the cart, and uses a new key for a new attempt',
  },
  {
    id: 'SUBMIT_CONTROL_MISSING',
    testId:
      'tests/ui/checkout.spec.ts › safe demonstration checkout › disables every submission path while the first order is pending',
  },
] as const;

type ManifestEntry = {
  id: string;
  testId: string;
  expectedSignature: string;
};

type RegressionManifest = {
  schemaVersion: number;
  entries: ManifestEntry[];
};

function readManifest(): RegressionManifest {
  if (!existsSync(manifestPath)) {
    throw new Error('REGRESSION_MANIFEST:manifest.json is required');
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as RegressionManifest;
  } catch {
    throw new Error('REGRESSION_MANIFEST:manifest.json must contain valid JSON');
  }
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return listFiles(entryPath);
    }

    return entry.isFile() ? [entryPath] : [];
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function listCanonicalPlaywrightTestIds(): Set<string> {
  const cliPath = path.join(
    repositoryRoot,
    'node_modules',
    '@playwright',
    'test',
    'cli.js',
  );
  const result = spawnSync(
    process.execPath,
    [cliPath, 'test', '--list', '--project=chromium'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    },
  );

  if (result.error) {
    throw new Error(
      `REGRESSION_MANIFEST:cannot start playwright --list: ${result.error.message}`,
      { cause: result.error },
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `REGRESSION_MANIFEST:playwright --list failed: ${result.stderr?.trim() ?? 'no stderr'}`,
    );
  }

  const projectPrefix = `[chromium]${testIdSeparator}`;
  return new Set(
    result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.startsWith(projectPrefix))
      .map((line) => {
        const [location, ...titles] = line
          .slice(projectPrefix.length)
          .split(testIdSeparator);
        const testFileFromTestDir = location
          .replace(/:\d+:\d+$/u, '')
          .replaceAll('\\', '/');
        const testFile = `tests/${testFileFromTestDir}`;

        return [testFile, ...titles].join(testIdSeparator);
      }),
  );
}

test('the regression manifest maps every commercial regression to one durable test', () => {
  const manifest = readManifest();
  const canonicalPlaywrightTestIds = listCanonicalPlaywrightTestIds();

  expect(Object.keys(manifest).sort()).toEqual(['entries', 'schemaVersion']);
  expect(manifest.schemaVersion).toBe(1);
  expect(manifest.entries).toHaveLength(expectedMappings.length);

  for (const entry of manifest.entries) {
    expect(canonicalPlaywrightTestIds).toContain(entry.testId);

    expect(Object.keys(entry).sort()).toEqual([
      'expectedSignature',
      'id',
      'testId',
    ]);
  }

  const byId = <T extends { id: string }>(left: T, right: T) =>
    left.id.localeCompare(right.id);

  expect(
    manifest.entries.map(({ id, testId }) => ({ id, testId })).sort(byId),
  ).toEqual([...expectedMappings].sort(byId));

  expect(new Set(manifest.entries.map(({ id }) => id)).size).toBe(
    manifest.entries.length,
  );
  expect(
    new Set(manifest.entries.map(({ expectedSignature }) => expectedSignature))
      .size,
  ).toBe(manifest.entries.length);

  const testsRoot = path.join(repositoryRoot, 'tests');
  const testSources = listFiles(testsRoot).map((filePath) => ({
    filePath,
    source: readFileSync(filePath, 'utf8'),
  }));

  for (const entry of manifest.entries) {
    const segments = entry.testId.split(testIdSeparator);

    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments.every((segment) => segment.length > 0)).toBe(true);
    expect(segments.every((segment) => segment === segment.trim())).toBe(true);
    expect(entry.testId).not.toContain('\\');

    const [testFile, ...titleSegments] = segments;
    expect(testFile).toMatch(/^tests\//);
    expect(path.posix.isAbsolute(testFile)).toBe(false);
    expect(path.win32.isAbsolute(testFile)).toBe(false);
    expect(testFile.split('/')).not.toContain('..');

    const mappedFilePath = path.resolve(repositoryRoot, ...testFile.split('/'));
    expect(existsSync(mappedFilePath)).toBe(true);
    expect(mappedFilePath.startsWith(`${testsRoot}${path.sep}`)).toBe(true);

    const testTitle = titleSegments[titleSegments.length - 1];
    const mappedSource = readFileSync(mappedFilePath, 'utf8');
    expect(mappedSource).toContain(testTitle);

    expect(entry.expectedSignature).toMatch(
      new RegExp(`^RFG:${escapeRegExp(entry.id)}:[A-Z0-9][A-Z0-9_.-]*$`),
    );

    const signaturePattern = new RegExp(
      `RFG:${escapeRegExp(entry.id)}:[A-Z0-9][A-Z0-9_.-]*`,
      'g',
    );
    const signatureOccurrences = testSources.flatMap(({ source }) =>
      source.match(signaturePattern) ?? [],
    );

    expect(signatureOccurrences).toEqual([entry.expectedSignature]);
    expect(mappedSource.split(entry.expectedSignature)).toHaveLength(2);
  }
});
