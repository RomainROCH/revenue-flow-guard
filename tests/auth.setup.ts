import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '..', 'playwright', '.auth', 'user.json');

setup('authenticate as demo user', async ({ page }) => {
  const fs = await import('fs/promises');
  await fs.mkdir(path.dirname(authFile), { recursive: true });

  await page.goto('/');
  await page.getByLabel('Username').fill('demo');
  await page.getByLabel('Password').fill('demo');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.locator('#nav')).toBeVisible();
  await page.waitForURL(/#dashboard/);

  await page.context().storageState({ path: authFile });
});
