import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/ui';

const productNames = [
  'Wireless Mouse',
  'Mechanical Keyboard',
  'USB-C Hub',
] as const;

const expectProtectedUiHidden = async (page: Page): Promise<void> => {
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Products' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Checkout' })).toHaveCount(0);
  await expect(page.getByLabel('Full Name')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Place Order' })).toHaveCount(0);
  await expect(page.getByText('Order Confirmed!', { exact: true })).toHaveCount(0);

  for (const productName of productNames) {
    await expect(page.getByText(productName, { exact: true })).toHaveCount(0);
  }
};

test.describe('session-backed authentication', () => {
  test('signs in with valid demo credentials and opens the product dashboard', async ({
    isolatedApp,
    page,
  }) => {
    await page.goto(`${isolatedApp.baseURL}/#login`);
    await page.getByLabel('Username').fill('demo');
    await page.getByLabel('Password').fill('demo');

    const heldResponse = isolatedApp.holdNextSessionResponse();
    const signIn = page.getByRole('button', {
      name: /sign(?:ing)? in/i,
    });

    try {
      await signIn.click();
      await heldResponse.reached;
      await expect(signIn).toBeDisabled();
      await expect(page.getByRole('status')).toBeVisible();
    } finally {
      heldResponse.release();
    }

    await expect(page).toHaveURL(`${isolatedApp.baseURL}/#dashboard`);
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
  });

  test('shows the exact server error for invalid credentials without protected navigation', async ({
    isolatedApp,
    page,
  }) => {
    await page.goto(`${isolatedApp.baseURL}/#login`);
    await page.getByLabel('Username').fill('demo');
    await page.getByLabel('Password').fill('incorrect');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByRole('alert')).toHaveText(
      'The username or password is incorrect.',
    );
    await expectProtectedUiHidden(page);
  });

  test('logs out, invalidates the server session, and returns to login', async ({
    authenticatedPage,
    isolatedApp,
  }) => {
    await authenticatedPage.goto(`${isolatedApp.baseURL}/#dashboard`);
    await expect(
      authenticatedPage.getByRole('heading', { name: 'Products' }),
    ).toBeVisible();

    await authenticatedPage.getByRole('button', { name: 'Logout' }).click();

    await expect(authenticatedPage).toHaveURL(`${isolatedApp.baseURL}/#login`);
    await expect(
      authenticatedPage.getByRole('heading', { name: 'Sign In' }),
    ).toBeVisible();
    expect(
      (
        await authenticatedPage.request.get(
          `${isolatedApp.baseURL}/api/session`,
        )
      ).status(),
    ).toBe(401);
  });

  for (const protectedHash of ['dashboard', 'checkout'] as const) {
    test(`does not reveal ${protectedHash} while an unauthenticated session check is pending`, async ({
      isolatedApp,
      page,
    }) => {
      const heldResponse = isolatedApp.holdNextSessionResponse();

      try {
        await page.goto(`${isolatedApp.baseURL}/#${protectedHash}`);
        await heldResponse.reached;
        await expectProtectedUiHidden(page);
      } finally {
        heldResponse.release();
      }

      await expect(page).toHaveURL(`${isolatedApp.baseURL}/#login`);
      await expect(
        page.getByRole('heading', { name: 'Sign In' }),
      ).toBeVisible();
      await expectProtectedUiHidden(page);
    });
  }
});
