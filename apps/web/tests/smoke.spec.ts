import { expect, test } from '@playwright/test';

test('login page renders the sign-in form', async ({ page }) => {
  await page.goto('/login');

  await expect(page).toHaveTitle(/sign in/i);
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});

test('register page renders the sign-up form', async ({ page }) => {
  await page.goto('/register');

  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
