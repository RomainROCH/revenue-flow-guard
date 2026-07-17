import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..', '..');
const checkoutPin =
  'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6';
const setupNodePin =
  'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6';
const uploadPin =
  'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7';

function read(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8').replaceAll('\r\n', '\n');
}

function namedStep(workflow: string, name: string) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  expect(start, `missing workflow step: ${name}`).toBeGreaterThanOrEqual(0);
  const nextNamed = workflow.indexOf('\n      - name:', start + 1);
  const nextUnnamed = workflow.indexOf('\n      - uses:', start + 1);
  const boundaries = [nextNamed, nextUnnamed].filter((index) => index >= 0);
  const end = boundaries.length === 0 ? workflow.length : Math.min(...boundaries);
  return workflow.slice(start, end);
}

function expectAlwaysRunStep(workflow: string, name: string, command: string) {
  const step = namedStep(workflow, name);
  expect(step).toContain('if: ${{ always() }}');
  expect(step).toContain(`run: ${command}`);
  return step;
}

test.describe('authoritative pull-request workflow', () => {
  test('uses immutable current actions, npm-only caching, and least privilege', () => {
    const workflow = read('.github/workflows/playwright.yml');

    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain(`uses: ${checkoutPin}`);
    expect(workflow).toContain(`uses: ${setupNodePin}`);
    expect(workflow).toContain(`uses: ${uploadPin}`);
    expect(workflow).not.toMatch(/uses:\s*actions\/(?:checkout|setup-node|upload-artifact)@v\d+/);
    expect(workflow).not.toContain('actions/cache@');
    expect(workflow).not.toContain('ms-playwright');

    const setup = namedStep(workflow, 'Set up Node.js');
    expect(setup).toContain('cache: npm');
    expect(setup).toContain('cache-dependency-path: package-lock.json');
    expect(namedStep(workflow, 'Check out repository')).toContain(
      'persist-credentials: false',
    );
  });

  test('runs every independent gate in order and propagates upstream outcomes', () => {
    const workflow = read('.github/workflows/playwright.yml');
    const expectedOrder = [
      'Install dependencies',
      'Install Chromium',
      'Validate workflow policy',
      'Lint',
      'Typecheck',
      'Verify deterministic quality',
      'Build public evidence',
      'Validate public artifacts',
      'Scan tracked and public files for secrets',
      'Upload public evidence',
    ];
    const positions = expectedOrder.map((name) => workflow.indexOf(`- name: ${name}`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));

    expect(namedStep(workflow, 'Install dependencies')).toContain('run: npm ci');
    expect(namedStep(workflow, 'Install Chromium')).toContain(
      'run: npx playwright install --with-deps chromium',
    );
    expect(
      expectAlwaysRunStep(
        workflow,
        'Validate workflow policy',
        'npm run validate:workflows',
      ),
    ).toContain('id: workflow_policy');
    expect(expectAlwaysRunStep(workflow, 'Lint', 'npm run lint')).toContain('id: lint');
    expect(expectAlwaysRunStep(workflow, 'Typecheck', 'npm run typecheck')).toContain(
      'id: typecheck',
    );
    expect(
      expectAlwaysRunStep(
        workflow,
        'Verify deterministic quality',
        'npm run verify:quality',
      ),
    ).toContain('id: quality');

    const build = expectAlwaysRunStep(
      workflow,
      'Build public evidence',
      'npm run build:evidence',
    );
    expect(build).toContain('RFG_REQUIRED_GATES_PASSED:');
    for (const outcome of [
      "steps.workflow_policy.outcome == 'success'",
      "steps.lint.outcome == 'success'",
      "steps.typecheck.outcome == 'success'",
      "steps.quality.outcome == 'success'",
    ]) {
      expect(build).toContain(outcome);
    }

    expectAlwaysRunStep(
      workflow,
      'Validate public artifacts',
      'npm run validate:public-artifacts',
    );
    expectAlwaysRunStep(
      workflow,
      'Scan tracked and public files for secrets',
      'npm run scan:secrets',
    );
    expect(workflow).not.toContain('npm run baseline:json');
    expect(workflow).not.toContain('npm run prove:regressions');
    expect(workflow).not.toContain('run: npx playwright test\n');
  });

  test('uploads only the fail-closed public allowlist even after earlier failures', () => {
    const workflow = read('.github/workflows/playwright.yml');
    const upload = namedStep(workflow, 'Upload public evidence');

    expect(upload).toContain(`uses: ${uploadPin}`);
    expect(upload).toContain('if: ${{ always() }}');
    expect(upload).toContain('name: revenue-flow-guard-evidence');
    expect(upload).toContain(
      'path: |\n            artifacts/public-evidence\n            artifacts/validation/secret-scan.json',
    );
    expect(upload).toContain('if-no-files-found: error');
    for (const forbidden of [
      'playwright-report',
      'test-results',
      'internal-proof',
      'trace.zip',
      '.env',
    ]) {
      expect(upload).not.toContain(forbidden);
    }
  });
});

test.describe('scheduled cross-browser workflow', () => {
  test('runs only manually or weekly with immutable actions and no browser cache', () => {
    const workflow = read('.github/workflows/cross-browser.yml');
    const triggerBlock = workflow.slice(workflow.indexOf('on:'), workflow.indexOf('permissions:'));

    expect(triggerBlock).toContain('schedule:');
    expect(triggerBlock).toContain('workflow_dispatch:');
    expect(triggerBlock).not.toContain('push:');
    expect(triggerBlock).not.toContain('pull_request:');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain(`uses: ${checkoutPin}`);
    expect(workflow).toContain(`uses: ${setupNodePin}`);
    expect(workflow).not.toContain('actions/cache@');
    expect(workflow).not.toContain('ms-playwright');
    expect(namedStep(workflow, 'Set up Node.js')).toContain('cache: npm');
    expect(namedStep(workflow, 'Check out repository')).toContain(
      'persist-credentials: false',
    );
  });

  test('installs and runs the exact three browsers once without publishing evidence', () => {
    const workflow = read('.github/workflows/cross-browser.yml');

    expect(namedStep(workflow, 'Install browsers')).toContain(
      'run: npx playwright install --with-deps chromium firefox webkit',
    );
    const run = namedStep(workflow, 'Run cross-browser baseline');
    expect(run).toContain(
      'run: npx playwright test tests/api tests/ui --config=playwright.cross-browser.config.ts --retries=0 --workers=1',
    );
    expect(workflow).not.toContain('upload-artifact');
    expect(workflow).not.toContain('build:evidence');
    expect(workflow).not.toContain('validate:public-artifacts');

    const config = read('playwright.cross-browser.config.ts');
    for (const browser of ['chromium', 'firefox', 'webkit']) {
      expect(config).toContain(`name: '${browser}'`);
    }
    expect(config.match(/name: '(?:chromium|firefox|webkit)'/g)).toHaveLength(3);
  });
});

test('the repository workflow validator is wired and passes the canonical files', () => {
  const packageJson = JSON.parse(read('package.json'));
  expect(packageJson.scripts['validate:workflows']).toBe(
    'node scripts/validate-workflows.mjs',
  );

  const result = spawnSync(process.execPath, ['scripts/validate-workflows.mjs'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe('Workflow policy validated.');
});

test('handles CRLF line endings in canonical workflow files', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'rfg-workflow-crlf-'));
  try {
    mkdirSync(join(tmp, 'scripts'), { recursive: true });
    mkdirSync(join(tmp, '.github', 'workflows'), { recursive: true });
    cpSync(
      join(root, 'scripts', 'validate-workflows.mjs'),
      join(tmp, 'scripts', 'validate-workflows.mjs'),
    );

    const files: Array<[string, string]> = [
      ['.github/workflows/playwright.yml', join(root, '.github/workflows/playwright.yml')],
      ['.github/workflows/cross-browser.yml', join(root, '.github/workflows/cross-browser.yml')],
      ['playwright.cross-browser.config.ts', join(root, 'playwright.cross-browser.config.ts')],
      ['package.json', join(root, 'package.json')],
    ];
    for (const [relative, source] of files) {
      writeFileSync(join(tmp, relative), readFileSync(source, 'utf8').replace(/\r?\n/g, '\r\n'), 'utf8');
    }

    const result = spawnSync(process.execPath, ['scripts/validate-workflows.mjs'], {
      cwd: tmp,
      encoding: 'utf8',
      windowsHide: true,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('Workflow policy validated.');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
