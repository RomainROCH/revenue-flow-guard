import { test, expect } from './fixtures';

test.describe('dashboard flows', () => {
  test('displays the product catalog after authentication', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    const cards = page.getByRole('article');
    await expect(cards).toHaveCount(3);
  });

  test('adds a product to the cart and updates the badge', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    await page.getByRole('button', { name: /add to cart/i }).first().click();
    await expect(page.locator('#cart-badge')).toBeVisible();
    await expect(page.locator('#cart-badge')).toHaveText('1');
  });
});
