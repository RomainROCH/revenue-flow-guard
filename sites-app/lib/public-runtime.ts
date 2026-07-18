import manifest from '../../regressions/manifest.json';

type Environment = Record<string, string | undefined>;

interface ManifestEntry {
  id: string;
  testId: string;
  expectedSignature: string;
}

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const CI_RUN_ID_PATTERN = /^[1-9][0-9]*$/;
const REQUIRED_OWNER = 'RomainROCH';
const REQUIRED_REPO = 'revenue-flow-guard';

const { entries: canonicalFaults } = manifest as { entries: ManifestEntry[] };
const REQUIRED_FAULT_IDS = canonicalFaults.map((f) => f.id);

const faultContract = new Map<string, ManifestEntry>();
for (const f of canonicalFaults) {
  faultContract.set(f.id, f);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: unknown, expectedKeys: string[]): boolean {
  if (!isObject(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const sorted = [...expectedKeys].sort();
  return actualKeys.length === sorted.length && actualKeys.every((k, i) => k === sorted[i]);
}

function isValidText(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= maximumLength &&
    value.trim() === value;
}

function isValidContactUrl(value: unknown): boolean {
  if (!isValidText(value, Number.MAX_SAFE_INTEGER)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

function isIsoTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isValidCiSource(source: Record<string, unknown>): boolean {
  if (source.ciRunId === null || source.ciRunUrl === null) {
    return false;
  }

  if (
    typeof source.ciRunId !== 'string' ||
    !CI_RUN_ID_PATTERN.test(source.ciRunId) ||
    typeof source.ciRunUrl !== 'string'
  ) {
    return false;
  }

  const canonicalUrl =
    `https://github.com/${REQUIRED_OWNER}/${REQUIRED_REPO}/actions/runs/${source.ciRunId}`;
  return source.ciRunUrl === canonicalUrl;
}

function isValidSource(source: unknown, currentCommitSha: string): boolean {
  if (!hasExactKeys(source, ['commitSha', 'ciRunId', 'ciRunUrl'])) return false;
  const s = source as Record<string, unknown>;
  return typeof s.commitSha === 'string' &&
    COMMIT_SHA_PATTERN.test(s.commitSha) &&
    s.commitSha === currentCommitSha &&
    isValidCiSource(s);
}

function isValidBaseline(baseline: unknown): boolean {
  if (!hasExactKeys(baseline, ['status', 'tests', 'retries', 'durationMs'])) return false;
  const b = baseline as Record<string, unknown>;
  return b.status === 'passed' &&
    Number.isSafeInteger(b.tests) &&
    (b.tests as number) > 0 &&
    b.retries === 0 &&
    typeof b.durationMs === 'number' &&
    Number.isFinite(b.durationMs) &&
    (b.durationMs as number) >= 0;
}

function isValidFault(fault: unknown): boolean {
  if (!hasExactKeys(fault, ['id', 'testId', 'expectedSignature', 'observedSignature', 'status'])) {
    return false;
  }
  const f = fault as Record<string, string>;
  if (!faultContract.has(f.id)) return false;
  const contract = faultContract.get(f.id)!;
  return f.testId === contract.testId &&
    f.expectedSignature === contract.expectedSignature &&
    f.observedSignature === contract.expectedSignature &&
    f.status === 'detected';
}

function areValidFaults(faults: unknown): boolean {
  if (!Array.isArray(faults) || faults.length !== canonicalFaults.length) return false;

  const ids = new Set<string>();
  const testIds = new Set<string>();
  const signatures = new Set<string>();

  for (const fault of faults) {
    const f = fault as Record<string, string>;
    if (!isValidFault(fault) || ids.has(f.id) || testIds.has(f.testId) || signatures.has(f.expectedSignature)) {
      return false;
    }
    ids.add(f.id);
    testIds.add(f.testId);
    signatures.add(f.expectedSignature);
  }

  return REQUIRED_FAULT_IDS.every((id) => ids.has(id));
}

function isValidEvidence(evidence: unknown, currentCommitSha: string): boolean {
  if (!hasExactKeys(evidence, ['schemaVersion', 'complete', 'sanitized', 'source', 'generatedAt', 'baseline', 'faults'])) {
    return false;
  }
  const e = evidence as Record<string, unknown>;
  return e.schemaVersion === 1 &&
    e.complete === true &&
    e.sanitized === true &&
    isValidSource(e.source, currentCommitSha) &&
    isIsoTimestamp(e.generatedAt) &&
    isValidBaseline(e.baseline) &&
    areValidFaults(e.faults);
}

export function parseSitesPublicConfig(environment: Environment) {
  const contactUrl = environment?.PUBLIC_CONTACT_URL;
  const contactLabel = environment?.PUBLIC_CONTACT_LABEL;
  const offerName = environment?.PUBLIC_OFFER_NAME;
  const offerSummary = environment?.PUBLIC_OFFER_SUMMARY;

  if (
    !isValidContactUrl(contactUrl) ||
    !isValidText(contactLabel, 80) ||
    !isValidText(offerName, 80) ||
    !isValidText(offerSummary, 240)
  ) {
    return { publicationReady: false };
  }

  return {
    publicationReady: true,
    contact: { url: contactUrl, label: contactLabel },
    offer: { name: offerName, summary: offerSummary },
  };
}

export function parseSitesPublicEvidence(environment: Environment) {
  const currentCommitSha = environment?.SOURCE_COMMIT_SHA;
  const serializedEvidence = environment?.PUBLIC_EVIDENCE_JSON;

  if (
    typeof currentCommitSha !== 'string' ||
    !COMMIT_SHA_PATTERN.test(currentCommitSha) ||
    typeof serializedEvidence !== 'string'
  ) {
    return { available: false };
  }

  try {
    const evidence = JSON.parse(serializedEvidence);
    if (!isValidEvidence(evidence, currentCommitSha)) {
      return { available: false };
    }
    return { available: true, evidence };
  } catch {
    return { available: false };
  }
}
