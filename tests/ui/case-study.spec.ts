import { devices, type Page } from '@playwright/test';
import { expect, test } from '../fixtures/ui';

const COMMIT_SHA = 'a'.repeat(40);
const OTHER_COMMIT_SHA = 'b'.repeat(40);
const FAULTS = [
  {
    id: 'AUTH_BYPASS',
    testId:
      'tests/api/catalog.spec.ts › GET /api/products requires a known session and leaks no catalogue data',
    expectedSignature: 'RFG:AUTH_BYPASS:AUTH_REQUIRED',
  },
  {
    id: 'CLIENT_PRICE_TRUST',
    testId:
      'tests/api/orders.spec.ts › POST /api/orders enforces exact top-level and item fields and forbids client prices or totals',
    expectedSignature: 'RFG:CLIENT_PRICE_TRUST:CLIENT_AMOUNT_FORBIDDEN',
  },
  {
    id: 'DUPLICATE_ORDER',
    testId:
      'tests/api/orders.spec.ts › a successful order uses canonical item order, server totals, an opaque id, and replays exactly once',
    expectedSignature: 'RFG:DUPLICATE_ORDER:IDEMPOTENT_REPLAY',
  },
  {
    id: 'EMPTY_CART_ACCEPTED',
    testId:
      'tests/api/orders.spec.ts › POST /api/orders maps empty, duplicate, unknown, and invalid-quantity items to INVALID_ITEMS without stock changes',
    expectedSignature: 'RFG:EMPTY_CART_ACCEPTED:EMPTY_CART_REJECTED',
  },
  {
    id: 'PAYMENT_DECLINE_HIDDEN',
    testId:
      'tests/ui/checkout.spec.ts › safe demonstration checkout › shows a declined-payment message, preserves the cart, and uses a new key for a new attempt',
    expectedSignature: 'RFG:PAYMENT_DECLINE_HIDDEN:DECLINE_VISIBLE',
  },
  {
    id: 'SUBMIT_CONTROL_MISSING',
    testId:
      'tests/ui/checkout.spec.ts › safe demonstration checkout › disables every submission path while the first order is pending',
    expectedSignature: 'RFG:SUBMIT_CONTROL_MISSING:SUBMIT_DISABLED',
  },
];

function validEvidence() {
  return {
    schemaVersion: 1,
    complete: true,
    sanitized: true,
    source: {
      commitSha: COMMIT_SHA,
      ciRunId: '987654321',
      ciRunUrl:
        'https://github.com/RomainROCH/revenue-flow-guard/actions/runs/987654321',
    },
    generatedAt: '2026-07-14T12:00:00.000Z',
    baseline: {
      status: 'passed',
      tests: 96,
      retries: 0,
      durationMs: 12_345.25,
    },
    faults: FAULTS.map(({ id, testId, expectedSignature }) => ({
      id,
      testId,
      expectedSignature,
      observedSignature: expectedSignature,
      status: 'detected',
    })),
  };
}

test.use({
  applicationOptions: {
    environment: {
      PUBLIC_CONTACT_URL: 'https://example.test/contact',
      PUBLIC_CONTACT_LABEL: 'Contact the Revenue Flow Guard team',
      PUBLIC_OFFER_NAME: 'Revenue Flow Guard — SaaS Release Confidence Sprint',
      PUBLIC_OFFER_SUMMARY:
        'Protect one revenue-critical SaaS journey with risk-driven Playwright tests, CI evidence, and a maintainable handoff.',
      SOURCE_COMMIT_SHA: COMMIT_SHA,
      PUBLIC_EVIDENCE_JSON: JSON.stringify(validEvidence()),
    },
  },
});

test('presents the Revenue Flow Guard case study without unsupported claims', async ({
  isolatedApp,
  page,
}) => {
  await page.goto(`${isolatedApp.baseURL}/case-study.html`);

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Protect the flow that pays you',
      exact: true,
    }),
  ).toBeVisible();

  for (const sectionName of [
    'Risks demonstrated',
    'How protection works',
    'Delivery method',
    'What the sprint delivers',
    'Live evidence',
    'What this demo does not prove',
    'Start a conversation',
  ]) {
    await expect(
      page.getByRole('heading', { level: 2, name: sectionName, exact: true }),
    ).toBeVisible();
  }

  const risks = page.locator('section').filter({
    has: page.getByRole('heading', {
      level: 2,
      name: 'Risks demonstrated',
      exact: true,
    }),
  });
  for (const risk of [
    'Authentication bypass',
    'Client-controlled pricing',
    'Duplicate orders',
    'Empty-cart submission',
    'Hidden payment decline',
    'Missing pending-state control',
  ]) {
    await expect(risks.getByRole('listitem').filter({ hasText: risk })).toBeVisible();
  }

  const architecture = page.locator('section').filter({
    has: page.getByRole('heading', {
      level: 2,
      name: 'How protection works',
      exact: true,
    }),
  });
  for (const text of [
    'browser/API tests',
    'isolated state',
    'idempotent checkout',
    'regression profiles',
    'commit-bound CI evidence',
  ]) {
    await expect(architecture).toContainText(text);
  }

  const delivery = page.locator('section').filter({
    has: page.getByRole('heading', {
      level: 2,
      name: 'Delivery method',
      exact: true,
    }),
  });
  for (const text of [
    'discovery',
    'risk map',
    'implementation/repair',
    'CI evidence',
    'handoff',
  ]) {
    await expect(delivery).toContainText(text);
  }

  const offerName = page.getByText(
    'Revenue Flow Guard — SaaS Release Confidence Sprint',
    { exact: true },
  );
  await expect(offerName).toHaveCount(2);
  await expect(offerName.first()).toBeVisible();
  await expect(offerName.last()).toBeVisible();

  const offerSummary = page.getByText(
    'Protect one revenue-critical SaaS journey with risk-driven Playwright tests, CI evidence, and a maintainable handoff.',
    { exact: true },
  );
  await expect(offerSummary).toHaveCount(2);
  await expect(offerSummary.first()).toBeVisible();
  await expect(offerSummary.last()).toBeVisible();
  await expect(
    page.getByRole('link', {
      name: 'Contact the Revenue Flow Guard team',
      exact: true,
    }),
  ).toHaveAttribute('href', 'https://example.test/contact');

  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('contentinfo')).toBeVisible();
  await expect(
    page.getByRole('link', {
      name: 'View the interactive demo',
      exact: true,
    }),
  ).toHaveAttribute('href', '/');

  await expect(page.locator('body')).not.toContainText(
    /\b\d+\s*(day|days)\b|\bsavings?\b|\bclient revenue\b|\bproduction defect reduction\b|\bguarantee(?:d|s)?\b/i,
  );
});

test('renders complete commit-bound live evidence', async ({ isolatedApp, page }) => {
  await page.goto(`${isolatedApp.baseURL}/case-study.html`);

  const evidence = page.getByTestId('live-evidence');
  await expect(evidence).toContainText('96 baseline tests passed with zero retries.');
  await expect(evidence).toContainText('6 of 6 synthetic regressions detected.');
  for (const { id } of FAULTS) {
    await expect(evidence).toContainText(id);
  }
  await expect(evidence.getByText(COMMIT_SHA, { exact: true })).toBeVisible();
  await expect(evidence.locator('time')).toHaveAttribute(
    'datetime',
    '2026-07-14T12:00:00.000Z',
  );
  await expect(
    evidence.getByRole('link', {
      name: 'View CI run 987654321',
      exact: true,
    }),
  ).toHaveAttribute(
    'href',
    'https://github.com/RomainROCH/revenue-flow-guard/actions/runs/987654321',
  );
});

test('shows a static evidence fallback when JavaScript is disabled', async ({
  browser,
  isolatedApp,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  try {
    await page.goto(`${isolatedApp.baseURL}/case-study.html`);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Protect the flow that pays you',
        exact: true,
      }),
    ).toBeVisible();
    const evidence = page.getByTestId('live-evidence');
    await expect(evidence).not.toHaveAttribute('aria-busy', 'true');
    await expect(
      page.getByText(
        'Live evidence requires JavaScript; no result is shown in this static view.',
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText('baseline tests passed');
    await expect(page.locator('body')).not.toContainText(
      'synthetic regressions detected',
    );
  } finally {
    await context.close();
  }
});

test('fails closed for unavailable, invalid, or stale client evidence', async ({
  isolatedApp,
  page,
}) => {
  const valid = validEvidence();
  const missingFault = validEvidence();
  missingFault.faults.pop();
  const cases: Array<
    | { status: number; body?: string; contentType?: string }
    | { status?: number; body: string; contentType?: string }
  > = [
    { status: 503 },
    { body: '{malformed-json', contentType: 'application/json' },
    { body: JSON.stringify({ ...valid, schemaVersion: 2 }) },
    { body: JSON.stringify({ ...valid, complete: false }) },
    { body: JSON.stringify({ ...valid, sanitized: false }) },
    {
      body: JSON.stringify({
        ...valid,
        source: { ...valid.source, commitSha: OTHER_COMMIT_SHA },
      }),
    },
    { body: JSON.stringify(missingFault) },
  ];

  for (const candidate of cases) {
    await page.unroute('**/evidence/latest.json');
    await page.route('**/evidence/latest.json', async (route) => {
      await route.fulfill({
        status: candidate.status ?? 200,
        contentType: candidate.contentType ?? 'application/json',
        body: candidate.body ?? '',
      });
    });

    await page.goto(`${isolatedApp.baseURL}/case-study.html`);
    await expect(page.locator(`main[data-source-commit="${COMMIT_SHA}"]`)).toBeVisible();
    const evidence = page.getByTestId('live-evidence');
    await expect(
      evidence.getByText('Evidence unavailable or incomplete', { exact: true }),
    ).toBeVisible();
    await expect(evidence).not.toContainText('baseline tests passed');
    await expect(evidence).not.toContainText('synthetic regressions detected');
    for (const { id } of FAULTS) {
      await expect(evidence).not.toContainText(id);
    }
  }
});

test('keeps primary actions within desktop and mobile viewports', async ({
  browser,
  isolatedApp,
  page,
}) => {
  const assertPrimaryActionsFit = async (targetPage: Page) => {
    await expect
      .poll(() =>
        targetPage.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(0);

    const viewport = targetPage.viewportSize();
    expect(viewport).not.toBeNull();
    for (const link of [
      targetPage.getByRole('link', {
        name: 'View the interactive demo',
        exact: true,
      }),
      targetPage.getByRole('link', {
        name: 'Contact the Revenue Flow Guard team',
        exact: true,
      }),
    ]) {
      const box = await link.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
    }
  };

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${isolatedApp.baseURL}/case-study.html`);
  await assertPrimaryActionsFit(page);

  const pixelContext = await browser.newContext({ ...devices['Pixel 7'] });
  try {
    const pixelPage = await pixelContext.newPage();
    await pixelPage.goto(`${isolatedApp.baseURL}/case-study.html`);
    await expect(pixelPage.locator('.proof-strip')).toBeVisible();

    const offerBox = await pixelPage.locator('.offer-name').boundingBox();
    const summaryBox = await pixelPage.locator('.case-summary').boundingBox();
    expect(offerBox).not.toBeNull();
    expect(summaryBox).not.toBeNull();
    expect(offerBox!.y + offerBox!.height).toBeLessThanOrEqual(summaryBox!.y);

    await assertPrimaryActionsFit(pixelPage);
  } finally {
    await pixelContext.close();
  }
});

test('provides visible focus for the primary keyboard path', async ({
  isolatedApp,
  page,
}) => {
  await page.goto(`${isolatedApp.baseURL}/case-study.html`);
  const demoLink = page.getByRole('link', {
    name: 'View the interactive demo',
    exact: true,
  });
  const contactLink = page.getByRole('link', {
    name: 'Contact the Revenue Flow Guard team',
    exact: true,
  });
  const ciLink = page.getByRole('link', {
    name: 'View CI run 987654321',
    exact: true,
  });

  await page.keyboard.press('Tab');
  await expect(demoLink).toBeFocused();
  expect(
    await demoLink.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe('none');

  await page.keyboard.press('Tab');
  await expect(ciLink).toBeFocused();
  expect(
    await ciLink.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe('none');

  await page.keyboard.press('Tab');
  await expect(contactLink).toBeFocused();
  expect(
    await contactLink.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe('none');
  expect(
    await contactLink.evaluate((element) => getComputedStyle(element).outlineColor),
  ).toBe('rgb(255, 240, 199)');
});

test('remains usable at 200 percent zoom', async ({ isolatedApp, page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${isolatedApp.baseURL}/case-study.html`);
  await page.evaluate(() => {
    document.documentElement.style.zoom = '200%';
  });

  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(0);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Protect the flow that pays you',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', {
      name: 'Contact the Revenue Flow Guard team',
      exact: true,
    }),
  ).toBeVisible();
});
