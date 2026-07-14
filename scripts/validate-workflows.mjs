import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkout = 'actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6';
const setupNode = 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6';
const uploadArtifact = 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7';
const requiredGateExpression = "\${{ steps.workflow_policy.outcome == 'success' && steps.lint.outcome == 'success' && steps.typecheck.outcome == 'success' && steps.quality.outcome == 'success' }}";

function occurrences(text, fragment) {
  return text.split(fragment).length - 1;
}

function hasAll(text, fragments) {
  return fragments.every((fragment) => text.includes(fragment));
}

function namedStep(text, name) {
  const start = text.indexOf(`      - name: ${name}\n`);
  if (start < 0) return '';
  const next = text.indexOf('\n      - name:', start + 1);
  return text.slice(start, next < 0 ? text.length : next);
}

function stepHasAll(text, name, fragments) {
  const step = namedStep(text, name);
  return step.length > 0 && hasAll(step, fragments);
}

function hasStepOrder(text, names) {
  const positions = names.map((name) => text.indexOf(`      - name: ${name}\n`));
  return (
    positions.every((position) => position >= 0) &&
    positions.every((position, index) => index === 0 || position > positions[index - 1])
  );
}

function assertImmutableActions(text, allowedActions) {
  const actionLines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('uses:'));

  return (
    actionLines.length === allowedActions.length &&
    actionLines.every((line, index) => line === `uses: ${allowedActions[index]}`) &&
    actionLines.every((line) => /@[0-9a-f]{40} # v\d+$/u.test(line))
  );
}

function validatePullRequestWorkflow(text) {
  const requiredFragments = [
    'name: Revenue Flow Guard',
    'push:',
    'pull_request:',
    '- main',
    '- master',
    'permissions:',
    'contents: read',
    'concurrency:',
    'cancel-in-progress: true',
    'runs-on: ubuntu-latest',
    '- name: Check out repository',
    'persist-credentials: false',
    '- name: Set up Node.js',
    'node-version: 22.x',
    'cache: npm',
    'cache-dependency-path: package-lock.json',
    '- name: Install dependencies',
    'run: npm ci',
    '- name: Install Chromium',
    'run: npx playwright install --with-deps chromium',
    '- name: Validate workflow policy',
    'id: workflow_policy',
    'run: npm run validate:workflows',
    '- name: Lint',
    'id: lint',
    'run: npm run lint',
    '- name: Typecheck',
    'id: typecheck',
    'run: npm run typecheck',
    '- name: Verify deterministic quality',
    'id: quality',
    'run: npm run verify:quality',
    '- name: Build public evidence',
    `RFG_REQUIRED_GATES_PASSED: ${requiredGateExpression}`,
    'run: npm run build:evidence',
    '- name: Validate public artifacts',
    'run: npm run validate:public-artifacts',
    '- name: Scan tracked and public files for secrets',
    'run: npm run scan:secrets',
    '- name: Upload public evidence',
    'name: revenue-flow-guard-evidence',
    'artifacts/public-evidence',
    'artifacts/validation/secret-scan.json',
    'if-no-files-found: error',
    'retention-days: 14',
  ];

  const orderedSteps = [
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
  const alwaysSteps = [
    ['Validate workflow policy', ['id: workflow_policy', 'run: npm run validate:workflows']],
    ['Lint', ['id: lint', 'run: npm run lint']],
    ['Typecheck', ['id: typecheck', 'run: npm run typecheck']],
    ['Verify deterministic quality', ['id: quality', 'run: npm run verify:quality']],
    ['Build public evidence', [`RFG_REQUIRED_GATES_PASSED: ${requiredGateExpression}`, 'run: npm run build:evidence']],
    ['Validate public artifacts', ['run: npm run validate:public-artifacts']],
    ['Scan tracked and public files for secrets', ['run: npm run scan:secrets']],
    ['Upload public evidence', [`uses: ${uploadArtifact}`, 'if-no-files-found: error']],
  ];

  return (
    hasAll(text, requiredFragments) &&
    hasStepOrder(text, orderedSteps) &&
    alwaysSteps.every(([name, fragments]) =>
      stepHasAll(text, name, ['if: ${{ always() }}', ...fragments]),
    ) &&
    occurrences(text, 'if: ${{ always() }}') === 8 &&
    occurrences(text, '- main') === 2 &&
    occurrences(text, '- master') === 2 &&
    occurrences(text, 'artifacts/public-evidence') === 1 &&
    occurrences(text, 'artifacts/validation/secret-scan.json') === 1 &&
    !text.includes('playwright-report') &&
    !text.includes('test-results') &&
    !text.includes('internal-proof') &&
    !text.includes('npm run baseline:json') &&
    !text.includes('npm run prove:regressions') &&
    !text.includes('run: npx playwright test\n') &&
    !text.includes('actions/cache@') &&
    !text.includes('playwright/.cache') &&
    assertImmutableActions(text, [checkout, setupNode, uploadArtifact])
  );
}

function validateCrossBrowserWorkflow(text) {
  const requiredFragments = [
    'name: Revenue Flow Guard cross-browser',
    'schedule:',
    "cron: '17 4 * * 3'",
    'workflow_dispatch:',
    'permissions:',
    'contents: read',
    'concurrency:',
    'cancel-in-progress: true',
    'runs-on: ubuntu-latest',
    '- name: Check out repository',
    'persist-credentials: false',
    '- name: Set up Node.js',
    'node-version: 22.x',
    'cache: npm',
    'cache-dependency-path: package-lock.json',
    '- name: Install dependencies',
    'run: npm ci',
    '- name: Install browsers',
    'run: npx playwright install --with-deps chromium firefox webkit',
    '- name: Run cross-browser baseline',
    'run: npx playwright test tests/api tests/ui --config=playwright.cross-browser.config.ts --retries=0 --workers=1',
  ];

  const cron = text.match(/cron:\s*['"]([^'"]+)['"]/u)?.[1]?.trim().split(/\s+/u);
  const nonRoundMinute = cron?.length === 5 && !['0', '15', '30', '45'].includes(cron[0]);

  return (
    hasAll(text, requiredFragments) &&
    hasStepOrder(text, [
      'Check out repository',
      'Set up Node.js',
      'Install dependencies',
      'Install browsers',
      'Run cross-browser baseline',
    ]) &&
    stepHasAll(text, 'Check out repository', [
      `uses: ${checkout}`,
      'persist-credentials: false',
    ]) &&
    stepHasAll(text, 'Set up Node.js', [
      `uses: ${setupNode}`,
      'cache: npm',
      'cache-dependency-path: package-lock.json',
    ]) &&
    nonRoundMinute &&
    !text.includes('push:') &&
    !text.includes('pull_request:') &&
    !text.includes('upload-artifact') &&
    !text.includes('actions/cache@') &&
    assertImmutableActions(text, [checkout, setupNode])
  );
}

function validateCrossBrowserConfig(text) {
  return (
    hasAll(text, [
      "import baseConfig from './playwright.config';",
      '...baseConfig',
      "reporter: [['list']]",
      'retries: 0',
      "name: 'chromium'",
      "...devices['Desktop Chrome']",
      "name: 'firefox'",
      "...devices['Desktop Firefox']",
      "name: 'webkit'",
      "...devices['Desktop Safari']",
    ]) &&
    occurrences(text, "name: '") === 3 &&
    occurrences(text, '...devices[') === 3
  );
}

async function main() {
  try {
    const [pullRequestWorkflow, crossBrowserWorkflow, crossBrowserConfig, packageText] = await Promise.all([
      readFile(resolve(root, '.github/workflows/playwright.yml'), 'utf8'),
      readFile(resolve(root, '.github/workflows/cross-browser.yml'), 'utf8'),
      readFile(resolve(root, 'playwright.cross-browser.config.ts'), 'utf8'),
      readFile(resolve(root, 'package.json'), 'utf8'),
    ]);
    const packageJson = JSON.parse(packageText);

    if (
      !validatePullRequestWorkflow(pullRequestWorkflow) ||
      !validateCrossBrowserWorkflow(crossBrowserWorkflow) ||
      !validateCrossBrowserConfig(crossBrowserConfig) ||
      packageJson.scripts?.['validate:workflows'] !== 'node scripts/validate-workflows.mjs'
    ) {
      throw new Error('policy drift');
    }

    process.stdout.write('Workflow policy validated.\n');
  } catch {
    process.stderr.write('Workflow policy validation failed.\n');
    process.exitCode = 1;
  }
}

await main();
