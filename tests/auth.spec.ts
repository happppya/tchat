import { test, expect } from "@playwright/test";

/**
 * Authentication flow tests: signup, login, route guards, logout, and
 * duplicate-username / wrong-password handling.
 */

let userCounter = 0;
function uniqueUser() {
  return `authuser${Date.now()}_${userCounter++}`;
}

const PASSWORD = "password123";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("signs up and is logged in (redirected to chat)", async ({ page }) => {
  const name = uniqueUser();
  await page.goto("/signup");
  await page.fill('input[placeholder="user"]', name);
  await page.fill('input[placeholder="at least 8 chars"]', PASSWORD);
  await page.fill('input[placeholder="••••••••"]', PASSWORD);
  await page.click('button[type="submit"]');

  // Should land on the chat page (create-gc toggle is visible when authed).
  await expect(page.locator('[data-testid="create-gc-toggle"]')).toBeVisible();
  // The sidebar shows the username.
  await expect(page.locator('[data-testid="current-user"]')).toContainText(name);
});

test("logging out redirects to /login", async ({ page }) => {
  const name = uniqueUser();
  await page.goto("/signup");
  await page.fill('input[placeholder="user"]', name);
  await page.fill('input[placeholder="at least 8 chars"]', PASSWORD);
  await page.fill('input[placeholder="••••••••"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="create-gc-toggle"]')).toBeVisible();

  await page.click('[data-testid="logout-button"]');
  // Should be back on the login page.
  await expect(page.locator("h2")).toContainText("login");
});

test("visiting / while logged out redirects to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h2")).toContainText("login");
});

test("can log in with an existing account", async ({ page }) => {
  const name = uniqueUser();
  // First, create the account via the API so the login form is exercised.
  await page.goto("/signup");
  await page.fill('input[placeholder="user"]', name);
  await page.fill('input[placeholder="at least 8 chars"]', PASSWORD);
  await page.fill('input[placeholder="••••••••"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="create-gc-toggle"]')).toBeVisible();

  // Log out, then log back in.
  await page.click('[data-testid="logout-button"]');
  await expect(page.locator("h2")).toContainText("login");

  await page.fill('input[placeholder="user"]', name);
  await page.fill('input[placeholder="••••••••"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="create-gc-toggle"]')).toBeVisible();
  await expect(page.locator('[data-testid="current-user"]')).toContainText(name);
});

test("duplicate username is rejected", async ({ page }) => {
  const name = uniqueUser();
  // First signup succeeds.
  await page.goto("/signup");
  await page.fill('input[placeholder="user"]', name);
  await page.fill('input[placeholder="at least 8 chars"]', PASSWORD);
  await page.fill('input[placeholder="••••••••"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="create-gc-toggle"]')).toBeVisible();

  // Log out and try the same username again.
  await page.click('[data-testid="logout-button"]');
  await page.goto("/signup");
  await page.fill('input[placeholder="user"]', name);
  await page.fill('input[placeholder="at least 8 chars"]', PASSWORD);
  await page.fill('input[placeholder="••••••••"]', PASSWORD);
  await page.click('button[type="submit"]');

  // Should show an error and stay on the signup page.
  await expect(page.locator("text=already taken")).toBeVisible();
});

test("wrong password is rejected", async ({ page }) => {
  const name = uniqueUser();
  // Create the account.
  await page.goto("/signup");
  await page.fill('input[placeholder="user"]', name);
  await page.fill('input[placeholder="at least 8 chars"]', PASSWORD);
  await page.fill('input[placeholder="••••••••"]', PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="create-gc-toggle"]')).toBeVisible();

  // Log out, then attempt login with a wrong password.
  await page.click('[data-testid="logout-button"]');
  await expect(page.locator("h2")).toContainText("login");

  await page.fill('input[placeholder="user"]', name);
  await page.fill('input[placeholder="••••••••"]', "wrongpassword");
  await page.click('button[type="submit"]');

  await expect(page.locator("text=Invalid username or password")).toBeVisible();
});
