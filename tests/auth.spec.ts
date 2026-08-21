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

  // Should land on the chat page (create-gc toggle is visible when authed).
  await expect(page.locator('[data-testid="create-gc-toggle"]')).toBeVisible();
  // The sidebar shows the username.
  await expect(page.locator('[data-testid="current-user"]')).toContainText(name);
});

test("logging out redirects to /login", async ({ page }) => {
  const name = uniqueUsername("authuser");
  await page.goto("/signup");
  await fillSignupForm(page, name);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="create-gc-toggle"]')).toBeVisible();

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
  await expect(page.locator('[data-testid="create-gc-toggle"]')).toBeVisible();

  // Log out, then log back in.
  await page.click('[data-testid="logout-button"]');
  await expect(page.locator("h2")).toContainText("login");

  await fillLoginForm(page, name);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="create-gc-toggle"]')).toBeVisible();
  await expect(page.locator('[data-testid="current-user"]')).toContainText(name);
});

test("duplicate username is rejected", async ({ page }) => {
  const name = uniqueUsername("authuser");
  // First signup succeeds.
  await page.goto("/signup");
  await fillSignupForm(page, name);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="create-gc-toggle"]')).toBeVisible();

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
  await expect(page.locator('[data-testid="create-gc-toggle"]')).toBeVisible();

  // Log out, then attempt login with a wrong password.
  await page.click('[data-testid="logout-button"]');
  await expect(page.locator("h2")).toContainText("login");

  await fillLoginForm(page, name, "wrongpassword");
  await page.click('button[type="submit"]');

  await expect(page.locator("text=Invalid username or password")).toBeVisible();
});
