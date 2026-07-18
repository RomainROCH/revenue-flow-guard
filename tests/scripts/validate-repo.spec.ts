import { expect, test } from '@playwright/test';
import {
  spawnSync,
  type SpawnSyncReturns,
} from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repositoryRoot = path.resolve(__dirname, '../..');
const validatorPath = path.join(repositoryRoot, 'scripts', 'validate-repo.mjs');

const routeTestTitle = 'GET /api/health returns the health contract';

const completeFiles: Readonly<Record<string, string>> = {
  'package.json': JSON.stringify(
    {
      name: 'validate-repo-fixture',
      private: true,
      scripts: {
        validate: 'node scripts/entry.mjs',
      },
    },
    null,
    2,
  ),
  'scripts/entry.mjs': [
    "import { run } from './lib/run.mjs';",
    '',
    'run();',
    '',
  ].join('\n'),
  'scripts/lib/run.mjs': [
    'export function run() {',
    "  return 'complete';",
    '}',
    '',
  ].join('\n'),
  'src/create-application.js': [
    'export function createApplication(createRouter) {',
    '  return createRouter([',
    '    {',
    "      method: 'GET',",
    "      path: '/api/health',",
    '      handler: async () => undefined,',
    '    },',
    '  ]);',
    '}',
    '',
  ].join('\n'),
  'tests/api/health.spec.ts': [
    "import { test } from '@playwright/test';",
    'import {',
    '  FixtureContext,',
    '  createFixture,',
    '  fixtureName,',
    "} from '../fixtures/runtime-helper';",
    '',
    `test('${routeTestTitle}', () => {`,
    '  const context = new FixtureContext();',
    '  void createFixture();',
    '  void fixtureName;',
    '  void context;',
    '});',
    '',
  ].join('\n'),
  'tests/fixtures/runtime-helper.ts': [
    'export function createFixture(): object {',
    '  return {};',
    '}',
    '',
    "export const fixtureName = 'complete';",
    '',
    'export class FixtureContext {}',
    '',
  ].join('\n'),
  'tests/meta/route-contracts.json': JSON.stringify(
    {
      schemaVersion: 1,
      routes: [
        {
          method: 'GET',
          path: '/api/health',
          testFile: 'tests/api/health.spec.ts',
          testTitle: routeTestTitle,
        },
      ],
    },
    null,
    2,
  ),
};

async function writeRepositoryFile(
  root: string,
  relativePath: string,
  contents: string,
): Promise<void> {
  const destination = path.join(root, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, contents, 'utf8');
}

async function createCompleteRepository(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'validate-repo-'));

  for (const [relativePath, contents] of Object.entries(completeFiles)) {
    await writeRepositoryFile(root, relativePath, contents);
  }

  return root;
}

async function removeRepository(root: string): Promise<void> {
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50,
  });
}

function runValidator(root: string): SpawnSyncReturns<string> {
  return spawnSync(
    process.execPath,
    [validatorPath, '--root', path.resolve(root)],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    },
  );
}

function expectRejected(
  result: SpawnSyncReturns<string>,
  diagnostic: string,
): void {
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain(diagnostic);
}

const orphanRuntimeExports = [
  {
    kind: 'function',
    source: 'export function orphanRuntimeHelper(): void {}\n',
  },
  {
    kind: 'const',
    source: 'export const orphanRuntimeHelper = 1;\n',
  },
  {
    kind: 'class',
    source: 'export class OrphanRuntimeHelper {}\n',
  },
  {
    kind: 'default function',
    source: 'export default function orphanRuntimeHelper(): void {}\n',
  },
  {
    kind: 'anonymous default function',
    source: 'export default function (): void {}\n',
  },
  {
    kind: 'export list',
    source: 'function orphanRuntimeHelper(): void {}\nexport { orphanRuntimeHelper };\n',
  },
  {
    kind: 're-export list',
    source: "export { test as orphanRuntimeHelper } from '@playwright/test';\n",
  },
  {
    kind: 'destructured const',
    source: 'export const { orphanRuntimeHelper } = { orphanRuntimeHelper: 1 };\n',
  },
] as const;

for (const orphanExport of orphanRuntimeExports) {
  test(`rejects an unconsumed exported runtime ${orphanExport.kind} under tests/fixtures`, async () => {
    const root = await createCompleteRepository();

    try {
      await writeRepositoryFile(
        root,
        'tests/fixtures/helpers/orphan-runtime.ts',
        orphanExport.source,
      );

      expectRejected(runValidator(root), 'orphan-runtime.ts');
    } finally {
      await removeRepository(root);
    }
  });
}

test('rejects a script that is unreachable from package scripts or workflow entrypoints', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      'scripts/orphan.mjs',
      "export const orphan = 'unreachable';\n",
    );

    expectRejected(runValidator(root), 'orphan.mjs');
  } finally {
    await removeRepository(root);
  }
});

test('rejects a package script whose Node entrypoint does not exist', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      'package.json',
      JSON.stringify(
        {
          name: 'validate-repo-fixture',
          private: true,
          scripts: {
            validate: 'node scripts/entry.mjs',
            broken: 'node scripts/missing.mjs',
          },
        },
        null,
        2,
      ),
    );

    expectRejected(runValidator(root), 'missing.mjs');
  } finally {
    await removeRepository(root);
  }
});

test('rejects a package script whose Node entrypoint escapes the repository', async () => {
  const root = await createCompleteRepository();
  const outsideScript = path.join(
    path.dirname(root),
    `${path.basename(root)}-outside.mjs`,
  );

  try {
    await writeFile(outsideScript, "export const outside = true;\n", 'utf8');
    await writeRepositoryFile(
      root,
      'package.json',
      JSON.stringify(
        {
          name: 'validate-repo-fixture',
          private: true,
          scripts: {
            validate: 'node scripts/entry.mjs',
            outside: `node ../${path.basename(outsideScript)}`,
          },
        },
        null,
        2,
      ),
    );

    expectRejected(runValidator(root), 'outside');
  } finally {
    await rm(outsideScript, { force: true });
    await removeRepository(root);
  }
});

test('rejects a workflow Node entrypoint that escapes the repository', async () => {
  const root = await createCompleteRepository();
  const outsideScript = path.join(
    path.dirname(root),
    `${path.basename(root)}-workflow-outside.mjs`,
  );

  try {
    await writeFile(outsideScript, "export const outside = true;\n", 'utf8');
    await writeRepositoryFile(
      root,
      '.github/workflows/check.yml',
      [
        'name: Check',
        'jobs:',
        '  validate:',
        '    steps:',
        `      - run: node ../${path.basename(outsideScript)}`,
        '',
      ].join('\n'),
    );

    expectRejected(runValidator(root), 'outside');
  } finally {
    await rm(outsideScript, { force: true });
    await removeRepository(root);
  }
});

test('ignores Node-like prose outside workflow run commands', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      '.github/workflows/check.yml',
      'name: Review node scripts/not-an-entrypoint.mjs safely\n',
    );

    const result = runValidator(root);
    expect(result.status, result.stderr).toBe(0);
  } finally {
    await removeRepository(root);
  }
});

test('rejects a registered route absent from the route contract manifest', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      'src/create-application.js',
      [
        'export function createApplication(createRouter) {',
        '  return createRouter([',
        '    {',
        "      method: 'GET',",
        "      path: '/api/health',",
        '      handler: async () => undefined,',
        '    },',
        '    {',
        "      method: 'GET',",
        "      path: '/api/new',",
        '      handler: async () => undefined,',
        '    },',
        '  ]);',
        '}',
        '',
      ].join('\n'),
    );

    const result = runValidator(root);
    expectRejected(result, 'GET');
    expect(`${result.stdout}\n${result.stderr}`).toContain('/api/new');
  } finally {
    await removeRepository(root);
  }
});

test('rejects a non-inline route registry instead of accepting an empty manifest', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      'src/create-application.js',
      [
        "const routes = [{ method: 'GET', path: '/api/health' }];",
        'export function createApplication(createRouter) {',
        '  return createRouter(routes);',
        '}',
        '',
      ].join('\n'),
    );
    await writeRepositoryFile(
      root,
      'tests/meta/route-contracts.json',
      JSON.stringify({ schemaVersion: 1, routes: [] }, null, 2),
    );

    expectRejected(runValidator(root), 'createRouter');
  } finally {
    await removeRepository(root);
  }
});

test('rejects spreads inside the inline route registry', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      'src/create-application.js',
      [
        'const additionalRoutes = [];',
        'export function createApplication(createRouter) {',
        '  return createRouter([',
        "    { method: 'GET', path: '/api/health' },",
        '    ...additionalRoutes,',
        '  ]);',
        '}',
        '',
      ].join('\n'),
    );

    expectRejected(runValidator(root), 'createRouter');
  } finally {
    await removeRepository(root);
  }
});

test('rejects a route contract backed only by a title string in a spec file', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      'tests/api/health.spec.ts',
      [
        'import {',
        '  FixtureContext,',
        '  createFixture,',
        '  fixtureName,',
        "} from '../fixtures/runtime-helper';",
        '',
        `export const claimedTestTitle = '${routeTestTitle}';`,
        'void new FixtureContext();',
        'void createFixture();',
        'void fixtureName;',
        '',
      ].join('\n'),
    );

    expectRejected(runValidator(root), routeTestTitle);
  } finally {
    await removeRepository(root);
  }
});

test('rejects a route contract backed by a local function named test', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      'tests/api/health.spec.ts',
      [
        'import {',
        '  FixtureContext,',
        '  createFixture,',
        '  fixtureName,',
        "} from '../fixtures/runtime-helper';",
        '',
        'function test(_title: string, callback: () => void): void { callback(); }',
        `test('${routeTestTitle}', () => {`,
        '  void new FixtureContext();',
        '  void createFixture();',
        '  void fixtureName;',
        '});',
        '',
      ].join('\n'),
    );

    expectRejected(runValidator(root), routeTestTitle);
  } finally {
    await removeRepository(root);
  }
});

test('rejects a route contract that aliases a non-test Playwright export as test', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      'tests/api/health.spec.ts',
      [
        "import { expect as test } from '@playwright/test';",
        'import {',
        '  FixtureContext,',
        '  createFixture,',
        '  fixtureName,',
        "} from '../fixtures/runtime-helper';",
        '',
        `test('${routeTestTitle}', () => {`,
        '  void new FixtureContext();',
        '  void createFixture();',
        '  void fixtureName;',
        '});',
        '',
      ].join('\n'),
    );

    expectRejected(runValidator(root), routeTestTitle);
  } finally {
    await removeRepository(root);
  }
});

test('rejects a route contract outside an executable Playwright spec', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(root, 'README.md', `${routeTestTitle}\n`);
    await writeRepositoryFile(
      root,
      'tests/meta/route-contracts.json',
      JSON.stringify(
        {
          schemaVersion: 1,
          routes: [
            {
              method: 'GET',
              path: '/api/health',
              testFile: 'README.md',
              testTitle: routeTestTitle,
            },
          ],
        },
        null,
        2,
      ),
    );

    expectRejected(runValidator(root), 'README.md');
  } finally {
    await removeRepository(root);
  }
});

test('rejects a route contract spec outside the tests tree', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      'outside.spec.ts',
      [
        "import { test } from '@playwright/test';",
        `test('${routeTestTitle}', () => {});`,
        '',
      ].join('\n'),
    );
    await writeRepositoryFile(
      root,
      'tests/meta/route-contracts.json',
      JSON.stringify(
        {
          schemaVersion: 1,
          routes: [
            {
              method: 'GET',
              path: '/api/health',
              testFile: 'outside.spec.ts',
              testTitle: routeTestTitle,
            },
          ],
        },
        null,
        2,
      ),
    );

    expectRejected(runValidator(root), 'outside.spec.ts');
  } finally {
    await removeRepository(root);
  }
});

test('accepts a complete repository with reachable helpers and exact route contracts', async () => {
  const root = await createCompleteRepository();

  try {
    const result = runValidator(root);

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('Repository structure validated.');
  } finally {
    await removeRepository(root);
  }
});

test('accepts a route test imported from a Playwright-derived fixture', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      'tests/fixtures/playwright-fixture.ts',
      [
        "import { test as base } from '@playwright/test';",
        'export const test = base.extend({});',
        '',
      ].join('\n'),
    );
    await writeRepositoryFile(
      root,
      'tests/api/health.spec.ts',
      [
        "import { test } from '../fixtures/playwright-fixture';",
        'import {',
        '  FixtureContext,',
        '  createFixture,',
        '  fixtureName,',
        "} from '../fixtures/runtime-helper';",
        '',
        `test('${routeTestTitle}', () => {`,
        '  void new FixtureContext();',
        '  void createFixture();',
        '  void fixtureName;',
        '});',
        '',
      ].join('\n'),
    );

    const result = runValidator(root);
    expect(result.status, result.stderr).toBe(0);
  } finally {
    await removeRepository(root);
  }
});

test('accepts a consumed default fixture export', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      'tests/fixtures/default-helper.ts',
      'export default function defaultHelper(): void {}\n',
    );
    await writeRepositoryFile(
      root,
      'tests/api/health.spec.ts',
      [
        "import { test } from '@playwright/test';",
        "import defaultHelper from '../fixtures/default-helper';",
        'import {',
        '  FixtureContext,',
        '  createFixture,',
        '  fixtureName,',
        "} from '../fixtures/runtime-helper';",
        '',
        `test('${routeTestTitle}', () => {`,
        '  defaultHelper();',
        '  void new FixtureContext();',
        '  void createFixture();',
        '  void fixtureName;',
        '});',
        '',
      ].join('\n'),
    );

    const result = runValidator(root);
    expect(result.status, result.stderr).toBe(0);
  } finally {
    await removeRepository(root);
  }
});

test('accepts a script reachable through a workspace array form entry', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      'package.json',
      JSON.stringify(
        {
          name: 'validate-repo-fixture',
          private: true,
          workspaces: ['packages/app'],
          scripts: {
            validate: 'node scripts/entry.mjs',
          },
        },
        null,
        2,
      ),
    );
    await writeRepositoryFile(
      root,
      'packages/app/package.json',
      JSON.stringify(
        {
          name: 'app',
          private: true,
          scripts: {
            build: 'node ../../scripts/workspace-entry.mjs',
          },
        },
        null,
        2,
      ),
    );
    await writeRepositoryFile(
      root,
      'scripts/workspace-entry.mjs',
      "export const workspaceEntry = true;\n",
    );

    const result = runValidator(root);
    expect(result.status, result.stderr).toBe(0);
  } finally {
    await removeRepository(root);
  }
});

test('accepts a script reachable through a workspace object form entry', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      'package.json',
      JSON.stringify(
        {
          name: 'validate-repo-fixture',
          private: true,
          workspaces: { packages: ['packages/app'] },
          scripts: {
            validate: 'node scripts/entry.mjs',
          },
        },
        null,
        2,
      ),
    );
    await writeRepositoryFile(
      root,
      'packages/app/package.json',
      JSON.stringify(
        {
          name: 'app',
          private: true,
          scripts: {
            build: 'node ../../scripts/workspace-entry.mjs',
          },
        },
        null,
        2,
      ),
    );
    await writeRepositoryFile(
      root,
      'scripts/workspace-entry.mjs',
      "export const workspaceEntry = true;\n",
    );

    const result = runValidator(root);
    expect(result.status, result.stderr).toBe(0);
  } finally {
    await removeRepository(root);
  }
});

test('rejects a workspace entry with glob metacharacters', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      'package.json',
      JSON.stringify(
        {
          name: 'validate-repo-fixture',
          private: true,
          workspaces: ['packages/*'],
          scripts: {
            validate: 'node scripts/entry.mjs',
          },
        },
        null,
        2,
      ),
    );

    expectRejected(runValidator(root), 'glob metacharacters');
  } finally {
    await removeRepository(root);
  }
});

test('rejects a workspace entry outside the repository', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      'package.json',
      JSON.stringify(
        {
          name: 'validate-repo-fixture',
          private: true,
          workspaces: ['../outside'],
          scripts: {
            validate: 'node scripts/entry.mjs',
          },
        },
        null,
        2,
      ),
    );

    expectRejected(runValidator(root), 'outside the repository');
  } finally {
    await removeRepository(root);
  }
});

test('rejects a workspace entry whose package.json is missing', async () => {
  const root = await createCompleteRepository();

  try {
    await writeRepositoryFile(
      root,
      'package.json',
      JSON.stringify(
        {
          name: 'validate-repo-fixture',
          private: true,
          workspaces: ['packages/missing'],
          scripts: {
            validate: 'node scripts/entry.mjs',
          },
        },
        null,
        2,
      ),
    );

    expectRejected(runValidator(root), 'missing or invalid');
  } finally {
    await removeRepository(root);
  }
});

test('rejects a malformed workspace object without an array of packages', async () => {
  const root = await createCompleteRepository();

  try {
    const packageJson = JSON.parse(completeFiles['package.json']);
    packageJson.workspaces = { packages: null };
    await writeRepositoryFile(root, 'package.json', JSON.stringify(packageJson));

    expectRejected(runValidator(root), 'Workspace declaration is invalid');
  } finally {
    await removeRepository(root);
  }
});

test('rejects an explicit null workspace declaration', async () => {
  const root = await createCompleteRepository();

  try {
    const packageJson = JSON.parse(completeFiles['package.json']);
    packageJson.workspaces = null;
    await writeRepositoryFile(root, 'package.json', JSON.stringify(packageJson));

    expectRejected(runValidator(root), 'Workspace declaration is invalid');
  } finally {
    await removeRepository(root);
  }
});

test('rejects a non-string workspace entry without reflecting it', async () => {
  const root = await createCompleteRepository();

  try {
    const packageJson = JSON.parse(completeFiles['package.json']);
    packageJson.workspaces = [{ secret: 'WORKSPACE_SECRET_SENTINEL' }];
    await writeRepositoryFile(root, 'package.json', JSON.stringify(packageJson));

    const result = runValidator(root);
    expectRejected(result, 'Workspace entry must be a literal string');
    expect(`${result.stdout}\n${result.stderr}`).not.toContain(
      'WORKSPACE_SECRET_SENTINEL',
    );
  } finally {
    await removeRepository(root);
  }
});

test('rejects a workspace package.json whose JSON value is null', async () => {
  const root = await createCompleteRepository();

  try {
    const packageJson = JSON.parse(completeFiles['package.json']);
    packageJson.workspaces = ['packages/app'];
    await writeRepositoryFile(root, 'package.json', JSON.stringify(packageJson));
    await writeRepositoryFile(root, 'packages/app/package.json', 'null');

    expectRejected(runValidator(root), 'Workspace package.json must be an object');
  } finally {
    await removeRepository(root);
  }
});

test('rejects a workspace symlink or junction that resolves outside the repository', async () => {
  const root = await createCompleteRepository();
  const external = await mkdtemp(path.join(tmpdir(), 'validate-repo-workspace-external-'));

  try {
    const packageJson = JSON.parse(completeFiles['package.json']);
    packageJson.workspaces = ['packages/app'];
    await writeRepositoryFile(root, 'package.json', JSON.stringify(packageJson));
    await writeRepositoryFile(
      external,
      'package.json',
      JSON.stringify({ name: 'external', scripts: {} }),
    );
    await mkdir(path.join(root, 'packages'), { recursive: true });
    await symlink(
      external,
      path.join(root, 'packages', 'app'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    expectRejected(runValidator(root), 'Workspace path is not a real repository directory');
  } finally {
    await removeRepository(root);
    await rm(external, { recursive: true, force: true });
  }
});

test('accepts the real repository', () => {
  const result = runValidator(repositoryRoot);

  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout.trim()).toBe('Repository structure validated.');
});
