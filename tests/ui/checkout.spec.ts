import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/ui';

const orderIdPattern = /ord_[A-Za-z0-9_-]{43}/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CheckoutRequests = {
  idempotencyKeys: string[];
  paymentTokenRequests: number;
};

const observeCheckoutRequests = (page: Page): CheckoutRequests => {
  const observed: CheckoutRequests = {
    idempotencyKeys: [],
    paymentTokenRequests: 0,
  };

  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;

    if (request.method() === 'POST' && pathname === '/api/payment-tokens') {
      observed.paymentTokenRequests += 1;
    }

    if (request.method() === 'POST' && pathname === '/api/orders') {
      observed.idempotencyKeys.push(
        request.headers()['idempotency-key'] ?? '',
      );
    }
  });

  return observed;
};

const wirelessMouseItem = (page: Page) =>
  page.getByRole('listitem').filter({
    has: page.getByRole('heading', {
      name: 'Wireless Mouse',
      exact: true,
    }),
  });

const openCheckoutWithWirelessMouse = async (
  page: Page,
  baseURL: string,
): Promise<void> => {
  await page.goto(`${baseURL}/#dashboard`);
  await wirelessMouseItem(page)
    .getByRole('button', { name: /add to cart/i })
    .click();
  await expect(page.getByTestId('cart-count')).toHaveText('1');

  await page.getByRole('link', { name: 'Cart' }).click();
  await expect(page).toHaveURL(`${baseURL}/#checkout`);
  await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
};

const selectOutcome = async (
  page: Page,
  name: RegExp,
): Promise<void> => {
  const outcome = page.getByRole('radio', { name });
  await expect(outcome).toBeVisible();
  await outcome.check();
};

test.describe('safe demonstration checkout', () => {
  test('completes an approved order with the server total and clears the cart', async ({
    authenticatedPage,
    isolatedApp,
  }) => {
    const requests = observeCheckoutRequests(authenticatedPage);
    await openCheckoutWithWirelessMouse(authenticatedPage, isolatedApp.baseURL);

    await expect(authenticatedPage.getByLabel(/card number/i)).toHaveCount(0);
    await selectOutcome(authenticatedPage, /approved/i);
    await authenticatedPage
      .getByRole('button', { name: 'Place order' })
      .click();

    const confirmation = authenticatedPage.getByRole('region', {
      name: /order confirmation/i,
    });
    await expect(
      confirmation.getByRole('heading', { name: 'Order confirmed' }),
    ).toBeVisible();
    await expect(confirmation.getByText('$29.99', { exact: true })).toBeVisible();
    await expect(confirmation.getByText(orderIdPattern)).toBeVisible();
    await expect(authenticatedPage.getByTestId('cart-count')).toBeHidden();
    expect(requests.paymentTokenRequests).toBe(1);
    expect(requests.idempotencyKeys).toHaveLength(1);
    expect(requests.idempotencyKeys[0]).toMatch(uuidPattern);
  });

  test('shows a declined-payment message, preserves the cart, and uses a new key for a new attempt', async ({
    authenticatedPage,
    isolatedApp,
  }) => {
    const requests = observeCheckoutRequests(authenticatedPage);
    await openCheckoutWithWirelessMouse(authenticatedPage, isolatedApp.baseURL);

    await selectOutcome(authenticatedPage, /declined/i);
    await authenticatedPage
      .getByRole('button', { name: 'Place order' })
      .click();

    await expect(
      authenticatedPage.getByRole('alert'),
      'RFG:PAYMENT_DECLINE_HIDDEN:DECLINE_VISIBLE',
    ).toHaveText(
      'The demonstration payment was declined.',
    );
    await expect(authenticatedPage.getByTestId('cart-count')).toHaveText('1');

    await selectOutcome(authenticatedPage, /approved/i);
    await authenticatedPage
      .getByRole('button', { name: 'Place order' })
      .click();
    await expect(
      authenticatedPage.getByRole('heading', { name: 'Order confirmed' }),
    ).toBeVisible();

    expect(requests.paymentTokenRequests).toBe(2);
    expect(requests.idempotencyKeys).toHaveLength(2);
    expect(requests.idempotencyKeys[0]).toMatch(uuidPattern);
    expect(requests.idempotencyKeys[1]).toMatch(uuidPattern);
    expect(requests.idempotencyKeys[1]).not.toBe(requests.idempotencyKeys[0]);
  });

  test('preserves the cart and reuses only the transient attempt key and token on retry', async ({
    authenticatedPage,
    isolatedApp,
  }) => {
    const requests = observeCheckoutRequests(authenticatedPage);
    await openCheckoutWithWirelessMouse(authenticatedPage, isolatedApp.baseURL);

    await selectOutcome(authenticatedPage, /temporary failure/i);
    await authenticatedPage
      .getByRole('button', { name: 'Place order' })
      .click();

    await expect(authenticatedPage.getByRole('alert')).toHaveText(
      'The demonstration payment service is temporarily unavailable.',
    );
    await expect(authenticatedPage.getByTestId('cart-count')).toHaveText('1');

    await authenticatedPage
      .getByRole('button', { name: 'Retry order' })
      .click();
    await expect(
      authenticatedPage.getByRole('heading', { name: 'Order confirmed' }),
    ).toBeVisible();

    expect(requests.paymentTokenRequests).toBe(1);
    expect(requests.idempotencyKeys).toHaveLength(2);
    expect(requests.idempotencyKeys[0]).toMatch(uuidPattern);
    expect(requests.idempotencyKeys[1]).toBe(requests.idempotencyKeys[0]);
  });

  test('blocks checkout with an empty cart before any payment or order request', async ({
    authenticatedPage,
    isolatedApp,
  }) => {
    const requests = observeCheckoutRequests(authenticatedPage);
    await authenticatedPage.goto(`${isolatedApp.baseURL}/#checkout`);

    await expect(
      authenticatedPage.getByRole('heading', { name: 'Checkout' }),
    ).toBeVisible();
    await expect(authenticatedPage.getByRole('alert')).toContainText(
      /cart is empty/i,
    );
    const submit = authenticatedPage.getByRole('button', {
      name: 'Place order',
    });
    await expect(submit).toBeDisabled();
    await submit.press('Enter');

    expect(requests.paymentTokenRequests).toBe(0);
    expect(requests.idempotencyKeys).toHaveLength(0);
  });

  test('disables every submission path while the first order is pending', async ({
    authenticatedPage,
    isolatedApp,
  }) => {
    const requests = observeCheckoutRequests(authenticatedPage);
    await openCheckoutWithWirelessMouse(authenticatedPage, isolatedApp.baseURL);
    await selectOutcome(authenticatedPage, /approved/i);
    const submit = authenticatedPage.getByRole('button', {
      name: 'Place order',
    });
    const heldOrder = isolatedApp.holdNextOrder();

    try {
      await submit.click();
      await heldOrder.reached;
      await expect(
        submit,
        'RFG:SUBMIT_CONTROL_MISSING:SUBMIT_DISABLED',
      ).toBeDisabled();

      const outcomes = authenticatedPage.getByRole('radio');
      await expect(outcomes).toHaveCount(3);
      for (let index = 0; index < 3; index += 1) {
        await expect(outcomes.nth(index)).toBeDisabled();
      }

      await submit.press('Enter');
      await submit.evaluate((button: HTMLButtonElement) => button.click());
      await authenticatedPage.evaluate(
        () =>
          new Promise<void>((resolveFrame) => {
            requestAnimationFrame(() => resolveFrame());
          }),
      );
      expect(requests.idempotencyKeys).toHaveLength(1);
    } finally {
      heldOrder.release();
    }

    await expect(
      authenticatedPage.getByRole('heading', { name: 'Order confirmed' }),
    ).toBeVisible();
  });
});
