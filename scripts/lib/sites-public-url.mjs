export function parseSitesPublicUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { valid: false, code: 'SITES_PUBLIC_URL_MISSING_OR_EMPTY' };
  }

  if (raw !== raw.trim()) {
    return { valid: false, code: 'SITES_PUBLIC_URL_SURROUNDING_WHITESPACE' };
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { valid: false, code: 'SITES_PUBLIC_URL_INVALID' };
  }

  if (url.protocol !== 'https:') {
    return { valid: false, code: 'SITES_PUBLIC_URL_NOT_HTTPS' };
  }

  if (url.username || url.password) {
    return { valid: false, code: 'SITES_PUBLIC_URL_HAS_CREDENTIALS' };
  }

  const authority = raw.slice(raw.indexOf('://') + 3).split(/[/?#]/, 1)[0];
  const host = authority.slice(authority.lastIndexOf('@') + 1);
  const hasExplicitPort = host.startsWith('[')
    ? host.slice(host.indexOf(']') + 1).startsWith(':')
    : host.includes(':');
  if (hasExplicitPort) {
    return { valid: false, code: 'SITES_PUBLIC_URL_HAS_PORT' };
  }

  if (url.search) {
    return { valid: false, code: 'SITES_PUBLIC_URL_HAS_QUERY' };
  }

  if (url.hash) {
    return { valid: false, code: 'SITES_PUBLIC_URL_HAS_FRAGMENT' };
  }

  if (url.pathname !== '/' && url.pathname !== '') {
    return { valid: false, code: 'SITES_PUBLIC_URL_NON_ROOT_PATH' };
  }

  return { valid: true, origin: url.origin };
}
