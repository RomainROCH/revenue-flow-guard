import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/ui';

const products = [
  {
    name: 'Wireless Mouse',
    priceCents: 2999,
    availableQuantity: 10,
  },
  {
    name: 'Mechanical Keyboard',
    priceCents: 8999,
    availableQuantity: 10,
  },
  {
    name: 'USB-C Hub',
    priceCents: 4999,
    availableQuantity: 10,
  },
] as const;

const formatPrice = (priceCents: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(priceCents / 100);

const wirelessMouseItem = (page: Page) =>
  page.getByRole('listitem').filter({
    has: page.getByRole('heading', {
      name: 'Wireless Mouse',
      exact: true,
    }),
  });

test.describe('catalog and cart', () => {
  test('renders the exact authenticated catalog as a semantic list', async ({
    authenticatedPage,
    isolatedApp,
  }) => {
    await authenticatedPage.goto(`${isolatedApp.baseURL}/#dashboard`);

    const catalog = authenticatedPage.getByRole('list');
    await expect(catalog).toHaveCount(1);
    await expect(catalog.getByRole('listitem')).toHaveCount(products.length);

    for (const product of products) {
      const item = catalog.getByRole('listitem').filter({
        has: authenticatedPage.getByRole('heading', {
          name: product.name,
          exact: true,
        }),
      });
      await expect(item).toHaveCount(1);
      await expect(
        item.getByText(formatPrice(product.priceCents), { exact: true }),
      ).toBeVisible();
      await expect(
        item.getByText(
          new RegExp(`${product.availableQuantity}\\s+available`, 'i'),
        ),
      ).toBeVisible();
    }
  });

  test('adds and removes the first product with native buttons and live feedback', async ({
    authenticatedPage,
    isolatedApp,
  }) => {
    await authenticatedPage.goto(`${isolatedApp.baseURL}/#dashboard`);

    const addButton = wirelessMouseItem(authenticatedPage).getByRole('button', {
      name: /add to cart/i,
    });
    await expect(addButton).toHaveJSProperty('tagName', 'BUTTON');
    await addButton.click();
    await expect(authenticatedPage.getByTestId('cart-count')).toHaveText('1');
    await expect(authenticatedPage.getByRole('status')).toContainText(
      'Wireless Mouse',
    );
    await expect(authenticatedPage.getByRole('status')).toContainText(/added/i);

    const removeButton = wirelessMouseItem(authenticatedPage).getByRole('button', {
      name: /remove from cart/i,
    });
    await expect(removeButton).toHaveJSProperty('tagName', 'BUTTON');
    await removeButton.click();
    await expect(authenticatedPage.getByTestId('cart-count')).toBeHidden();
    await expect(authenticatedPage.getByRole('status')).toContainText(
      'Wireless Mouse',
    );
    await expect(authenticatedPage.getByRole('status')).toContainText(/removed/i);
  });

  test('supports adding a product with the Enter key', async ({
    authenticatedPage,
    isolatedApp,
  }) => {
    await authenticatedPage.goto(`${isolatedApp.baseURL}/#dashboard`);

    const addButton = wirelessMouseItem(authenticatedPage).getByRole('button', {
      name: /add to cart/i,
    });
    await addButton.focus();
    await expect(addButton).toBeFocused();
    await authenticatedPage.keyboard.press('Enter');

    await expect(authenticatedPage.getByTestId('cart-count')).toHaveText('1');
    await expect(authenticatedPage.getByRole('status')).toContainText(
      'Wireless Mouse',
    );
    await expect(authenticatedPage.getByRole('status')).toContainText(/added/i);
  });

  test('starts a fresh authenticated browser context with an empty cart', async ({
    authenticatedPage,
    browser,
    isolatedApp,
  }) => {
    await authenticatedPage.goto(`${isolatedApp.baseURL}/#dashboard`);
    await wirelessMouseItem(authenticatedPage)
      .getByRole('button', { name: /add to cart/i })
      .click();
    await expect(authenticatedPage.getByTestId('cart-count')).toHaveText('1');

    const freshContext = await browser.newContext();
    try {
      const freshPage = await freshContext.newPage();
      const login = await freshPage.request.post(
        `${isolatedApp.baseURL}/api/session`,
        { data: { username: 'demo', password: 'demo' } },
      );
      expect(login.status()).toBe(201);

      await freshPage.goto(`${isolatedApp.baseURL}/#dashboard`);
      await expect(
        wirelessMouseItem(freshPage).getByRole('button', {
          name: /add to cart/i,
        }),
      ).toBeVisible();
      await expect(freshPage.getByTestId('cart-count')).toBeHidden();
      await expect(
        wirelessMouseItem(freshPage).getByRole('button', {
          name: /remove from cart/i,
        }),
      ).toHaveCount(0);
    } finally {
      await freshContext.close();
    }
  });
});

test.describe('mobile catalog', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('keeps product and cart controls visible, focusable, and within the viewport', async ({
    authenticatedPage,
    isolatedApp,
  }) => {
    await authenticatedPage.goto(`${isolatedApp.baseURL}/#dashboard`);

    const addButton = wirelessMouseItem(authenticatedPage).getByRole('button', {
      name: /add to cart/i,
    });
    await expect(addButton).toBeVisible();
    await expect(
      authenticatedPage.getByRole('link', { name: 'Cart' }),
    ).toBeVisible();
    await addButton.focus();
    await expect(addButton).toBeFocused();
    expect(
      await authenticatedPage.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  });
});
