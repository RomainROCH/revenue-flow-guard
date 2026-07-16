export type ProcessExit = {
  kind: 'exit';
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stdoutTruncated: boolean;
  stderr: string;
  stderrTruncated: boolean;
};

export type ProcessSpawnError = {
  kind: 'spawn_error';
  stdout: string;
  stdoutTruncated: boolean;
  stderr: string;
  stderrTruncated: boolean;
};

export type ProcessTimeout = {
  kind: 'timeout';
  stdout: string;
  stdoutTruncated: boolean;
  stderr: string;
  stderrTruncated: boolean;
};

export type ProcessOptions = {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxStdoutBytes?: number;
};

export type ManagedProcess = {
  kind: 'managed';
  readonly pid: number | null;
  readonly exited: boolean;
  readStdout(): string;
  readStdoutTruncated(): boolean;
  readStderr(): string;
  readStderrTruncated(): boolean;
  waitForExit(): Promise<ProcessExit | ProcessSpawnError>;
  stop(): Promise<ProcessExit | ProcessSpawnError>;
};

export declare function startManagedProcess(
  options: Omit<ProcessOptions, 'timeoutMs'>,
): ManagedProcess | ProcessSpawnError;

export declare function runProcess(
  options: ProcessOptions & { timeoutMs: number },
): Promise<ProcessExit | ProcessSpawnError | ProcessTimeout>;
