import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PREFIX = 'FINALIZE_SITE_BUILD:';
const PROJECT_ID_RE = /^appgprj_[0-9a-f]{32}$/;
const RM_OPTS = { recursive: true, force: true, maxRetries: 3, retryDelay: 50 };
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const NOFOLLOW = process.platform === 'win32' ? 0 : (constants.O_NOFOLLOW ?? 0);
const MODULE_PACKAGE_BYTES = Buffer.from('{"type":"module"}\n', 'utf8');

class FinalizeError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  console.error(PREFIX, code);
  process.exit(1);
}

function sameIdentity(left, right) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs;
}

async function statFixedAncestor(path, invalidCode) {
  let stat;
  try {
    stat = await lstat(path);
  } catch {
    throw new FinalizeError(invalidCode);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new FinalizeError(invalidCode);
  }
  return stat;
}

async function readStableRegularFile(path, invalidCode, changedCode) {
  let before;
  try {
    before = await lstat(path);
  } catch {
    throw new FinalizeError(invalidCode);
  }

  if (before.isSymbolicLink() || !before.isFile()) {
    throw new FinalizeError(invalidCode);
  }

  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | NOFOLLOW);
  } catch {
    throw new FinalizeError(invalidCode);
  }

  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(before, opened)) {
      throw new FinalizeError(changedCode);
    }

    const buffer = await handle.readFile();
    const afterRead = await handle.stat();
    let afterPath;
    try {
      afterPath = await lstat(path);
    } catch {
      throw new FinalizeError(changedCode);
    }

    if (
      afterPath.isSymbolicLink() ||
      !sameIdentity(opened, afterRead) ||
      !sameIdentity(afterRead, afterPath) ||
      buffer.byteLength !== afterRead.size
    ) {
      throw new FinalizeError(changedCode);
    }

    return buffer;
  } finally {
    await handle.close();
  }
}

async function snapshotSource(sourceDir) {
  const entries = [];

  async function walk(absoluteDirectory, relativeDirectory) {
    let before;
    try {
      before = await lstat(absoluteDirectory);
    } catch {
      throw new FinalizeError('ERR_SOURCE_NOT_DIR');
    }
    if (before.isSymbolicLink()) {
      throw new FinalizeError('ERR_SOURCE_SYMLINK');
    }
    if (!before.isDirectory()) {
      throw new FinalizeError('ERR_SOURCE_NOT_DIR');
    }

    let dirents;
    try {
      dirents = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch {
      throw new FinalizeError('ERR_SOURCE_UNREADABLE');
    }
    dirents.sort((left, right) => left.name.localeCompare(right.name));

    for (const dirent of dirents) {
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${dirent.name}`
        : dirent.name;
      const absolutePath = join(absoluteDirectory, dirent.name);

      if (dirent.name === '_worker.js') {
        throw new FinalizeError('ERR_SOURCE_WORKER_JS');
      }

      let stat;
      try {
        stat = await lstat(absolutePath);
      } catch {
        throw new FinalizeError('ERR_SOURCE_CHANGED');
      }
      if (stat.isSymbolicLink()) {
        throw new FinalizeError('ERR_SOURCE_SYMLINK');
      }

      if (stat.isDirectory()) {
        entries.push({ relativePath, type: 'dir' });
        await walk(absolutePath, relativePath);
      } else if (stat.isFile()) {
        const buffer = await readStableRegularFile(
          absolutePath,
          'ERR_SOURCE_CHANGED',
          'ERR_SOURCE_CHANGED',
        );
        entries.push({ relativePath, type: 'file', buffer });
      } else {
        throw new FinalizeError('ERR_SOURCE_UNSUPPORTED_ENTRY');
      }
    }

    let after;
    try {
      after = await lstat(absoluteDirectory);
    } catch {
      throw new FinalizeError('ERR_SOURCE_CHANGED');
    }
    if (after.isSymbolicLink() || !sameIdentity(before, after)) {
      throw new FinalizeError('ERR_SOURCE_CHANGED');
    }
  }

  await walk(sourceDir, '');
  return entries;
}

async function removePath(path) {
  try {
    await rm(path, RM_OPTS);
    return true;
  } catch {
    return false;
  }
}

async function finalizeSiteBuild(root) {
  let rootVerified = false;
  let stagingDir = null;
  const outputDist = join(root, 'dist');

  try {
    let rootStat;
    try {
      rootStat = await lstat(root);
    } catch {
      throw new FinalizeError('ERR_ROOT_NOT_DIR');
    }
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new FinalizeError('ERR_ROOT_NOT_DIR');
    }
    rootVerified = true;

    const openaiDir = join(root, '.openai');
    const openaiBefore = await statFixedAncestor(openaiDir, 'ERR_HOSTING_ANCESTOR_INVALID');

    const hostingBuffer = await readStableRegularFile(
      join(openaiDir, 'hosting.json'),
      'ERR_HOSTING_NOT_FILE',
      'ERR_HOSTING_CHANGED',
    );

    const openaiAfter = await statFixedAncestor(openaiDir, 'ERR_HOSTING_CHANGED');
    if (!sameIdentity(openaiBefore, openaiAfter)) {
      throw new FinalizeError('ERR_HOSTING_CHANGED');
    }

    let hostingData;
    try {
      hostingData = JSON.parse(hostingBuffer.toString('utf8'));
    } catch {
      throw new FinalizeError('ERR_HOSTING_INVALID_JSON');
    }
    if (
      typeof hostingData !== 'object' ||
      hostingData === null ||
      Array.isArray(hostingData)
    ) {
      throw new FinalizeError('ERR_HOSTING_NOT_OBJECT');
    }
    const keys = Object.keys(hostingData);
    if (keys.length !== 1 || keys[0] !== 'project_id') {
      throw new FinalizeError('ERR_HOSTING_EXTRA_KEYS');
    }
    if (
      typeof hostingData.project_id !== 'string' ||
      !PROJECT_ID_RE.test(hostingData.project_id)
    ) {
      throw new FinalizeError('ERR_HOSTING_INVALID_ID');
    }

    const sitesAppDir = join(root, 'sites-app');
    const sitesAppBefore = await statFixedAncestor(sitesAppDir, 'ERR_SOURCE_ANCESTOR_INVALID');

    const entries = await snapshotSource(join(sitesAppDir, 'dist'));

    const sitesAppAfter = await statFixedAncestor(sitesAppDir, 'ERR_SOURCE_CHANGED');
    if (!sameIdentity(sitesAppBefore, sitesAppAfter)) {
      throw new FinalizeError('ERR_SOURCE_CHANGED');
    }
    if (!entries.some((entry) => entry.type === 'dir' && entry.relativePath === 'client')) {
      throw new FinalizeError('ERR_MISSING_CLIENT_DIR');
    }
    if (!entries.some((entry) => entry.type === 'file' && entry.relativePath === 'server/index.js')) {
      throw new FinalizeError('ERR_MISSING_SERVER_INDEX');
    }

    stagingDir = await mkdtemp(join(root, '.rfg-finalize-'));
    for (const entry of entries) {
      const targetPath = join(stagingDir, entry.relativePath);
      if (entry.type === 'dir') {
        await mkdir(targetPath, { recursive: true });
      } else {
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, entry.buffer);
      }
    }
    const hostingOutputDir = join(stagingDir, '.openai');
    await mkdir(hostingOutputDir, { recursive: true });
    await writeFile(join(hostingOutputDir, 'hosting.json'), hostingBuffer);
    await writeFile(join(stagingDir, 'package.json'), MODULE_PACKAGE_BYTES);

    if (!(await removePath(outputDist))) {
      throw new FinalizeError('ERR_OUTPUT_CLEANUP');
    }
    try {
      await rename(stagingDir, outputDist);
      stagingDir = null;
    } catch {
      throw new FinalizeError('ERR_OUTPUT_PUBLISH');
    }

    console.log('FINALIZE_SITE_BUILD:ok');
  } catch (error) {
    const stagingClean = stagingDir === null || await removePath(stagingDir);
    const outputClean = !rootVerified || await removePath(outputDist);
    if (!stagingClean || !outputClean) {
      fail('ERR_OUTPUT_CLEANUP');
    }
    fail(error instanceof FinalizeError ? error.code : 'ERR_UNEXPECTED');
  }
}

const args = process.argv.slice(2);
let root;

if (args.length === 0) {
  root = REPO_ROOT;
} else if (args.length === 2 && args[0] === '--root') {
  if (!isAbsolute(args[1])) {
    fail('ERR_RELATIVE_ROOT');
  }
  root = resolve(args[1]);
} else {
  fail('ERR_USAGE');
}

await finalizeSiteBuild(root);
