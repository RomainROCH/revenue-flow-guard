import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '..', '..');
const validator = resolve(repositoryRoot, 'scripts', 'validate-docs.mjs');

const validDocuments = {
  'README.md': `# Documentation fixture

Read the [test plan](docs/test-plan.md) and the
[scholarly references](docs/references.md#scholarly-references).

Run \`npm run lint\` before handing off a change.
`,
  'docs/test-plan.md': `# Test plan

Run \`npm run test\` and record the current evidence in the
[QA report](qa-report.md).
`,
  'docs/qa-report.md': `# QA report

Use machine-generated output from \`npm run test\` as the result authority.
Continue with the [handoff](handoff.md).
`,
  'docs/handoff.md': `# Handoff

Run \`npm run typecheck\` and review the
[scholarly references](references.md#scholarly-references).
`,
  'docs/references.md': `# References

## Scholarly references

- **Qingzhou Luo and Darko Marinov (2014), _A referenced study_.**
  The entry links its stable source separately. [DOI](https://doi.org/10.1000/example).
`,
} as const;

type DocumentPath = keyof typeof validDocuments;
type DocumentOverrides = Partial<Record<DocumentPath, string>>;

function runValidator(root: string) {
  return spawnSync(process.execPath, [validator, '--root', root], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
  });
}

async function withRepository(
  overrides: DocumentOverrides,
  assertion: (root: string) => void | Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'validate-docs-'));

  try {
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(
      join(root, 'package.json'),
      `${JSON.stringify(
        {
          name: 'documentation-validator-fixture',
          private: true,
          scripts: {
            lint: 'node --version',
            test: 'node --version',
            typecheck: 'node --version',
          },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    for (const [relativePath, content] of Object.entries({
      ...validDocuments,
      ...overrides,
    })) {
      await writeFile(join(root, relativePath), content, 'utf8');
    }

    await assertion(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function expectValidationFailure(root: string) {
  const result = runValidator(root);

  expect(result.status, result.stderr || result.stdout).not.toBeNull();
  expect(result.status, result.stderr || result.stdout).not.toBe(0);
}

test('accepts canonical documentation with valid local links and npm scripts', async () => {
  await withRepository({}, (root) => {
    const result = runValidator(root);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.replace(/\r?\n$/, '')).toBe('Documentation validated.');
  });
});

for (const [name, placeholder] of [
  ['REPO_OWNER', 'Owner: REPO_OWNER'],
  ['TODO', 'TODO: replace this note'],
  ['TBD', 'Status: TBD'],
] as const) {
  test(`rejects the ${name} placeholder`, async () => {
    await withRepository(
      { 'README.md': `${validDocuments['README.md']}\n${placeholder}\n` },
      expectValidationFailure,
    );
  });
}

test('rejects the false WEFix percentage claim', async () => {
  await withRepository(
    {
      'README.md': `${validDocuments['README.md']}\nWEFix catches 73% of failures.\n`,
    },
    expectValidationFailure,
  );
});

test('rejects an unsupported numeric marketing claim', async () => {
  await withRepository(
    {
      'README.md': `${validDocuments['README.md']}\nThis workflow cuts failures by 42%.\n`,
    },
    expectValidationFailure,
  );
});

for (const [name, claim] of [
  ['multiplier', 'This workflow makes releases 3x faster.'],
  ['time saving', 'This workflow saves 10 hours on every release.'],
] as const) {
  test(`rejects an unsupported numeric marketing ${name} claim`, async () => {
    await withRepository(
      { 'README.md': `${validDocuments['README.md']}\n${claim}\n` },
      expectValidationFailure,
    );
  });
}

test('rejects an unlinked scholarly citation', async () => {
  await withRepository(
    {
      'README.md': `${validDocuments['README.md']}\nThis approach follows Luo et al. (2014).\n`,
    },
    expectValidationFailure,
  );
});

test('rejects an unlinked comma-style scholarly citation', async () => {
  await withRepository(
    {
      'README.md': `${validDocuments['README.md']}\nThis approach follows Luo et al., 2014.\n`,
    },
    expectValidationFailure,
  );
});

for (const [name, staleTotal] of [
  ['table total', 'Total tests | 8'],
  ['prose total', 'All 8 tests pass'],
  ['runner total', '249 passed'],
] as const) {
  test(`rejects a stale hand-written ${name}`, async () => {
    await withRepository(
      { 'docs/qa-report.md': `${validDocuments['docs/qa-report.md']}\n${staleTotal}\n` },
      expectValidationFailure,
    );
  });
}

test('rejects a broken local Markdown link', async () => {
  await withRepository(
    {
      'README.md': `${validDocuments['README.md']}\nRead the [missing guide](docs/missing.md).\n`,
    },
    expectValidationFailure,
  );
});

test('rejects an npm run command absent from package scripts', async () => {
  await withRepository(
    {
      'docs/handoff.md': `${validDocuments['docs/handoff.md']}\nRun \`npm run missing-command\`.\n`,
    },
    expectValidationFailure,
  );
});
