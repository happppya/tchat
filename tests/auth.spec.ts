import { test, expect } from "@playwright/test";
import {
  uniqueUsername,
  fillSignupForm,
  fillLoginForm,
  resetApp,
} from "./helpers";

/**
 * Authentication flow tests: signup, login, route guards, logout, and
 * duplicate-username / wrong-password handling.
 */

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test("signs up and is logged in (redirected to chat)", async ({ page }) => {
  const name = uniqueUsername("authuser");
  await page.goto("/signup");
  await fillSignupForm(page, name);
  await page.click('button[type="submit"]');

  // Should land on the chat page (room-code-input is visible when authed).
  await expect(page.locator('[data-testid="room-code-input"]')).toBeVisible();
  // The sidebar shows the username.
  await expect(page.locator('[data-testid="current-user"]')).toContainText(name);
});

test("logging out redirects to /login", async ({ page }) => {
  const name = uniqueUsername("authuser");
  await page.goto("/signup");
  await fillSignupForm(page, name);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="room-code-input"]')).toBeVisible();

  await page.click('[data-testid="logout-button"]');
  await expect(page.locator("h2")).toContainText("login");
});

test("visiting / while logged out redirects to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h2")).toContainText("login");
});

test("can log in with an existing account", async ({ page }) => {
  const name = uniqueUsername("authuser");
  // First, create the account so the login form is exercised.
  await page.goto("/signup");
  await fillSignupForm(page, name);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="room-code-input"]')).toBeVisible();

  // Log out, then log back in.
  await page.click('[data-testid="logout-button"]');
  await expect(page.locator("h2")).toContainText("login");

  await fillLoginForm(page, name);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="room-code-input"]')).toBeVisible();
  await expect(page.locator('[data-testid="current-user"]')).toContainText(name);
});

test("duplicate username is rejected", async ({ page }) => {
  const name = uniqueUsername("authuser");
  // First signup succeeds.
  await page.goto("/signup");
  await fillSignupForm(page, name);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="room-code-input"]')).toBeVisible();

  // Log out and try the same username again.
  await page.click('[data-testid="logout-button"]');
  await page.goto("/signup");
  await fillSignupForm(page, name);
  await page.click('button[type="submit"]');

  await expect(page.locator("text=already taken")).toBeVisible();
});

test("wrong password is rejected", async ({ page }) => {
  const name = uniqueUsername("authuser");
  // Create the account.
  await page.goto("/signup");
  await fillSignupForm(page, name);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="room-code-input"]')).toBeVisible();

  // Log out, then attempt login with a wrong password.
  await page.click('[data-testid="logout-button"]');
  await expect(page.locator("h2")).toContainText("login");

  await fillLoginForm(page, name, "wrongpassword");
  await page.click('button[type="submit"]');

  await expect(page.locator("text=Invalid username or password")).toBeVisible();
});

test("signup shows a clear inline error for a short password", async ({ page }) => {
  const name = uniqueUsername("authuser");
  await page.goto("/signup");
  await page.fill('input[placeholder="user"]', name);
  await page.fill('input[placeholder="at least 8 chars"]', "short");
  await page.fill('input[placeholder="••••••••"]', "short");
  await page.click('button[type="submit"]');

  const err = page.locator('[data-testid="auth-error"]');
  await expect(err).toBeVisible();
  await expect(err).toContainText("at least 8 characters");
});

test("signup shows a friendly error for a non-JSON server response", async ({ page }) => {
  const name = uniqueUsername("authuser");

  // Simulate a proxy/hosting layer returning an HTML page with a 200 status —
  // this used to throw "Cannot read properties of null (reading 'user')".
  await page.route("**/api/signup", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html><body>gateway</body></html>",
    })
  );

  await page.goto("/signup");
  await fillSignupForm(page, name);
  await page.click('button[type="submit"]');

  const err = page.locator('[data-testid="auth-error"]');
  await expect(err).toBeVisible();
  await expect(err).toContainText("unexpected response");
});
