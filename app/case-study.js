(function () {
  'use strict';

  const canonicalFaults = Object.freeze([
    Object.freeze({
      id: 'AUTH_BYPASS',
      testId:
        'tests/api/catalog.spec.ts › GET /api/products requires a known session and leaks no catalogue data',
      expectedSignature: 'RFG:AUTH_BYPASS:AUTH_REQUIRED',
    }),
    Object.freeze({
      id: 'CLIENT_PRICE_TRUST',
      testId:
        'tests/api/orders.spec.ts › POST /api/orders enforces exact top-level and item fields and forbids client prices or totals',
      expectedSignature: 'RFG:CLIENT_PRICE_TRUST:CLIENT_AMOUNT_FORBIDDEN',
    }),
    Object.freeze({
      id: 'DUPLICATE_ORDER',
      testId:
        'tests/api/orders.spec.ts › a successful order uses canonical item order, server totals, an opaque id, and replays exactly once',
      expectedSignature: 'RFG:DUPLICATE_ORDER:IDEMPOTENT_REPLAY',
    }),
    Object.freeze({
      id: 'EMPTY_CART_ACCEPTED',
      testId:
        'tests/api/orders.spec.ts › POST /api/orders maps empty, duplicate, unknown, and invalid-quantity items to INVALID_ITEMS without stock changes',
      expectedSignature: 'RFG:EMPTY_CART_ACCEPTED:EMPTY_CART_REJECTED',
    }),
    Object.freeze({
      id: 'PAYMENT_DECLINE_HIDDEN',
      testId:
        'tests/ui/checkout.spec.ts › safe demonstration checkout › shows a declined-payment message, preserves the cart, and uses a new key for a new attempt',
      expectedSignature: 'RFG:PAYMENT_DECLINE_HIDDEN:DECLINE_VISIBLE',
    }),
    Object.freeze({
      id: 'SUBMIT_CONTROL_MISSING',
      testId:
        'tests/ui/checkout.spec.ts › safe demonstration checkout › disables every submission path while the first order is pending',
      expectedSignature: 'RFG:SUBMIT_CONTROL_MISSING:SUBMIT_DISABLED',
    }),
  ]);
  const canonicalById = new Map(canonicalFaults.map((fault) => [fault.id, fault]));

  function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function hasExactKeys(value, keys) {
    return isObject(value) &&
      Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000');
  }

  function isIsoTimestamp(value) {
    if (typeof value !== 'string') {
      return false;
    }

    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
  }

  function isValidCiSource(source) {
    if (source.ciRunId === null || source.ciRunUrl === null) {
      return source.ciRunId === null && source.ciRunUrl === null;
    }
    if (typeof source.ciRunId !== 'string' || !/^[1-9]\d*$/.test(source.ciRunId)) {
      return false;
    }
    if (typeof source.ciRunUrl !== 'string') {
      return false;
    }

    try {
      const url = new URL(source.ciRunUrl);
      return url.protocol === 'https:' &&
        url.hostname === 'github.com' &&
        url.username === '' &&
        url.password === '' &&
        /^\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(url.pathname) &&
        url.pathname.endsWith(`/actions/runs/${source.ciRunId}`) &&
        url.search === '' &&
        url.hash === '';
    } catch {
      return false;
    }
  }

  function isValidBaseline(baseline) {
    return hasExactKeys(baseline, ['status', 'tests', 'retries', 'durationMs']) &&
      baseline.status === 'passed' &&
      Number.isSafeInteger(baseline.tests) &&
      baseline.tests > 0 &&
      baseline.retries === 0 &&
      typeof baseline.durationMs === 'number' &&
      Number.isFinite(baseline.durationMs) &&
      baseline.durationMs >= 0;
  }

  function areValidFaults(faults) {
    if (!Array.isArray(faults) || faults.length !== canonicalFaults.length) {
      return false;
    }

    const seen = new Set();
    for (const fault of faults) {
      if (!hasExactKeys(fault, [
        'id',
        'testId',
        'expectedSignature',
        'observedSignature',
        'status',
      ])) {
        return false;
      }
      const canonical = canonicalById.get(fault.id);
      if (!canonical || seen.has(fault.id)) {
        return false;
      }
      if (fault.testId !== canonical.testId ||
        fault.expectedSignature !== canonical.expectedSignature ||
        fault.observedSignature !== fault.expectedSignature ||
        fault.status !== 'detected') {
        return false;
      }
      seen.add(fault.id);
    }

    return seen.size === canonicalFaults.length;
  }

  function isValidEvidence(evidence, sourceCommitSha) {
    return hasExactKeys(evidence, [
      'schemaVersion',
      'complete',
      'sanitized',
      'source',
      'generatedAt',
      'baseline',
      'faults',
    ]) &&
      evidence.schemaVersion === 1 &&
      evidence.complete === true &&
      evidence.sanitized === true &&
      hasExactKeys(evidence.source, ['commitSha', 'ciRunId', 'ciRunUrl']) &&
      typeof evidence.source.commitSha === 'string' &&
      /^[0-9a-f]{40}$/.test(evidence.source.commitSha) &&
      evidence.source.commitSha === sourceCommitSha &&
      isValidCiSource(evidence.source) &&
      isIsoTimestamp(evidence.generatedAt) &&
      isValidBaseline(evidence.baseline) &&
      areValidFaults(evidence.faults);
  }

  function appendParagraph(container, text) {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    container.append(paragraph);
  }

  function renderUnavailable(container) {
    container.replaceChildren();
    appendParagraph(container, 'Evidence unavailable or incomplete');
    container.setAttribute('aria-busy', 'false');
  }

  function renderEvidence(container, evidence) {
    container.replaceChildren();
    appendParagraph(
      container,
      `${evidence.baseline.tests} baseline tests passed with zero retries.`,
    );
    appendParagraph(
      container,
      `${evidence.faults.length} of ${canonicalFaults.length} synthetic regressions detected.`,
    );

    const list = document.createElement('ul');
    for (const canonical of canonicalFaults) {
      const item = document.createElement('li');
      item.textContent = canonical.id;
      list.append(item);
    }
    container.append(list);

    const metadata = document.createElement('p');
    metadata.append('Commit ');
    const commit = document.createElement('code');
    commit.textContent = evidence.source.commitSha;
    metadata.append(commit, ' · Generated ');
    const generated = document.createElement('time');
    generated.dateTime = evidence.generatedAt;
    generated.textContent = new Date(evidence.generatedAt).toLocaleString();
    metadata.append(generated);
    container.append(metadata);

    const source = document.createElement('p');
    if (evidence.source.ciRunId === null) {
      source.textContent = 'Local evidence run';
    } else {
      const link = document.createElement('a');
      link.href = evidence.source.ciRunUrl;
      link.textContent = `View CI run ${evidence.source.ciRunId}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      source.append(link);
    }
    container.append(source);
    container.setAttribute('aria-busy', 'false');
  }

  const main = document.querySelector('main[data-source-commit]');
  const container = document.querySelector('[data-testid="live-evidence"]');
  if (!(main instanceof HTMLElement) || !(container instanceof HTMLElement)) {
    return;
  }

  container.setAttribute('aria-busy', 'true');
  fetch('/evidence/latest.json', {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error('Evidence request failed');
      }
      return response.json();
    })
    .then((evidence) => {
      if (!isValidEvidence(evidence, main.dataset.sourceCommit)) {
        throw new Error('Evidence validation failed');
      }
      renderEvidence(container, evidence);
    })
    .catch(() => {
      renderUnavailable(container);
    });
})();
