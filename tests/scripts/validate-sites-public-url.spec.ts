import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseSitesPublicUrl } from '../../scripts/lib/sites-public-url.mjs';

const scriptPath = resolve(__dirname, '../../scripts/validate-sites-public-url.mjs');

function runValidator(urlValue: string | undefined) {
  return spawnSync(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      SITES_PUBLIC_URL: urlValue,
    },
    encoding: 'utf8',
  });
}

test.describe('validate-sites-public-url.mjs', () => {
  test('accepts a canonical HTTPS origin with trailing slash', () => {
    const result = runValidator('https://sites.example.com/');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('https://sites.example.com');
  });

  test('accepts a canonical HTTPS origin without trailing slash', () => {
    const result = runValidator('https://sites.example.com');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('https://sites.example.com');
  });

  test('rejects a non-HTTPS URL', () => {
    const result = runValidator('http://sites.example.com');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SITES_PUBLIC_URL');
  });

  test('rejects a URL with credentials', () => {
    const result = runValidator('https://user:pass@sites.example.com');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('credentials');
  });

  test('rejects a URL with a query string', () => {
    const result = runValidator('https://sites.example.com/?foo=bar');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('query');
  });

  test('rejects a URL with a fragment', () => {
    const result = runValidator('https://sites.example.com/#section');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('fragment');
  });

  test('rejects a URL with a non-root path', () => {
    const result = runValidator('https://sites.example.com/page');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('path');
  });

  test('rejects a URL with an explicit port', () => {
    const result = runValidator('https://sites.example.com:8443');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('port');
  });

  test('rejects an explicit :443 port', () => {
    const result = runValidator('https://sites.example.com:443');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('port');
  });

  test('rejects a missing SITES_PUBLIC_URL environment variable', () => {
    const result = runValidator(undefined);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SITES_PUBLIC_URL');
  });

  test('rejects a URL with surrounding whitespace', () => {
    const result = runValidator('  https://sites.example.com  ');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('whitespace');
  });

  test('rejects an empty SITES_PUBLIC_URL', () => {
    const result = runValidator('');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('SITES_PUBLIC_URL');
  });

  test('shared parser rejects the same values as the CLI', () => {
    expect(parseSitesPublicUrl(undefined).valid).toBe(false);
    expect(parseSitesPublicUrl('').valid).toBe(false);
    expect(parseSitesPublicUrl('  https://sites.example.com  ').valid).toBe(false);
    expect(parseSitesPublicUrl('http://sites.example.com').valid).toBe(false);
    expect(parseSitesPublicUrl('https://user:pass@sites.example.com').valid).toBe(false);
    expect(parseSitesPublicUrl('https://sites.example.com/?foo=bar').valid).toBe(false);
    expect(parseSitesPublicUrl('https://sites.example.com/#section').valid).toBe(false);
    expect(parseSitesPublicUrl('https://sites.example.com/page').valid).toBe(false);
    expect(parseSitesPublicUrl('https://sites.example.com:8443').valid).toBe(false);
    expect(parseSitesPublicUrl('https://sites.example.com:443').valid).toBe(false);
    expect(parseSitesPublicUrl('https://sites.example.com').valid).toBe(true);
    expect(parseSitesPublicUrl('https://sites.example.com/').valid).toBe(true);
  });
});
