import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildSite({ sourceRoot, outputRoot }) {
  const resolvedSource = resolve(sourceRoot);
  const resolvedOutput = resolve(outputRoot);

  const rel = relative(resolvedSource, resolvedOutput);
  const parts = rel.split(/[\\/]/);
  if (parts.length !== 1) {
    throw new Error(
      `outputRoot must be the direct child named "dist" of sourceRoot ` +
      `(got relative path "${rel}")`,
    );
  }

  const wantsDist =
    process.platform === 'win32'
      ? parts[0].toLowerCase() === 'dist'
      : parts[0] === 'dist';

  if (!wantsDist) {
    throw new Error(
      `outputRoot must be the direct child named "dist" of sourceRoot ` +
      `(got relative path "${rel}")`,
    );
  }

  const htmlPath = join(resolvedSource, 'app', 'case-study.html');
  const jsPath = join(resolvedSource, 'app', 'case-study.js');
  const cssPath = join(resolvedSource, 'app', 'style.css');
  const workerPath = join(resolvedSource, 'sites', 'compatibility-worker.mjs');

  let prepared;
  try {
    const [htmlSource, js, css, worker] = await Promise.all([
      readFile(htmlPath, 'utf8'),
      readFile(jsPath),
      readFile(cssPath),
      readFile(workerPath),
    ]);
    let html = htmlSource;

    const expectedTokens = [
      '{{PUBLICATION_STATUS}}',
      '{{SOURCE_COMMIT_SHA}}',
      '{{PUBLIC_OFFER_NAME}}',
      '{{PUBLIC_OFFER_SUMMARY}}',
      '{{PUBLIC_CONTACT_URL}}',
      '{{PUBLIC_CONTACT_LABEL}}',
    ];

    for (const token of expectedTokens) {
      if (!html.includes(token)) {
        throw new Error(`Expected token ${token} not found in case-study.html`);
      }
    }

    const navMarker = '<a href="/">View the interactive demo</a>';
    if (!html.includes(navMarker)) {
      throw new Error(
        'Expected interactive-demo navigation marker not found in case-study.html',
      );
    }

    html = html.replaceAll('{{PUBLICATION_STATUS}}', 'ready');
    html = html.replaceAll('{{SOURCE_COMMIT_SHA}}', 'unavailable');
    html = html.replaceAll(
      '{{PUBLIC_OFFER_NAME}}',
      'Revenue Flow Guard \u2014 SaaS Release Confidence Sprint',
    );
    html = html.replaceAll(
      '{{PUBLIC_OFFER_SUMMARY}}',
      'Protect one revenue-critical SaaS journey with risk-driven Playwright tests, CI evidence, and a maintainable handoff.',
    );
    html = html.replaceAll(
      '{{PUBLIC_CONTACT_URL}}',
      'https://github.com/RomainROCH',
    );
    html = html.replaceAll(
      '{{PUBLIC_CONTACT_LABEL}}',
      'Contact Romain on GitHub',
    );

    html = html.replace(
      '<a href="/">View the interactive demo</a>',
      '<a href="https://github.com/RomainROCH/revenue-flow-guard">View source on GitHub</a>',
    );

    if (/\{\{/.test(html)) {
      throw new Error('Unresolved template tokens remain after replacement');
    }

    prepared = { html, js, css, worker };
  } catch (error) {
    await rm(resolvedOutput, { recursive: true, force: true });
    throw error;
  }

  const { html, js, css, worker } = prepared;

  await rm(resolvedOutput, { recursive: true, force: true });
  await mkdir(resolvedOutput, { recursive: true });

  await writeFile(join(resolvedOutput, 'index.html'), html, 'utf8');
  await writeFile(join(resolvedOutput, 'case-study.html'), html, 'utf8');
  await writeFile(join(resolvedOutput, 'case-study.js'), js);
  await writeFile(join(resolvedOutput, 'style.css'), css);
  await writeFile(join(resolvedOutput, '_worker.js'), worker);
}

const __filename = fileURLToPath(import.meta.url);
if (resolve(process.argv[1]) === __filename) {
  buildSite({
    sourceRoot: process.cwd(),
    outputRoot: join(process.cwd(), 'dist'),
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
