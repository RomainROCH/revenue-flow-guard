import { spawn } from 'node:child_process';

spawn(process.execPath, [
  '-e',
  "setTimeout(() => process.stdout.write('DESCENDANT_PIPE_CLOSED\\n'), 150); setTimeout(() => process.exit(0), 300);",
], {
  detached: true,
  stdio: 'inherit',
  windowsHide: true,
}).unref();

process.exit(0);
