import { expect, test, type Page } from '@playwright/test';

/**
 * Full-stack auth lifecycle: register → logout → login → reload (lock) →
 * unlock → sign out from the lock screen. Run via `pnpm test:e2e:auth`
 * (see playwright.auth.config.ts for prerequisites — this needs a live
 * server + Postgres, not the static build).
 */

const PASSWORD = 'correct horse battery staple 9';
const TOKEN_KEY = 'silo:session_token';

function uniqueEmail(tag: string): string {
  return `auth-e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function register(page: Page, email: string, password = PASSWORD) {
  await page.goto('/register');
  await page.fill('input[type="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.fill('input[name="confirmPassword"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/vaults/);
}

async function fillAndSubmitLogin(page: Page, email: string, password: string) {
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
}

async function signOutFromSidebar(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/login$/);
}

function persistedToken(page: Page) {
  return page.evaluate((key) => sessionStorage.getItem(key), TOKEN_KEY);
}

test.describe('auth lifecycle', () => {
  test('registration creates an account, signs the user in, and persists a session token', async ({ page }) => {
    const email = uniqueEmail('register');
    await register(page, email);

    await expect(page).toHaveURL(/\/vaults/);
    expect(await persistedToken(page)).toBeTruthy();
  });

  test('signing out fully clears the session and the persisted token', async ({ page }) => {
    const email = uniqueEmail('logout');
    await register(page, email);

    await signOutFromSidebar(page);
    await expect(page).toHaveURL(/\/login$/);
    expect(await persistedToken(page)).toBeNull();

    // A real logout must not be resurrected by a reload.
    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('login rejects the wrong password and accepts the right one', async ({ page }) => {
    const email = uniqueEmail('login');
    await register(page, email);
    await signOutFromSidebar(page);

    await page.goto('/login');
    await fillAndSubmitLogin(page, email, 'definitely-the-wrong-password');
    await expect(page.getByText('Incorrect email or password.')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);

    await fillAndSubmitLogin(page, email, PASSWORD);
    await expect(page).toHaveURL(/\/vaults/);
  });

  test('reloading a logged-in session locks the vault instead of logging out', async ({ page }) => {
    const email = uniqueEmail('reload-lock');
    await register(page, email);

    // This is the regression this suite guards against: a reload used to wipe
    // the in-memory session and immediately bounce to /login.
    await page.reload();

    await expect(page).toHaveURL(/\/unlock$/);
    await expect(page.getByRole('heading', { name: /vault locked/i })).toBeVisible();
    // The token survives the reload — only the master key was dropped.
    expect(await persistedToken(page)).toBeTruthy();
  });

  test('the unlock screen verifies the password before restoring the session', async ({ page }) => {
    const email = uniqueEmail('unlock');
    await register(page, email);
    await page.reload();
    await expect(page).toHaveURL(/\/unlock$/);

    await page.fill('input[type="password"]', 'nope-not-the-password');
    await page.click('button[type="submit"]');
    await expect(page.getByText('Incorrect password.')).toBeVisible();
    await expect(page).toHaveURL(/\/unlock$/);

    await page.fill('input[type="password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/vaults/);
  });

  test('navigating to /login while locked redirects to /unlock', async ({ page }) => {
    const email = uniqueEmail('redirect');
    await register(page, email);
    await page.reload();
    await expect(page).toHaveURL(/\/unlock$/);

    await page.goto('/login');
    await expect(page).toHaveURL(/\/unlock$/);
  });

  test('signing out from the unlock screen is a full logout, not just a re-lock', async ({ page }) => {
    const email = uniqueEmail('unlock-signout');
    await register(page, email);
    await page.reload();
    await expect(page).toHaveURL(/\/unlock$/);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await persistedToken(page)).toBeNull();

    await page.reload();
    await expect(page).toHaveURL(/\/login$/);
  });
});
