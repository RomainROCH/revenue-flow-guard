import { spawn } from 'node:child_process';

const DEFAULT_STDOUT_LIMIT = 1_048_576;
const KILL_GRACE_MS = 250;

function boundedStdout(stream, limit) {
  const chunks = [];
  let bytes = 0;
  let truncated = false;

  stream?.on('data', (chunk) => {
    if (bytes >= limit) {
      truncated = true;
      return;
    }

    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = limit - bytes;
    const accepted = buffer.subarray(0, remaining);
    chunks.push(accepted);
    bytes += accepted.length;
    truncated ||= accepted.length < buffer.length;
  });

  return {
    read: () => Buffer.concat(chunks).toString('utf8'),
    isTruncated: () => truncated,
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}

async function runTaskkill(pid) {
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      killer.kill();
      finish();
    }, 750);
    timer.unref?.();
    killer.once('error', finish);
    killer.once('exit', finish);
  });
}

async function killTree(child, exited) {
  if (exited() || child.pid === undefined) return;

  if (process.platform === 'win32') {
    await runTaskkill(child.pid);
    if (!exited()) child.kill('SIGKILL');
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }

  await Promise.race([wait(KILL_GRACE_MS), child.exitCode === null ? new Promise((resolve) => child.once('exit', resolve)) : Promise.resolve()]);
  if (exited()) return;

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

export function startManagedProcess({
  command,
  args = [],
  cwd,
  env,
  maxStdoutBytes = DEFAULT_STDOUT_LIMIT,
}) {
  if (typeof command !== 'string' || command.length === 0) {
    throw new TypeError('PROCESS_COMMAND_REQUIRED');
  }
  if (!Array.isArray(args) || !args.every((argument) => typeof argument === 'string')) {
    throw new TypeError('PROCESS_ARGS_INVALID');
  }
  if (!Number.isSafeInteger(maxStdoutBytes) || maxStdoutBytes < 1) {
    throw new TypeError('PROCESS_STDOUT_LIMIT_INVALID');
  }

  let child;
  try {
    child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== 'win32',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch {
    return {
      kind: 'spawn_error',
      stdout: '',
      stdoutTruncated: false,
      stderr: '',
      stderrTruncated: false,
    };
  }

  const output = boundedStdout(child.stdout, maxStdoutBytes);
  const stderrOutput = boundedStdout(child.stderr, maxStdoutBytes);
  let terminalResult;
  const exitPromise = new Promise((resolve) => {
    child.once('error', () => {
      terminalResult = {
        kind: 'spawn_error',
        stdout: output.read(),
        stdoutTruncated: output.isTruncated(),
        stderr: stderrOutput.read(),
        stderrTruncated: stderrOutput.isTruncated(),
      };
      resolve(terminalResult);
    });
    child.once('close', (exitCode, signal) => {
      if (terminalResult) return;
      terminalResult = {
        kind: 'exit',
        exitCode,
        signal,
        stdout: output.read(),
        stdoutTruncated: output.isTruncated(),
        stderr: stderrOutput.read(),
        stderrTruncated: stderrOutput.isTruncated(),
      };
      resolve(terminalResult);
    });
  });

  return {
    kind: 'managed',
    get pid() {
      return child.pid ?? null;
    },
    get exited() {
      return terminalResult !== undefined;
    },
    readStdout: output.read,
    readStdoutTruncated: () => output.isTruncated(),
    readStderr: stderrOutput.read,
    readStderrTruncated: () => stderrOutput.isTruncated(),
    waitForExit: () => exitPromise,
    async stop() {
      await killTree(child, () => terminalResult !== undefined);
      return Promise.race([
        exitPromise,
        wait(1_000).then(() => ({
          kind: 'exit',
          exitCode: child.exitCode,
          signal: child.signalCode,
          stdout: output.read(),
          stdoutTruncated: output.isTruncated(),
          stderr: stderrOutput.read(),
          stderrTruncated: stderrOutput.isTruncated(),
        })),
      ]);
    },
  };
}

export async function runProcess(options) {
  const { timeoutMs } = options;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError('PROCESS_TIMEOUT_INVALID');
  }

  const managed = startManagedProcess(options);
  if (managed.kind === 'spawn_error') return managed;

  let timer;
  try {
    const outcome = await Promise.race([
      managed.waitForExit(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
      }),
    ]);

    if (outcome.kind !== 'timeout') return outcome;
    await managed.stop();
    return {
      kind: 'timeout',
      stdout: managed.readStdout(),
      stderr: managed.readStderr(),
      stdoutTruncated: managed.readStdoutTruncated(),
      stderrTruncated: managed.readStderrTruncated(),
    };
  } finally {
    if (timer) clearTimeout(timer);
    if (!managed.exited) await managed.stop();
  }
}
