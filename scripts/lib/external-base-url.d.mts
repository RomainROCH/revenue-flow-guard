export type ExternalBaseUrlResult =
  | {
      valid: true;
      code: 'VALID_EXTERNAL_BASE_URL';
      normalizedUrl: string;
    }
  | {
      valid: false;
      code: 'INVALID_EXTERNAL_BASE_URL';
    };

export declare function validateExternalBaseUrl(raw: unknown): ExternalBaseUrlResult;
