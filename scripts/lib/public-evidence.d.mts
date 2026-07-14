export type PublicEvidenceFault = {
  id: string;
  testId: string;
  expectedSignature: string;
  observedSignature: string;
  status: 'detected';
};

export type PublicEvidence = {
  schemaVersion: 1;
  source: {
    commitSha: string;
    ciRunId: string | null;
    ciRunUrl: string | null;
  };
  generatedAt: string;
  complete: boolean;
  sanitized: boolean;
  baseline: {
    status: 'passed' | 'unavailable';
    tests: number | null;
    retries: number | null;
    durationMs: number | null;
  };
  faults: PublicEvidenceFault[];
};

export declare function buildPublicEvidence(input: {
  baseline: unknown;
  regressions: unknown;
  commitSha: string;
  ciRunId?: string | null;
  ciRunUrl?: string | null;
  generatedAt: string;
}): PublicEvidence;

export declare function validatePublicEvidence(
  evidence: unknown,
  options?: { currentCommitSha?: string },
):
  | { valid: true; code: 'VALID_PUBLIC_EVIDENCE' }
  | {
      valid: false;
      code:
        | 'UNSUPPORTED_PUBLIC_EVIDENCE_SCHEMA'
        | 'PUBLIC_EVIDENCE_COMMIT_MISMATCH'
        | 'INVALID_PUBLIC_EVIDENCE';
    };
export declare function renderPublicSummary(evidence: {
  complete: boolean;
  sanitized: boolean;
  baseline: { tests: number | null };
  faults: Array<{ id: string; observedSignature: string }>;
  source: { commitSha: string };
}): string;
