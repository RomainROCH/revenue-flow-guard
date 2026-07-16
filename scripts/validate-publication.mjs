function diag(message) {
  process.stderr.write(`PUBLICATION:${message}\n`);
}

function exitFail(message) {
  diag(message);
  process.exit(1);
}

function validateCleanHttpsUrl(raw, label) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    exitFail(`${label} must be a valid URL`);
  }
  if (url.protocol !== 'https:') {
    exitFail(`${label} must use HTTPS`);
  }
  if (url.username || url.password) {
    exitFail(`${label} must not contain credentials`);
  }
  if (url.search) {
    exitFail(`${label} must not contain a query string`);
  }
  if (url.hash) {
    exitFail(`${label} must not contain a fragment`);
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    exitFail(`${label} must be a root URL with no path`);
  }
  return url;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    exitFail('unexpected arguments');
  }

  const publicUrl = validateCleanHttpsUrl(process.env.PUBLIC_URL, 'PUBLIC_URL');
  const normalizedPublic = `${publicUrl.origin}/`;

  const rfgExternal = process.env.RFG_EXTERNAL_BASE_URL;
  if (rfgExternal !== undefined && rfgExternal !== '') {
    const externalUrl = validateCleanHttpsUrl(rfgExternal, 'RFG_EXTERNAL_BASE_URL');
    const normalizedExternal = `${externalUrl.origin}/`;
    if (normalizedPublic !== normalizedExternal) {
      exitFail(`RFG_EXTERNAL_BASE_URL ${normalizedExternal} does not match PUBLIC_URL ${normalizedPublic}`);
    }
  }

  process.stdout.write(`${publicUrl.hostname}\n`);
}

main();
