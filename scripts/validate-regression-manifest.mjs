import {
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { isAbsolute as isPosixAbsolute, normalize as normalizePosix } from 'node:path/posix';
import { pathToFileURL } from 'node:url';

export const TEST_ID_SEPARATOR = ' › ';

const EXPECTED_SIGNATURES = Object.freeze({
  AUTH_BYPASS: 'RFG:AUTH_BYPASS:AUTH_REQUIRED',
  CLIENT_PRICE_TRUST: 'RFG:CLIENT_PRICE_TRUST:CLIENT_AMOUNT_FORBIDDEN',
  DUPLICATE_ORDER: 'RFG:DUPLICATE_ORDER:IDEMPOTENT_REPLAY',
  EMPTY_CART_ACCEPTED: 'RFG:EMPTY_CART_ACCEPTED:EMPTY_CART_REJECTED',
  PAYMENT_DECLINE_HIDDEN: 'RFG:PAYMENT_DECLINE_HIDDEN:DECLINE_VISIBLE',
  SUBMIT_CONTROL_MISSING: 'RFG:SUBMIT_CONTROL_MISSING:SUBMIT_DISABLED',
});

const EXPECTED_IDS = Object.freeze(Object.keys(EXPECTED_SIGNATURES));
const ROOT_KEYS = Object.freeze(['entries', 'schemaVersion']);
const ENTRY_KEYS = Object.freeze(['expectedSignature', 'id', 'testId']);

function fail(message, cause) {
  throw new Error(`REGRESSION_MANIFEST: ${message}`, cause ? { cause } : undefined);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) {
    return false;
  }

  const actualKeys = Object.keys(value).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index]);
}

function isWithin(parentPath, candidatePath) {
  const pathFromParent = relative(parentPath, candidatePath);
  return pathFromParent === ''
    || (!isAbsolute(pathFromParent)
      && pathFromParent !== '..'
      && !pathFromParent.startsWith(`..${sep}`));
}

function countOccurrences(source, value) {
  let count = 0;
  let fromIndex = 0;

  while (fromIndex <= source.length - value.length) {
    const index = source.indexOf(value, fromIndex);
    if (index === -1) {
      break;
    }

    count += 1;
    fromIndex = index + value.length;
  }

  return count;
}

function collectTestFiles(directoryPath, testsRealPath, visited = new Set()) {
  let directoryRealPath;
  try {
    directoryRealPath = realpathSync(directoryPath);
  } catch (error) {
    fail(`cannot resolve tests directory ${directoryPath}`, error);
  }

  if (!isWithin(testsRealPath, directoryRealPath)) {
    fail(`tests path escapes the tests directory: ${directoryPath}`);
  }

  if (visited.has(directoryRealPath)) {
    return [];
  }
  visited.add(directoryRealPath);

  let directoryEntries;
  try {
    directoryEntries = readdirSync(directoryPath, { withFileTypes: true });
  } catch (error) {
    fail(`cannot read tests directory ${directoryPath}`, error);
  }

  const files = [];
  for (const directoryEntry of directoryEntries) {
    const entryPath = resolve(directoryPath, directoryEntry.name);
    let entryRealPath;
    let entryStats;

    try {
      entryRealPath = realpathSync(entryPath);
      entryStats = statSync(entryPath);
    } catch (error) {
      fail(`cannot inspect tests path ${entryPath}`, error);
    }

    if (!isWithin(testsRealPath, entryRealPath)) {
      fail(`tests path escapes the tests directory: ${entryPath}`);
    }

    if (entryStats.isDirectory()) {
      files.push(...collectTestFiles(entryPath, testsRealPath, visited));
    } else if (entryStats.isFile()) {
      files.push(entryRealPath);
    }
  }

  return files;
}

export function parseTestId(testId) {
  if (typeof testId !== 'string' || testId.trim() !== testId || testId.length === 0) {
    fail('testId must be a non-empty trimmed string');
  }

  const segments = testId.split(TEST_ID_SEPARATOR);
  if (segments.length < 2 || segments.some((segment) => segment.length === 0 || segment.trim() !== segment)) {
    fail(`invalid testId grammar: ${testId}`);
  }

  const [filePath, ...titleSegments] = segments;
  const pathSegments = filePath.split('/');
  if (
    filePath.includes('\\')
    || isPosixAbsolute(filePath)
    || /^[A-Za-z]:/.test(filePath)
    || !filePath.startsWith('tests/')
    || normalizePosix(filePath) !== filePath
    || pathSegments.some((segment) => segment.length === 0 || segment.trim() !== segment || segment === '..')
  ) {
    fail(`testId file path must be a normalized relative POSIX path within tests/: ${filePath}`);
  }

  return {
    filePath,
    describeTitles: titleSegments.slice(0, -1),
    testTitle: titleSegments.at(-1),
  };
}

export function loadRegressionManifest(root = process.cwd()) {
  const manifestPath = resolve(root, 'regressions', 'manifest.json');
  let source;

  try {
    source = readFileSync(manifestPath, 'utf8');
  } catch (error) {
    fail(`cannot read ${manifestPath}`, error);
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`cannot parse ${manifestPath} as JSON`, error);
  }
}

export function validateRegressionManifest(manifest, { root = process.cwd() } = {}) {
  if (!hasExactKeys(manifest, ROOT_KEYS)) {
    fail('manifest must contain exactly schemaVersion and entries');
  }
  if (manifest.schemaVersion !== 1) {
    fail('schemaVersion must equal 1');
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length !== EXPECTED_IDS.length) {
    fail(`entries must contain exactly ${EXPECTED_IDS.length} mappings`);
  }

  const rootPath = resolve(root);
  const testsPath = resolve(rootPath, 'tests');
  let rootRealPath;
  let testsRealPath;

  try {
    rootRealPath = realpathSync(rootPath);
    testsRealPath = realpathSync(testsPath);
  } catch (error) {
    fail('root and root/tests must exist', error);
  }

  if (!isWithin(rootRealPath, testsRealPath)) {
    fail('root/tests resolves outside the project root');
  }

  const allTestFiles = collectTestFiles(testsPath, testsRealPath);
  const testSources = new Map();
  for (const testFile of allTestFiles) {
    try {
      testSources.set(testFile, readFileSync(testFile, 'utf8'));
    } catch (error) {
      fail(`cannot read test file ${testFile}`, error);
    }
  }

  const seenIds = new Set();
  const seenTestIds = new Set();
  const seenSignatures = new Set();

  for (const [index, entry] of manifest.entries.entries()) {
    if (!hasExactKeys(entry, ENTRY_KEYS)) {
      fail(`entry ${index} must contain exactly expectedSignature, id, and testId`);
    }
    if (
      typeof entry.id !== 'string' ||
      typeof entry.testId !== 'string' ||
      typeof entry.expectedSignature !== 'string'
    ) {
      fail(`entry ${index} values must be strings`);
    }
    if (entry.id !== EXPECTED_IDS[index]) {
      fail(`entry ${index} must use frozen id ${EXPECTED_IDS[index]}`);
    }
    if (
      seenIds.has(entry.id) ||
      seenTestIds.has(entry.testId) ||
      seenSignatures.has(entry.expectedSignature)
    ) {
      fail(`entry ${index} duplicates an id, testId, or signature`);
    }
    seenIds.add(entry.id);
    seenTestIds.add(entry.testId);
    seenSignatures.add(entry.expectedSignature);

    if (entry.expectedSignature !== EXPECTED_SIGNATURES[entry.id]) {
      fail(`entry ${entry.id} must use signature ${EXPECTED_SIGNATURES[entry.id]}`);
    }

    const { filePath, describeTitles, testTitle } = parseTestId(entry.testId);
    const mappedPath = resolve(rootPath, ...filePath.split('/'));
    if (!isWithin(testsPath, mappedPath)) {
      fail(`mapped test file escapes root/tests: ${filePath}`);
    }

    let mappedRealPath;
    let mappedStats;
    try {
      mappedRealPath = realpathSync(mappedPath);
      mappedStats = statSync(mappedPath);
    } catch (error) {
      fail(`mapped test file does not exist: ${filePath}`, error);
    }

    if (!mappedStats.isFile() || !isWithin(testsRealPath, mappedRealPath)) {
      fail(`mapped test file must be a file within root/tests: ${filePath}`);
    }

    const mappedSource = testSources.get(mappedRealPath);
    if (mappedSource === undefined) {
      fail(`mapped test file is not part of root/tests: ${filePath}`);
    }
    for (const title of [...describeTitles, testTitle]) {
      if (!mappedSource.includes(title)) {
        fail(`mapped test title component is absent from ${filePath}: ${title}`);
      }
    }

    const mappedOccurrences = countOccurrences(
      mappedSource,
      entry.expectedSignature,
    );
    const allOccurrences = [...testSources.values()]
      .reduce(
        (total, source) =>
          total + countOccurrences(source, entry.expectedSignature),
        0,
      );
    if (mappedOccurrences !== 1) {
      fail(`signature ${entry.expectedSignature} must occur exactly once in ${filePath}; found ${mappedOccurrences}`);
    }
    if (allOccurrences !== 1) {
      fail(`signature ${entry.expectedSignature} must occur exactly once in tests/; found ${allOccurrences}`);
    }
  }

  return manifest;
}

function isDirectInvocation() {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  try {
    const manifest = loadRegressionManifest();
    validateRegressionManifest(manifest);
    process.stdout.write('6 regression mappings valid\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
