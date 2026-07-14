export { validateExternalBaseUrl } from './lib/external-base-url.mjs';

export type ValidationResult<ValidCode extends string, InvalidCode extends string> =
  | { valid: true; code: ValidCode }
  | { valid: false; code: InvalidCode };

export type RegressionMapping = {
  id: string;
  testId: string;
  expectedSignature: string;
};

export type FaultClassification =
  | {
      detected: true;
      code: 'EXPECTED_REGRESSION_DETECTED';
      testId: string;
      signature: string;
    }
  | {
      detected: false;
      code:
        | 'EXPECTED_TEST_DID_NOT_FAIL'
        | 'UNEXPECTED_TEST_COUNT'
        | 'RETRIES_PRESENT'
        | 'UNEXPECTED_TEST_FAILED'
        | 'MULTIPLE_TESTS_FAILED'
        | 'EXPECTED_SIGNATURE_MISSING'
        | 'UNEXPECTED_REGRESSION_SIGNATURE'
        | 'MULTIPLE_REGRESSION_SIGNATURES'
        | 'MALFORMED_PLAYWRIGHT_REPORT'
        | 'PROCESS_TIMEOUT'
        | 'SPAWN_ERROR'
        | 'BROWSER_LAUNCH_ERROR'
        | 'FIXTURE_ERROR'
        | 'SERVER_EXITED';
    };

export declare function validateHealthContract(
  payload: unknown,
): ValidationResult<'VALID_HEALTH_CONTRACT', 'INVALID_HEALTH_CONTRACT'>;

export declare function validateStateContract(
  payload: unknown,
  expectedFaultId: string,
): ValidationResult<'VALID_STATE_CONTRACT', 'INVALID_STATE_CONTRACT'>;

export declare function classifyFaultReport(
  raw: string,
  mapping: RegressionMapping,
): FaultClassification;

export declare function classifyFaultRun(input: {
  mapping: RegressionMapping;
  report: string;
  execution: {
    kind:
      | 'completed'
      | 'process_timeout'
      | 'spawn_error'
      | 'browser_launch_error'
      | 'fixture_error'
      | 'server_exit';
  };
}): FaultClassification;
