'use strict';

const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');

const { isFaultId } = require('../testing/faults');

const APP_ROOT = resolve(__dirname, '../../app');
const FAULT_ATTRIBUTE = 'data-rfg-fault="NONE"';

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
  '/app.js': Object.freeze({
    path: resolve(APP_ROOT, 'app.js'),
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

function createStaticAssetServer({ faultDecision, testMode = false }) {
  return {
    async serve(response, pathname) {
      const asset = STATIC_ASSETS[pathname];
      if (!asset) {
        return false;
      }

      const file = await readFile(asset.path);
      const body = testMode && asset.html
        ? Buffer.from(injectFaultId(file.toString('utf8'), faultDecision), 'utf8')
        : file;

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

module.exports = { createStaticAssetServer };
