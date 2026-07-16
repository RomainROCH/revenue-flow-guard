import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCUMENTS = [
  'README.md',
  'docs/test-plan.md',
  'docs/qa-report.md',
  'docs/handoff.md',
  'docs/references.md',
];

function parseRoot(arguments_) {
  if (arguments_.length === 0) {
    return resolve(dirname(fileURLToPath(import.meta.url)), '..');
  }

  if (arguments_.length !== 2 || arguments_[0] !== '--root') {
    throw new Error('usage: validate-docs.mjs [--root <absolute path>]');
  }

  if (!isAbsolute(arguments_[1])) {
    throw new Error('--root must be an absolute path');
  }

  return resolve(arguments_[1]);
}

function githubSlug(value) {
  return value
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function markdownAnchors(markdown) {
  const anchors = new Set();
  const duplicateCounts = new Map();

  for (const match of markdown.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gmu)) {
    const base = githubSlug(match[1]);
    if (!base) continue;

    const count = duplicateCounts.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    duplicateCounts.set(base, count + 1);
  }

  for (const match of markdown.matchAll(/<a\s+[^>]*\b(?:id|name)=["']([^"']+)["'][^>]*>/giu)) {
    anchors.add(match[1]);
  }

  return anchors;
}

function localTarget(rawTarget) {
  let target = rawTarget.trim();
  if (target.startsWith('<')) {
    const close = target.indexOf('>');
    if (close !== -1) target = target.slice(1, close);
  } else {
    target = target.split(/\s+["']/u, 1)[0];
  }

  if (/^(?:https?:|mailto:)/iu.test(target)) return null;

  const hashIndex = target.indexOf('#');
  const pathPart = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? '' : target.slice(hashIndex + 1);
  const queryIndex = pathPart.indexOf('?');

  try {
    return {
      path: decodeURIComponent(queryIndex === -1 ? pathPart : pathPart.slice(0, queryIndex)),
      fragment: decodeURIComponent(fragment),
    };
  } catch {
    return { invalid: true, path: pathPart, fragment };
  }
}

function isInsideRoot(root, candidate) {
  const offset = relative(root, candidate);
  return offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset));
}

function markdownLinkRanges(markdown) {
  return [...markdown.matchAll(/!?\[[^\]]*\]\([^\n)]*\)/gu)].map((match) => [
    match.index,
    match.index + match[0].length,
  ]);
}

function isInsideLink(index, ranges) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function bibliographyEntryHasDoi(content, citationIndex) {
  const previousEntry = content.lastIndexOf('\n- ', citationIndex);
  const entryStart = previousEntry === -1 ? 0 : previousEntry + 1;
  const nextEntry = content.indexOf('\n- ', citationIndex);
  const entryEnd = nextEntry === -1 ? content.length : nextEntry;
  const entry = content.slice(entryStart, entryEnd);

  return /\[[^\]]+\]\(https:\/\/doi\.org\/[^)]+\)/iu.test(entry);
}

function inspectClaims(relativePath, content) {
  const errors = [];

  for (const placeholder of ['REPO_OWNER', 'TODO', 'TBD']) {
    if (new RegExp(`\\b${placeholder}\\b`, 'u').test(content)) {
      errors.push(`${relativePath}: unresolved placeholder ${placeholder}`);
    }
  }

  if (
    /WEFix[^\n]{0,120}\b73\s*%/iu.test(content) ||
    /\b73\s*%[^\n]{0,120}WEFix/iu.test(content)
  ) {
    errors.push(`${relativePath}: unsupported WEFix 73% claim`);
  }

  const efficacyClaim =
    /(?:\b(?:boosts?|catches?|cuts?|decreases?|detects?|eliminates?|improves?|increases?|prevents?|reduces?|saves?)\b[^\n%]{0,100}\b\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\s*%[^\n]{0,100}\b(?:better|faster|fewer|improvement|less|more|reduction)\b)/iu;
  if (efficacyClaim.test(content)) {
    errors.push(`${relativePath}: unsupported numeric marketing efficacy claim`);
  }

  const numericMarketingClaim = /\b\d+x\s+(?:faster|more|better)\b/iu.test(content) ||
    /\b(?:saves?|reduces?|cuts?)\s+\d+\s+(?:hours?|minutes?|days?|weeks?|months?)\b/iu.test(content);
  if (numericMarketingClaim) {
    errors.push(`${relativePath}: unsupported numeric marketing claim`);
  }

  const linkRanges = markdownLinkRanges(content);
  const scholarlyCitations = [
    /\b[A-Z][\p{L}'-]+(?:\s+(?:et\s+al\.|and\s+[A-Z][\p{L}'-]+))?\s*\((?:19|20)\d{2}\)/gu,
    /\([A-Z][\p{L}'-]+(?:\s+(?:et\s+al\.|and\s+[A-Z][\p{L}'-]+))?,\s*(?:19|20)\d{2}\)/gu,
    /\b[A-Z][\p{L}'-]+(?:\s+(?:et\s+al\.|and\s+[A-Z][\p{L}'-]+))?,\s*(?:19|20)\d{2}\b/gu,
  ];
  for (const pattern of scholarlyCitations) {
    for (const match of content.matchAll(pattern)) {
      const isCanonicalBibliographyEntry =
        relativePath === 'docs/references.md' &&
        bibliographyEntryHasDoi(content, match.index);
      if (!isInsideLink(match.index, linkRanges) && !isCanonicalBibliographyEntry) {
        errors.push(`${relativePath}: unlinked scholarly citation ${match[0]}`);
      }
    }
  }

  const staleTotals = [
    /\b(?:all\s+)?\d+\s+tests?\s+(?:pass|passed|passing)\b/iu,
    /\b\d+\s*\/\s*\d+\s+(?:tests?\s+)?(?:pass|passed|passing)\b/iu,
    /\b(?:total\s+tests?|tests?\s+(?:passed|passing))\s*\|\s*\d+\b/iu,
    /\b(?:passed|passing)\s*[:|]\s*\d+\s*(?:tests?)?\b/iu,
    /^\d+\s+(?:passed|passing)\s*$/ium,
  ];
  if (staleTotals.some((pattern) => pattern.test(content))) {
    errors.push(`${relativePath}: stale hand-written test total`);
  }

  return errors;
}

async function inspectLinks(root, relativePath, content, documentCache) {
  const errors = [];

  for (const match of content.matchAll(/!?\[[^\]]*\]\(([^\n)]*)\)/gu)) {
    const target = localTarget(match[1]);
    if (target === null) continue;
    if (target.invalid) {
      errors.push(`${relativePath}: invalid local Markdown link ${match[1]}`);
      continue;
    }

    const sourceDirectory = dirname(resolve(root, relativePath));
    const rootRelative = /^[/\\]/u.test(target.path);
    const candidate = target.path
      ? resolve(rootRelative ? root : sourceDirectory, target.path.replace(/^[/\\]+/u, ''))
      : resolve(root, relativePath);

    if (!isInsideRoot(root, candidate)) {
      errors.push(`${relativePath}: local Markdown link escapes the repository: ${match[1]}`);
      continue;
    }

    let targetStat;
    try {
      targetStat = await stat(candidate);
    } catch {
      errors.push(`${relativePath}: broken local Markdown link ${match[1]}`);
      continue;
    }

    if (!targetStat.isFile()) {
      errors.push(`${relativePath}: local Markdown link is not a file: ${match[1]}`);
      continue;
    }

    if (target.fragment) {
      let targetContent = documentCache.get(candidate);
      if (targetContent === undefined) {
        targetContent = await readFile(candidate, 'utf8');
        documentCache.set(candidate, targetContent);
      }

      if (!markdownAnchors(targetContent).has(target.fragment.toLowerCase())) {
        errors.push(`${relativePath}: missing Markdown anchor #${target.fragment} in ${match[1]}`);
      }
    }
  }

  return errors;
}

function inspectNpmCommands(relativePath, content, scripts) {
  const errors = [];
  const seen = new Set();

  for (const match of content.matchAll(/\bnpm\s+run\s+([A-Za-z0-9:_-]+)/gu)) {
    const command = match[1];
    if (!seen.has(command) && !Object.hasOwn(scripts, command)) {
      errors.push(`${relativePath}: npm script does not exist: ${command}`);
      seen.add(command);
    }
  }

  return errors;
}

async function validate(root) {
  const errors = [];
  const documents = new Map();

  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  } catch (error) {
    errors.push(`package.json: ${error instanceof Error ? error.message : String(error)}`);
    packageJson = {};
  }
  const scripts = packageJson.scripts && typeof packageJson.scripts === 'object' ? packageJson.scripts : {};

  for (const relativePath of DOCUMENTS) {
    const absolutePath = resolve(root, relativePath);
    try {
      documents.set(absolutePath, await readFile(absolutePath, 'utf8'));
    } catch {
      errors.push(`${relativePath}: required document is missing or unreadable`);
    }
  }

  for (const relativePath of DOCUMENTS) {
    const absolutePath = resolve(root, relativePath);
    const content = documents.get(absolutePath);
    if (content === undefined) continue;

    errors.push(...inspectClaims(relativePath, content));
    errors.push(...inspectNpmCommands(relativePath, content, scripts));
    errors.push(...(await inspectLinks(root, relativePath, content, documents)));
  }

  return errors;
}

try {
  const root = parseRoot(process.argv.slice(2));
  const errors = await validate(root);

  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('Documentation validated.\n');
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
