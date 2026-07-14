'use strict';

const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');

const { isFaultId } = require('../testing/faults');

const APP_ROOT = resolve(__dirname, '../../app');
const FAULT_ATTRIBUTE = 'data-rfg-fault="NONE"';
const SOURCE_COMMIT_TOKEN = '{{SOURCE_COMMIT_SHA}}';
const PUBLIC_TOKENS = Object.freeze({
  status: '{{PUBLICATION_STATUS}}',
  contactUrl: '{{PUBLIC_CONTACT_URL}}',
  contactLabel: '{{PUBLIC_CONTACT_LABEL}}',
  offerName: '{{PUBLIC_OFFER_NAME}}',
  offerSummary: '{{PUBLIC_OFFER_SUMMARY}}',
});

const STATIC_ASSETS = Object.freeze({
  '/': Object.freeze({
    path: resolve(APP_ROOT, 'index.html'),
    contentType: 'text/html; charset=utf-8',
    html: true,
  }),
  '/index.html': Object.freeze({
    path: resolve(APP_ROOT, 'index.html'),
    contentType: 'text/html; charset=utf-8',
    html: true,
  }),
  '/case-study.html': Object.freeze({
    path: resolve(APP_ROOT, 'case-study.html'),
    contentType: 'text/html; charset=utf-8',
    html: true,
  }),
  '/app.js': Object.freeze({
    path: resolve(APP_ROOT, 'app.js'),
    contentType: 'application/javascript; charset=utf-8',
    html: false,
  }),
  '/case-study.js': Object.freeze({
    path: resolve(APP_ROOT, 'case-study.js'),
    contentType: 'application/javascript; charset=utf-8',
    html: false,
  }),
  '/style.css': Object.freeze({
    path: resolve(APP_ROOT, 'style.css'),
    contentType: 'text/css; charset=utf-8',
    html: false,
  }),
});

function injectFaultId(source, faultDecision) {
  if (!isFaultId(faultDecision?.id)) {
    throw new Error('Invalid fault decision');
  }

  const occurrences = source.split(FAULT_ATTRIBUTE).length - 1;
  if (occurrences !== 1) {
    throw new Error('Expected exactly one fault marker');
  }

  return source.replace(
    FAULT_ATTRIBUTE,
    `data-rfg-fault="${faultDecision.id}"`,
  );
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function transformPublicHtml(source, publicConfig) {
  const tokens = Object.values(PUBLIC_TOKENS);
  const presentTokens = tokens.filter((token) => source.includes(token));

  if (presentTokens.length === 0) {
    return source;
  }

  if (presentTokens.length !== tokens.length) {
    throw new Error('Expected all public configuration tokens');
  }

  const values = publicConfig?.publicationReady === true
    ? {
        status: 'ready',
        contactUrl: publicConfig.contact.url,
        contactLabel: publicConfig.contact.label,
        offerName: publicConfig.offer.name,
        offerSummary: publicConfig.offer.summary,
      }
    : {
        status: 'publication-inputs-missing',
        contactUrl: '#publication-inputs-missing',
        contactLabel: 'Publication inputs missing',
        offerName: 'Publication inputs missing',
        offerSummary: 'Publication inputs missing',
      };

  let transformed = source;
  for (const [name, token] of Object.entries(PUBLIC_TOKENS)) {
    transformed = transformed.replaceAll(token, escapeHtml(values[name]));
  }

  return transformed;
}

function transformSourceCommitHtml(source, sourceCommitSha) {
  if (!source.includes(SOURCE_COMMIT_TOKEN)) {
    return source;
  }

  const value = typeof sourceCommitSha === 'string' && /^[0-9a-f]{40}$/i.test(sourceCommitSha)
    ? sourceCommitSha
    : 'unavailable';

  return source.replaceAll(SOURCE_COMMIT_TOKEN, escapeHtml(value));
}

function createStaticAssetServer({
  faultDecision,
  testMode = false,
  publicConfig,
  sourceCommitSha,
}) {
  return {
    async serve(response, pathname) {
      const asset = STATIC_ASSETS[pathname];
      if (!asset) {
        return false;
      }

      const file = await readFile(asset.path);
      let body = file;

      if (asset.html) {
        let html = transformPublicHtml(file.toString('utf8'), publicConfig);
        html = transformSourceCommitHtml(html, sourceCommitSha);
        if (testMode) {
          html = injectFaultId(html, faultDecision);
        }
        body = Buffer.from(html, 'utf8');
      }

      response.writeHead(200, {
        'Content-Type': asset.contentType,
        'Content-Length': body.byteLength,
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(body);
      return true;
    },
  };
}

module.exports = {
  createStaticAssetServer,
  transformPublicHtml,
  transformSourceCommitHtml,
};
