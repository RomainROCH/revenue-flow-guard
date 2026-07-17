import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  buildPublicEvidence,
  renderPublicSummary,
  validatePublicEvidence,
} from '../../scripts/lib/public-evidence.mjs';
import {
  scanPublicEvidenceDirectory,
  scanText,
  validateSecretAllowlist,
} from '../../scripts/lib/secret-scanner.mjs';

const repositoryRoot = resolve(__dirname, '../..');

const COMMIT_SHA = 'a'.repeat(40);
const GENERATED_AT = '2026-07-14T12:00:00.000Z';
const FUTURE_EXPIRY = '2027-07-14T12:00:00.000Z';
const VALIDATOR_VERSION = 'secret-scanner-v1';
const FAULT_IDS = [
  'AUTH_BYPASS',
  'CLIENT_PRICE_TRUST',
  'DUPLICATE_ORDER',
  'EMPTY_CART_ACCEPTED',
  'PAYMENT_DECLINE_HIDDEN',
  'SUBMIT_CONTROL_MISSING',
];

function signature(id: string) {
  return ['RFG', id, 'EXPECTED'].join(':');
}

function successfulBaseline() {
  return {
    schemaVersion: 1,
    status: 'passed',
    tests: 96,
    passed: 96,
    failed: 0,
    retries: 0,
    durationMs: 12_345.25,
  };
}

function successfulRegressions() {
  return {
    schemaVersion: 1,
    status: 'passed',
    faults: FAULT_IDS.map((id, index) => ({
      id,
      testId: `tests/${index < 4 ? 'api' : 'ui'}/proof-${index}.spec.ts › detects ${id}`,
      expectedSignature: signature(id),
      status: 'detected',
      observedSignature: signature(id),
      code: 'EXPECTED_REGRESSION_DETECTED',
    })),
  };
}

function buildCandidate(overrides = {}) {
  return buildPublicEvidence({
    baseline: successfulBaseline(),
    regressions: successfulRegressions(),
    commitSha: COMMIT_SHA,
    ciRunId: null,
    ciRunUrl: null,
    generatedAt: GENERATED_AT,
    ...overrides,
  });
}

test.describe('public evidence construction', () => {
  test('builds a complete candidate only from a passing baseline and six detected faults', () => {
    const candidate = buildCandidate();

    expect(candidate.schemaVersion).toBe(1);
    expect(candidate.complete).toBe(true);
    expect(candidate.sanitized).toBe(false);
    expect(candidate.source).toEqual({
      commitSha: COMMIT_SHA,
      ciRunId: null,
      ciRunUrl: null,
    });
    expect(candidate.generatedAt).toBe(GENERATED_AT);
    expect(candidate.baseline).toEqual({
      status: 'passed',
      tests: 96,
      retries: 0,
      durationMs: 12_345.25,
    });
    expect(candidate.faults).toHaveLength(6);
    expect(candidate.faults.every((fault) => fault.observedSignature === fault.expectedSignature)).toBe(
      true,
    );
    expect(validatePublicEvidence(candidate, { currentCommitSha: COMMIT_SHA })).toEqual({
      valid: true,
      code: 'VALID_PUBLIC_EVIDENCE',
    });
  });

  test('scrubs every success total when any required input is missing, failed, or interrupted', () => {
    const cases = [
      { baseline: null },
      { baseline: { ...successfulBaseline(), status: 'failed', failed: 1 } },
      { regressions: { ...successfulRegressions(), status: 'interrupted' } },
      { regressions: null },
    ];

    for (const overrides of cases) {
      const candidate = buildCandidate(overrides);
      expect(candidate.complete).toBe(false);
      expect(candidate.sanitized).toBe(false);
      expect(candidate.baseline).toEqual({
        status: 'unavailable',
        tests: null,
        retries: null,
        durationMs: null,
      });
      expect(candidate.faults).toEqual([]);
      const html = renderPublicSummary(candidate);
      expect(html).toContain('Evidence unavailable or incomplete.');
      expect(html).not.toContain('baseline tests passed');
      expect(html).not.toContain('synthetic regressions were detected');
    }
  });

  test('escapes every untrusted value rendered into the public HTML summary', () => {
    const candidate = buildCandidate();
    const payload = `<script data-x="a&b">'boom'</script>`;
    candidate.sanitized = true;
    candidate.source.commitSha = payload;
    candidate.faults[0].id = payload;
    candidate.faults[0].observedSignature = payload;

    const html = renderPublicSummary(candidate);

    expect(html).not.toContain(payload);
    expect(html).not.toContain('<script');
    expect(html).toContain(
      '&lt;script data-x=&quot;a&amp;b&quot;&gt;&#39;boom&#39;&lt;/script&gt;',
    );
  });
});

test.describe('public evidence schema', () => {
  test('requires exact schema-one metadata and coherent nullable CI fields', () => {
    const local = buildCandidate();
    const ci = buildCandidate({
      ciRunId: '987654321',
      ciRunUrl: 'https://github.com/example/repo/actions/runs/987654321',
    });

    expect(validatePublicEvidence(local, { currentCommitSha: COMMIT_SHA }).valid).toBe(true);
    expect(validatePublicEvidence(ci, { currentCommitSha: COMMIT_SHA }).valid).toBe(true);

    for (const invalid of [
      { ...local, schemaVersion: 2 },
      { ...local, source: { ...local.source, commitSha: 'not-a-sha' } },
      { ...local, generatedAt: 'tomorrow' },
      { ...local, source: { ...local.source, ciRunId: '123', ciRunUrl: null } },
      {
        ...local,
        source: {
          ...local.source,
          ciRunId: null,
          ciRunUrl: 'https://example.test/run/123',
        },
      },
      {
        ...local,
        source: {
          ...local.source,
          ciRunId: '123',
          ciRunUrl: 'https://github.com/example/repo/actions/runs/456',
        },
      },
      {
        ...local,
        source: {
          ...local.source,
          ciRunId: 'not-numeric',
          ciRunUrl: 'https://github.com/example/repo/actions/runs/not-numeric',
        },
      },
      { ...local, extra: true },
    ]) {
      expect(validatePublicEvidence(invalid, { currentCommitSha: COMMIT_SHA }).valid).toBe(
        false,
      );
    }
  });

  test('requires the six canonical IDs, unique testIds and signatures, matching observations, and detected statuses', () => {
    const candidate = buildCandidate();
    const duplicate = structuredClone(candidate);
    duplicate.faults[1].id = duplicate.faults[0].id;
    const duplicateTest = structuredClone(candidate);
    duplicateTest.faults[1].testId = duplicateTest.faults[0].testId;
    const duplicateSignature = structuredClone(candidate);
    duplicateSignature.faults[1].expectedSignature =
      duplicateSignature.faults[0].expectedSignature;
    const unexpectedId = structuredClone(candidate);
    unexpectedId.faults[0].id = 'UNKNOWN_FAULT';
    const mismatchedObservation = structuredClone(candidate);
    mismatchedObservation.faults[0].observedSignature = [
      'RFG',
      'AUTH_BYPASS',
      'WRONG',
    ].join(':');
    const notDetected = structuredClone(candidate);
    (notDetected.faults[0] as { status: string }).status = 'not_detected';

    for (const invalid of [
      duplicate,
      duplicateTest,
      duplicateSignature,
      unexpectedId,
      mismatchedObservation,
      notDetected,
    ]) {
      expect(validatePublicEvidence(invalid, { currentCommitSha: COMMIT_SHA }).valid).toBe(
        false,
      );
    }
  });

  test('rejects an unsupported schema and evidence for a different commit', () => {
    const candidate = buildCandidate();
    expect(
      validatePublicEvidence({ ...candidate, schemaVersion: 999 }, {
        currentCommitSha: COMMIT_SHA,
      }),
    ).toEqual({ valid: false, code: 'UNSUPPORTED_PUBLIC_EVIDENCE_SCHEMA' });
    expect(
      validatePublicEvidence(candidate, { currentCommitSha: 'b'.repeat(40) }),
    ).toEqual({ valid: false, code: 'PUBLIC_EVIDENCE_COMMIT_MISMATCH' });
  });
});

test.describe('secret text scanning', () => {
  test('detects authentication material, private keys, provider tokens, PANs, and absolute paths', () => {
    const githubToken = ['ghp', '_', 'a'.repeat(36)].join('');
    const openAiToken = ['sk', '-', 'b'.repeat(48)].join('');
    const sessionCookie = ['rfg', '_session=session-value'].join('');
    const windowsPath = ['C:', 'Users', 'person', 'private', 'evidence.json'].join('\\');
    const unixPath = ['', 'home', 'person', 'private', 'evidence.json'].join('/');
    const samples = [
      `Cookie: ${sessionCookie}`,
      `Set-Cookie: ${sessionCookie}; HttpOnly`,
      'Authorization: Bearer bearer-value',
      'X-RFG-Test-Token: test-token-value',
      'password = hunter-value',
      'credential: database-value',
      ['-----BEGIN', 'PRIVATE KEY-----'].join(' '),
      githubToken,
      openAiToken,
      '4111111111111111',
      windowsPath,
      unixPath,
    ];

    for (const sample of samples) {
      expect(scanText(sample, { source: 'evidence.json', allowlist: [] }), sample).not.toEqual(
        [],
      );
    }
  });

  test('does not flag ordinary public evidence prose', () => {
    expect(
      scanText('Six isolated regressions detected. Commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.', {
        source: 'summary.html',
        allowlist: [],
      }),
    ).toEqual([]);
  });
});

test.describe('secret allowlist', () => {
  function entry(value: string, overrides = {}) {
    return {
      sha256: createHash('sha256').update(value).digest('hex'),
      reason: 'Published inert fixture required by the security test.',
      owner: 'security@example.test',
      expiresAt: FUTURE_EXPIRY,
      ...overrides,
    };
  }

  test('accepts only exact, complete, unexpired entries with unique hashes', () => {
    const valid = entry('known-inert-value');
    expect(validateSecretAllowlist([valid], { now: GENERATED_AT })).toEqual([valid]);

    for (const invalid of [
      [{ ...valid, sha256: 'short' }],
      [{ ...valid, reason: '' }],
      [{ ...valid, owner: '' }],
      [{ ...valid, expiresAt: 'not-a-date' }],
      [{ ...valid, expiresAt: '2025-01-01T00:00:00.000Z' }],
      [{ ...valid, extra: true }],
      [valid, { ...valid }],
    ]) {
      expect(() => validateSecretAllowlist(invalid, { now: GENERATED_AT })).toThrow();
    }
  });

  test('suppresses only a match whose exact value hashes to an allowlist entry', () => {
    const secretValue = ['ghp', '_', 'c'.repeat(36)].join('');
    const source = `Authorization: Bearer ${secretValue}`;
    expect(scanText(source, { source: 'evidence.json', allowlist: [entry(secretValue)] })).toEqual(
      [],
    );
    expect(
      scanText(source, {
        source: 'evidence.json',
        allowlist: [entry('Authorization: Bearer .*')],
      }),
    ).not.toEqual([]);
    expect(
      scanText(source, { source: 'evidence.json', allowlist: [entry('evidence.json')] }),
    ).not.toEqual([]);
  });
});

test.describe('public evidence directory scanning', () => {
  async function writePublicDirectory(directory: string) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'evidence.json'), '{"schemaVersion":1}\n', 'utf8');
    await writeFile(join(directory, 'summary.html'), '<p>Regression proof passed.</p>\n', 'utf8');
  }

  test('accepts exactly evidence.json and summary.html and returns a sanitized summary', async ({}, testInfo) => {
    const directory = testInfo.outputPath('public');
    await writePublicDirectory(directory);

    await expect(
      scanPublicEvidenceDirectory({
        directory,
        trackedFiles: ['artifacts/public/evidence.json', 'artifacts/public/summary.html'],
        allowlist: [],
        commitSha: COMMIT_SHA,
      }),
    ).resolves.toEqual({
      commitSha: COMMIT_SHA,
      scannedFiles: 2,
      matches: 0,
      validatorVersion: VALIDATOR_VERSION,
    });
  });

  test('fails closed on an extra file, NUL binary content, a symlink, or an unreadable entry', async ({}, testInfo) => {
    const extraDirectory = testInfo.outputPath('extra');
    await writePublicDirectory(extraDirectory);
    await writeFile(join(extraDirectory, 'debug.log'), 'internal output', 'utf8');
    await expect(
      scanPublicEvidenceDirectory({
        directory: extraDirectory,
        trackedFiles: [],
        allowlist: [],
        commitSha: COMMIT_SHA,
      }),
    ).rejects.toThrow();

    const binaryDirectory = testInfo.outputPath('binary');
    await writePublicDirectory(binaryDirectory);
    await writeFile(join(binaryDirectory, 'summary.html'), Buffer.from([60, 112, 0, 62]));
    await expect(
      scanPublicEvidenceDirectory({
        directory: binaryDirectory,
        trackedFiles: [],
        allowlist: [],
        commitSha: COMMIT_SHA,
      }),
    ).rejects.toThrow();

    const symlinkDirectory = testInfo.outputPath('symlink');
    await mkdir(symlinkDirectory, { recursive: true });
    const outside = testInfo.outputPath('outside');
    await mkdir(outside);
    await writeFile(join(outside, 'evidence.json'), '{}', 'utf8');
    await symlink(outside, join(symlinkDirectory, 'evidence.json'), 'junction');
    await writeFile(join(symlinkDirectory, 'summary.html'), '<p>Summary</p>', 'utf8');
    await expect(
      scanPublicEvidenceDirectory({
        directory: symlinkDirectory,
        trackedFiles: [],
        allowlist: [],
        commitSha: COMMIT_SHA,
      }),
    ).rejects.toThrow();

    const unreadableDirectory = testInfo.outputPath('unreadable');
    await mkdir(join(unreadableDirectory, 'evidence.json'), { recursive: true });
    await writeFile(join(unreadableDirectory, 'summary.html'), '<p>Summary</p>', 'utf8');
    await expect(
      scanPublicEvidenceDirectory({
        directory: unreadableDirectory,
        trackedFiles: [],
        allowlist: [],
        commitSha: COMMIT_SHA,
      }),
    ).rejects.toThrow();
  });

  test('rejects a tracked .env file but permits the explicit .env.example exception', async ({}, testInfo) => {
    const directory = testInfo.outputPath('tracked-env');
    await writePublicDirectory(directory);

    await expect(
      scanPublicEvidenceDirectory({
        directory,
        trackedFiles: ['.env'],
        allowlist: [],
        commitSha: COMMIT_SHA,
      }),
    ).rejects.toThrow();
    await expect(
      scanPublicEvidenceDirectory({
        directory,
        trackedFiles: ['.env.example'],
        allowlist: [],
        commitSha: COMMIT_SHA,
      }),
    ).resolves.toMatchObject({ matches: 0 });
  });
});

test.describe('validate-public-artifacts.mjs CLI', () => {
  test('reads the downloaded artifact root from the positional argument', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'pw-public-evidence-'));
    const repoDir = join(tempDir, 'repo');
    const scriptsDir = join(repoDir, 'scripts');
    const libDir = join(scriptsDir, 'lib');
    const downloadedRoot = join(tempDir, 'downloaded');
    const publicEvDir = join(downloadedRoot, 'public-evidence');
    const validationDir = join(downloadedRoot, 'validation');

    try {
      await mkdir(libDir, { recursive: true });

      const fileMap: [string, string][] = [
        [join(repositoryRoot, 'scripts', 'validate-public-artifacts.mjs'), join(scriptsDir, 'validate-public-artifacts.mjs')],
        [join(repositoryRoot, 'scripts', 'lib', 'public-evidence.mjs'), join(libDir, 'public-evidence.mjs')],
        [join(repositoryRoot, 'scripts', 'lib', 'secret-scanner.mjs'), join(libDir, 'secret-scanner.mjs')],
      ];
      await Promise.all(fileMap.map(([src, dst]) => readFile(src).then((data) => writeFile(dst, data))));

      const git = (args: string[]) => {
        const result = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8' });
        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`git ${args[0]} exited with code ${result.status}: ${result.stderr}`);
        return result;
      };

      git(['init']);
      git(['config', 'user.email', 'test@test.test']);
      git(['config', 'user.name', 'Test']);
      git(['add', '-A']);
      git(['commit', '-m', 'init']);
      const { stdout: headSha } = git(['rev-parse', 'HEAD']);

      const baseline = successfulBaseline();
      const regressions = successfulRegressions();
      const candidate = buildPublicEvidence({
        baseline,
        regressions,
        commitSha: headSha.trim(),
        ciRunId: null,
        ciRunUrl: null,
        generatedAt: GENERATED_AT,
      });
      const promoted = { ...candidate, sanitized: true };

      await mkdir(publicEvDir, { recursive: true });
      await mkdir(validationDir, { recursive: true });
      await writeFile(join(publicEvDir, 'evidence.json'), JSON.stringify(promoted, null, 2) + '\n');
      await writeFile(join(publicEvDir, 'summary.html'), renderPublicSummary(promoted));
      await writeFile(
        join(validationDir, 'secret-scan.json'),
        JSON.stringify({
          commitSha: headSha.trim(),
          scannedFiles: 3,
          matches: 0,
          validatorVersion: 'secret-scanner-v1',
        }) + '\n',
      );

      const originalPaths = [
        join(publicEvDir, 'evidence.json'),
        join(publicEvDir, 'summary.html'),
        join(validationDir, 'secret-scan.json'),
      ];
      const originalBytes = await Promise.all(originalPaths.map((p) => readFile(p)));

      const result = spawnSync(process.execPath, [join(scriptsDir, 'validate-public-artifacts.mjs'), downloadedRoot], {
        cwd: repoDir,
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe('Downloaded public evidence validated.');

      const afterBytes = await Promise.all(originalPaths.map((p) => readFile(p)));
      expect(afterBytes).toEqual(originalBytes);

      const unexpectedFile = join(downloadedRoot, 'debug-trace.zip');
      await writeFile(unexpectedFile, Buffer.from([1, 2, 3, 4]));
      const unexpectedOriginalBytes = await readFile(unexpectedFile);

      const failedResult = spawnSync(process.execPath, [join(scriptsDir, 'validate-public-artifacts.mjs'), downloadedRoot], {
        cwd: repoDir,
        encoding: 'utf8',
      });

      expect(failedResult.status).not.toBe(0);
      expect(failedResult.stderr).toContain('Downloaded public evidence validation failed:');

      const finalPaths = [...originalPaths, unexpectedFile];
      const finalBytes = await Promise.all(finalPaths.map((p) => readFile(p)));
      expect(finalBytes).toEqual([...originalBytes, unexpectedOriginalBytes]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
