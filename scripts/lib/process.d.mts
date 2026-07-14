export type ProcessExit = {
  kind: 'exit';
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stdoutTruncated: boolean;
};

export type ProcessSpawnError = {
  kind: 'spawn_error';
  stdout: string;
  stdoutTruncated: boolean;
};

export type ProcessTimeout = {
  kind: 'timeout';
  stdout: string;
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
  waitForExit(): Promise<ProcessExit | ProcessSpawnError>;
  stop(): Promise<ProcessExit | ProcessSpawnError>;
};

export declare function startManagedProcess(
  options: Omit<ProcessOptions, 'timeoutMs'>,
): ManagedProcess | ProcessSpawnError;

export declare function runProcess(
  options: ProcessOptions & { timeoutMs: number },
): Promise<ProcessExit | ProcessSpawnError | ProcessTimeout>;
