import { test, expect } from './fixtures';

test.describe('logged-out auth flow', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('authenticates a valid user through the UI', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Username').fill('demo');
    await page.getByLabel('Password').fill('demo');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('#nav')).toBeVisible();
    await expect(page).toHaveURL(/#dashboard/);
  });

  test('rejects invalid credentials and shows an error message', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Username').fill('invalid');
    await page.getByLabel('Password').fill('wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Invalid credentials')).toBeVisible();
  });
});

test.describe('logged-in auth flow', () => {
  test('logs out and returns to the login page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
  });
});
