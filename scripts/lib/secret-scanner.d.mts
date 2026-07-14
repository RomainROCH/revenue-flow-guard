export type SecretAllowlistEntry = {
  sha256: string;
  reason: string;
  owner: string;
  expiresAt: string;
};

export type SecretMatch = {
  kind: string;
  value: string;
  source: string;
};

export declare function validateSecretAllowlist(
  entries: unknown,
  options?: { now?: string },
): SecretAllowlistEntry[];

export declare function scanText(
  text: string,
  options: {
    source: string;
    allowlist?: SecretAllowlistEntry[];
    now?: string;
  },
): SecretMatch[];

export declare function scanPublicEvidenceDirectory(options: {
  directory: string;
  trackedFiles?: string[];
  allowlist?: SecretAllowlistEntry[];
  commitSha: string;
  now?: string;
}): Promise<{
  commitSha: string;
  scannedFiles: 2;
  matches: 0;
  validatorVersion: 'secret-scanner-v1';
}>;
