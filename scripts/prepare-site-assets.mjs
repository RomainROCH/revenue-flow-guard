import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, '..');
const REMOVE_OPTIONS = { force: true, maxRetries: 3, retryDelay: 50 };
const NOFOLLOW = process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);

class PrepareError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function exitFail(code) {
  process.stderr.write(`PREPARE_SITE_ASSETS: ${code}\n`);
  process.exit(1);
}

function sameIdentity(left, right) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs;
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

function requireRealDirectory(path, errorCode) {
  const stat = lstatOrNull(path);
  if (stat === null || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new PrepareError(errorCode);
  }
  return stat;
}

function validateDestinationAncestors(root) {
  const sitesAppPath = join(root, 'sites-app');
  const publicPath = join(sitesAppPath, 'public');
  const sitesAppStat = lstatOrNull(sitesAppPath);
  if (sitesAppStat === null) {
    return;
  }
  if (sitesAppStat.isSymbolicLink()) {
    throw new PrepareError('ERR_DESTINATION_PATH');
  }
  if (!sitesAppStat.isDirectory()) {
    throw new PrepareError('ERR_DESTINATION_WRITE');
  }

  const publicStat = lstatOrNull(publicPath);
  if (publicStat === null) {
    return;
  }
  if (publicStat.isSymbolicLink()) {
    throw new PrepareError('ERR_DESTINATION_PATH');
  }
  if (!publicStat.isDirectory()) {
    throw new PrepareError('ERR_DESTINATION_WRITE');
  }
}

function ensureRealDirectory(path, errorCode) {
  const existing = lstatOrNull(path);
  if (existing !== null) {
    if (existing.isSymbolicLink()) {
      throw new PrepareError('ERR_DESTINATION_PATH');
    }
    if (!existing.isDirectory()) {
      throw new PrepareError(errorCode);
    }
    return;
  }

  try {
    mkdirSync(path);
  } catch {
    throw new PrepareError(errorCode);
  }
  requireRealDirectory(path, errorCode);
}

function readCanonicalCss(root) {
  const appPath = join(root, 'app');
  const sourcePath = join(appPath, 'style.css');
  const appBefore = requireRealDirectory(appPath, 'ERR_SOURCE_NOT_FILE');
  const sourceBefore = lstatOrNull(sourcePath);
  if (
    sourceBefore === null ||
    sourceBefore.isSymbolicLink() ||
    !sourceBefore.isFile()
  ) {
    throw new PrepareError('ERR_SOURCE_NOT_FILE');
  }

  let descriptor;
  try {
    descriptor = openSync(sourcePath, constants.O_RDONLY | NOFOLLOW);
  } catch {
    throw new PrepareError('ERR_SOURCE_NOT_FILE');
  }

  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !sameIdentity(sourceBefore, opened)) {
      throw new PrepareError('ERR_SOURCE_NOT_FILE');
    }
    const bytes = readFileSync(descriptor);
    const afterRead = fstatSync(descriptor);
    const sourceAfter = lstatOrNull(sourcePath);
    const appAfter = lstatOrNull(appPath);
    if (
      sourceAfter === null ||
      sourceAfter.isSymbolicLink() ||
      appAfter === null ||
      appAfter.isSymbolicLink() ||
      !sameIdentity(opened, afterRead) ||
      !sameIdentity(afterRead, sourceAfter) ||
      !sameIdentity(appBefore, appAfter) ||
      bytes.byteLength !== afterRead.size
    ) {
      throw new PrepareError('ERR_SOURCE_NOT_FILE');
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function removeFile(path) {
  try {
    rmSync(path, REMOVE_OPTIONS);
    return true;
  } catch {
    return false;
  }
}

function parseRoot(args) {
  if (args.length === 0) {
    return DEFAULT_ROOT;
  }
  if (args.length !== 2 || args[0] !== '--root') {
    exitFail('ERR_USAGE');
  }
  if (!isAbsolute(args[1])) {
    exitFail('ERR_RELATIVE_ROOT');
  }
  return resolve(args[1]);
}

function main() {
  const root = parseRoot(process.argv.slice(2));
  const rootStat = lstatOrNull(root);
  if (rootStat === null || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    exitFail('ERR_ROOT_NOT_DIR');
  }

  const sitesAppPath = join(root, 'sites-app');
  const publicPath = join(sitesAppPath, 'public');
  const destinationPath = join(publicPath, 'style.css');
  let temporaryPath = null;
  let destinationTrusted = false;

  try {
    validateDestinationAncestors(root);
    destinationTrusted = true;
    const sourceBytes = readCanonicalCss(root);

    ensureRealDirectory(sitesAppPath, 'ERR_DESTINATION_WRITE');
    ensureRealDirectory(publicPath, 'ERR_DESTINATION_WRITE');
    validateDestinationAncestors(root);

    temporaryPath = join(
      publicPath,
      `.style.css.tmp.${process.pid}.${randomBytes(8).toString('hex')}`,
    );
    writeFileSync(temporaryPath, sourceBytes, { flag: 'wx' });
    validateDestinationAncestors(root);
    renameSync(temporaryPath, destinationPath);
    temporaryPath = null;
  } catch (error) {
    const temporaryClean = temporaryPath === null || removeFile(temporaryPath);
    const destinationClean = !destinationTrusted || removeFile(destinationPath);
    if (!temporaryClean || !destinationClean) {
      exitFail('ERR_DESTINATION_CLEANUP');
    }
    exitFail(error instanceof PrepareError ? error.code : 'ERR_DESTINATION_WRITE');
  }

  process.stdout.write('PREPARE_SITE_ASSETS:ok\n');
}

main();
