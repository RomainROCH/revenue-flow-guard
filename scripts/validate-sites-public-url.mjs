import { parseSitesPublicUrl } from './lib/sites-public-url.mjs';

const MESSAGES = {
  SITES_PUBLIC_URL_MISSING_OR_EMPTY: 'SITES_PUBLIC_URL is required',
  SITES_PUBLIC_URL_SURROUNDING_WHITESPACE: 'SITES_PUBLIC_URL must not contain surrounding whitespace',
  SITES_PUBLIC_URL_INVALID: 'SITES_PUBLIC_URL must be a valid URL',
  SITES_PUBLIC_URL_NOT_HTTPS: 'SITES_PUBLIC_URL must use HTTPS',
  SITES_PUBLIC_URL_HAS_CREDENTIALS: 'SITES_PUBLIC_URL must not contain credentials',
  SITES_PUBLIC_URL_HAS_QUERY: 'SITES_PUBLIC_URL must not contain a query string',
  SITES_PUBLIC_URL_HAS_FRAGMENT: 'SITES_PUBLIC_URL must not contain a fragment',
  SITES_PUBLIC_URL_NON_ROOT_PATH: 'SITES_PUBLIC_URL must be a root URL with no path',
  SITES_PUBLIC_URL_HAS_PORT: 'SITES_PUBLIC_URL must not contain an explicit port',
};

const raw = process.env.SITES_PUBLIC_URL;
const result = parseSitesPublicUrl(raw);

if (!result.valid) {
  process.stderr.write(`SITES_PUBLIC_URL_VALIDATION:${MESSAGES[result.code] || 'Invalid URL'}\n`);
  process.exit(1);
}

process.stdout.write(result.origin + '\n');
