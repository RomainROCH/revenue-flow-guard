import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';

const EXPECTED_PUBLIC_FILES = Object.freeze(['evidence.json', 'summary.html']);
const MAX_PUBLIC_FILE_BYTES = 1_048_576;
const VALIDATOR_VERSION = 'secret-scanner-v1';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function hasExactKeys(value, expectedKeys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expectedKeys].sort())
  );
}

function exactIsoDate(value) {
  if (typeof value !== 'string') return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
    ? milliseconds
    : null;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function validateSecretAllowlist(entries, { now = new Date().toISOString() } = {}) {
  const nowMilliseconds = exactIsoDate(now);
  if (nowMilliseconds === null || !Array.isArray(entries)) {
    throw new Error('SECRET_ALLOWLIST_INVALID');
  }

  const hashes = new Set();
  for (const entry of entries) {
    const expiry = entry?.expiresAt === undefined ? null : exactIsoDate(entry.expiresAt);
    if (
      !hasExactKeys(entry, ['expiresAt', 'owner', 'reason', 'sha256']) ||
      typeof entry.sha256 !== 'string' ||
      !SHA256_PATTERN.test(entry.sha256) ||
      typeof entry.reason !== 'string' ||
      entry.reason.trim().length === 0 ||
      typeof entry.owner !== 'string' ||
      entry.owner.trim().length === 0 ||
      expiry === null ||
      expiry <= nowMilliseconds ||
      hashes.has(entry.sha256)
    ) {
      throw new Error('SECRET_ALLOWLIST_INVALID');
    }
    hashes.add(entry.sha256);
  }
  return entries;
}

function candidatePatterns() {
  const githubPrefix = ['g', 'h', 'p', '_'].join('');
  const openAiPrefix = ['s', 'k', '-'].join('');
  return [
    ['session_cookie', /(?:Cookie|Set-Cookie)\s*:\s*[^\r\n]*?rfg_session=([^;\s]+)/gi, 1],
    ['authorization', /Authorization\s*:\s*(?:Bearer\s+)?([^\s,;]+)/gi, 1],
    ['test_token', /X-RFG-Test-Token\s*:\s*([^\s,;]+)/gi, 1],
    ['credential_assignment', /(?:password|credential)\s*[:=]\s*["']?([^\s"';,]+)/gi, 1],
    ['private_key', /-----BEGIN\s+PRIVATE KEY-----/g, 0],
    ['github_token', new RegExp(`${githubPrefix}[A-Za-z0-9]{36,}`, 'g'), 0],
    ['openai_token', new RegExp(`${openAiPrefix}[A-Za-z0-9_-]{32,}`, 'g'), 0],
    ['windows_path', /[A-Za-z]:\\(?:[^\s<>:"|?*]+\\)*[^\s<>:"|?*]*/g, 0],
    ['unix_path', /\/(?:home|Users|var|tmp|private|root)\/(?:[^\s<>:"|?*]+\/?)+/g, 0],
  ];
}

function validPan(value) {
  const digits = value.replace(/[ -]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

export function scanText(text, { source, allowlist = [], now } = {}) {
  if (typeof text !== 'string' || typeof source !== 'string') {
    throw new TypeError('SECRET_SCAN_INPUT_INVALID');
  }
  const validatedAllowlist = validateSecretAllowlist(allowlist, {
    now: now ?? new Date().toISOString(),
  });
  const allowedHashes = new Set(validatedAllowlist.map((entry) => entry.sha256));
  const matches = [];

  const addMatch = (kind, value) => {
    if (value.length === 0 || allowedHashes.has(sha256(value))) return;
    if (matches.some((match) => match.kind === kind && match.value === value)) return;
    matches.push({ kind, value, source });
  };

  for (const [kind, pattern, capture] of candidatePatterns()) {
    for (const match of text.matchAll(pattern)) addMatch(kind, match[capture]);
  }
  for (const match of text.matchAll(/\b(?:\d[ -]?){13,19}\b/g)) {
    const value = match[0].trim();
    if (validPan(value)) addMatch('payment_card', value);
  }
  return matches;
}

function rejectsTrackedEnvironment(trackedFiles) {
  return trackedFiles.some((file) => {
    const normalized = file.replaceAll('\\', '/');
    const name = normalized.split('/').at(-1);
    return name !== '.env.example' && (name === '.env' || name?.startsWith('.env.'));
  });
}

async function readStrictTextFile(directory, name) {
  const path = `${directory}/${name}`;
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_PUBLIC_FILE_BYTES) {
    throw new Error('PUBLIC_EVIDENCE_FILE_INVALID');
  }
  const bytes = await readFile(path);
  if (bytes.includes(0)) throw new Error('PUBLIC_EVIDENCE_BINARY_REJECTED');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('PUBLIC_EVIDENCE_UTF8_REQUIRED');
  }
}

export async function scanPublicEvidenceDirectory({
  directory,
  trackedFiles = [],
  allowlist = [],
  commitSha,
  now,
}) {
  if (
    typeof directory !== 'string' ||
    !Array.isArray(trackedFiles) ||
    typeof commitSha !== 'string' ||
    !/^[a-f0-9]{40}$/.test(commitSha) ||
    rejectsTrackedEnvironment(trackedFiles)
  ) {
    throw new Error('PUBLIC_EVIDENCE_SCAN_INPUT_INVALID');
  }
  const validatedAllowlist = validateSecretAllowlist(allowlist, {
    now: now ?? new Date().toISOString(),
  });
  const entries = (await readdir(directory)).sort();
  if (JSON.stringify(entries) !== JSON.stringify(EXPECTED_PUBLIC_FILES)) {
    throw new Error('PUBLIC_EVIDENCE_FILE_SET_INVALID');
  }

  const matches = [];
  for (const name of EXPECTED_PUBLIC_FILES) {
    const text = await readStrictTextFile(directory, name);
    matches.push(...scanText(text, { source: name, allowlist: validatedAllowlist, now }));
  }
  if (matches.length > 0) throw new Error('PUBLIC_EVIDENCE_SECRET_MATCH');

  return {
    commitSha,
    scannedFiles: EXPECTED_PUBLIC_FILES.length,
    matches: 0,
    validatorVersion: VALIDATOR_VERSION,
  };
}
