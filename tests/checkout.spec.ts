import { test, expect } from './fixtures';

test.describe('checkout flows', () => {
  test('completes the full checkout flow and shows order confirmation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    await page.getByRole('button', { name: /add to cart/i }).first().click();

    await page.getByRole('link', { name: 'Cart' }).click();
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();

    await page.getByLabel('Full Name').fill('Jane Doe');
    await page.getByLabel('Address').fill('123 Main St');
    await page.getByLabel('Card Number').fill('1234567890123456');
    await page.getByRole('button', { name: 'Place Order' }).click();

    await expect(page.getByText(/order confirmed/i)).toBeVisible();
    await expect(page.locator('#order-id')).not.toBeEmpty();
  });

  test('shows validation errors for incomplete checkout form', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    await page.getByRole('button', { name: /add to cart/i }).first().click();

    await page.getByRole('link', { name: 'Cart' }).click();
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();

    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page.getByText('Please fill in all fields.')).toBeVisible();
  });

  test('shows a controlled error message when order creation fails', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    await page.getByRole('button', { name: /add to cart/i }).first().click();

    await page.getByRole('link', { name: 'Cart' }).click();
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();

    await page.getByLabel('Full Name').fill('Jane Doe');
    await page.getByLabel('Address').fill('123 Main St');
    await page.getByLabel('Card Number').fill('1234567890123456');

    await page.route('**/api/orders', async (route) => {
      await route.fulfill({ status: 500 });
    });
    await page.getByRole('button', { name: 'Place Order' }).click();
    await expect(page.getByText(/could not place your order/i)).toBeVisible();
  });
});
