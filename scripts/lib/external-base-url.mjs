const VALID_RESULT = 'VALID_EXTERNAL_BASE_URL';
const INVALID_RESULT = Object.freeze({
  valid: false,
  code: 'INVALID_EXTERNAL_BASE_URL',
});

export function validateExternalBaseUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return INVALID_RESULT;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return INVALID_RESULT;
  }

  const explicitPort = /^http:\/\/127\.0\.0\.1:([0-9]+)$/.exec(raw);
  if (
    !explicitPort ||
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    return INVALID_RESULT;
  }

  const port = Number(explicitPort[1]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    return INVALID_RESULT;
  }

  return {
    valid: true,
    code: VALID_RESULT,
    normalizedUrl: `http://127.0.0.1:${port}`,
  };
}
