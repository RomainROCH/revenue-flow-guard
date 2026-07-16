import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function diag(message) {
  process.stderr.write(`PUBLICATION_INPUTS:${message}\n`);
}

function exitFail(message) {
  diag(message);
  process.exit(1);
}

function parseRoot(argv) {
  if (argv.length === 0) {
    return resolve(SCRIPT_DIR, '..');
  }
  if (argv.length !== 2 || argv[0] !== '--root') {
    diag('usage: validate-publication-inputs.mjs [--root <absolute path>]');
    process.exit(1);
  }
  if (!isAbsolute(argv[1])) {
    exitFail('--root must be an absolute path');
  }
  return resolve(argv[1]);
}

async function loadSchema() {
  const schemaPath = resolve(SCRIPT_DIR, '..', 'publication-inputs.schema.json');
  try {
    return JSON.parse(await readFile(schemaPath, 'utf8'));
  } catch {
    exitFail('schema file is missing or invalid');
  }
}

async function main() {
  const root = parseRoot(process.argv.slice(2));
  const schema = await loadSchema();
  const properties = schema.properties;
  const requiredKeys = schema.required;
  const forbidExtra = schema.additionalProperties === false;

  let raw;
  try {
    raw = await readFile(resolve(root, '.publication-inputs.json'), 'utf8');
  } catch {
    exitFail('approval record is required');
  }

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    exitFail('invalid JSON in .publication-inputs.json');
  }

  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    exitFail('approval record must be a JSON object');
  }

  if (forbidExtra) {
    const extraKeys = Object.keys(record).filter((k) => !(k in properties));
    if (extraKeys.length > 0) {
      exitFail(`unexpected keys: ${extraKeys.join(', ')}`);
    }
  }

  for (const key of requiredKeys) {
    if (!(key in record)) {
      exitFail(`missing required key: ${key}`);
    }
  }

  let contactUrlParsed = null;

  for (const [key, value] of Object.entries(record)) {
    const propSchema = properties[key];
    if (!propSchema) continue;

    if ('const' in propSchema && value !== propSchema.const) {
      exitFail(`${key} must be ${JSON.stringify(propSchema.const)}`);
    }

    if (propSchema.type === 'string' && typeof value !== 'string') {
      exitFail(`${key} must be a string`);
    }

    if (typeof value !== 'string') continue;

    if (typeof propSchema.minLength === 'number' && value.length < propSchema.minLength) {
      exitFail(`${key} must be at least ${propSchema.minLength} character(s)`);
    }

    if (typeof propSchema.maxLength === 'number' && value.length > propSchema.maxLength) {
      exitFail(`${key} must be at most ${propSchema.maxLength} character(s)`);
    }

    if (typeof propSchema.pattern === 'string') {
      if (!new RegExp(propSchema.pattern).test(value)) {
        exitFail(`${key} does not match required pattern`);
      }
    }

    if (propSchema.format === 'date-time') {
      const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
      if (!match) {
        exitFail(`${key} must be a valid RFC 3339 timestamp`);
      }
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10);
      const day = parseInt(match[3], 10);
      const hour = parseInt(match[4], 10);
      const minute = parseInt(match[5], 10);
      const second = parseInt(match[6], 10);
      const timezone = match[7];

      if (month < 1 || month > 12) {
        exitFail(`${key} month must be between 1 and 12`);
      }
      const maxDay = month === 2
        ? ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28)
        : ([4, 6, 9, 11].includes(month) ? 30 : 31);
      if (day < 1 || day > maxDay) {
        exitFail(`${key} day must be valid for the given month`);
      }
      if (hour < 0 || hour > 23) {
        exitFail(`${key} hour must be between 0 and 23`);
      }
      if (minute < 0 || minute > 59) {
        exitFail(`${key} minute must be between 0 and 59`);
      }
      if (second < 0 || second > 59) {
        exitFail(`${key} second must be between 0 and 59`);
      }
      if (timezone !== 'Z') {
        const tzHour = parseInt(timezone.slice(1, 3), 10);
        const tzMinute = parseInt(timezone.slice(4, 6), 10);
        if (tzHour > 23) {
          exitFail(`${key} timezone hour offset must be between 0 and 23`);
        }
        if (tzMinute > 59) {
          exitFail(`${key} timezone minute offset must be between 0 and 59`);
        }
      }
      if (Number.isNaN(Date.parse(value))) {
        exitFail(`${key} must be a parseable date`);
      }
    }

    if (propSchema.format === 'uri') {
      let url;
      try {
        url = new URL(value);
      } catch {
        exitFail(`${key} must be a valid URL`);
      }
      if (url.protocol !== 'https:') {
        exitFail(`${key} must use HTTPS`);
      }
      if (url.username || url.password) {
        exitFail(`${key} must not contain credentials`);
      }
      contactUrlParsed = url;
    }
  }

  process.stdout.write(`Repository: ${record.repository}\n`);
  process.stdout.write(`Contact host: ${contactUrlParsed.hostname}\n`);
  process.stdout.write(`Hosting provider: ${record.hostingProvider}\n`);
  process.stdout.write(`Site slug: ${record.siteSlug}\n`);
  process.stdout.write(`Access mode: ${record.accessMode}\n`);
}

await main();
