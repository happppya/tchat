import { expect, type Page } from "@playwright/test";
import sqlite3 from "sqlite3";

/** Password shared by all specs (the signup form requires 8+ chars). */
export const TEST_PASSWORD = "password123";

/** Monotonic room-code generator: back-to-back calls are always distinct. */
let idCounter = 0;
export function uniqueGcId(): string {
  idCounter += 1;
  return String((Date.now() % 900_000) + idCounter);
}

let userCounter = 0;
export function uniqueUsername(prefix = "tester"): string {
  return `${prefix}${Date.now()}_${userCounter++}`;
}

/** Navigate to the app root and clear localStorage (standard test setup). */
export async function resetApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
}

/** Fill the signup form (does not submit). */
export async function fillSignupForm(
  page: Page,
  username: string,
  password = TEST_PASSWORD
): Promise<void> {
  await page.fill('input[placeholder="user"]', username);
  await page.fill('input[placeholder="at least 8 chars"]', password);
  await page.fill('input[placeholder="••••••••"]', password);
}

/** Fill the login form (does not submit). */
export async function fillLoginForm(
  page: Page,
  username: string,
  password = TEST_PASSWORD
): Promise<void> {
  await page.fill('input[placeholder="user"]', username);
  await page.fill('input[placeholder="••••••••"]', password);
}

/** Sign up a fresh user and wait for the authenticated chat page.
 *
 * Uses `room-code-input` (visible to all users) as the readiness signal
 * instead of the admin-only `create-gc-toggle`.
 */
export async function signUp(
  page: Page,
  username?: string
): Promise<string> {
  const name = username ?? uniqueUsername();
  await page.goto("/signup");
  await fillSignupForm(page, name);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="room-code-input"]')).toBeVisible();
  return name;
}

/** Flip a user's is_admin flag directly in the test database.
 *
 * This mirrors the real-world operator workflow (UPDATE users SET is_admin=1)
 * and is the only way to make a test user an admin, since the UI exposes no
 * self-promotion path.
 */
export function promoteToAdmin(username: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database("test-database.db", (openErr) => {
      if (openErr) return reject(openErr);
      db.run(
        "UPDATE users SET is_admin = 1 WHERE username = ?",
        [username],
        (runErr) => {
          db.close();
          runErr ? reject(runErr) : resolve();
        }
      );
    });
  });
}

/** Sign up + promote to admin + reload so the session picks up is_admin.
 *
 * Use this in tests that need to create rooms, since the create-room UI is
 * only rendered for admin users.
 */
export async function signUpAdmin(
  page: Page,
  username?: string
): Promise<string> {
  const name = await signUp(page, username);
  await promoteToAdmin(name);
  await page.reload();
  await expect(page.locator('[data-testid="create-gc-toggle"]')).toBeVisible();
  return name;
}

/** Create a room through the sidebar form and wait for the chat surface. */
export async function createGroupChat(
  page: Page,
  id: string,
  name: string,
  isPublic?: boolean
): Promise<void> {
  await page.click('[data-testid="create-gc-toggle"]');
  await page.fill('[data-testid="create-gc-id"]', id);
  await page.fill('[data-testid="create-gc-name"]', name);
  if (isPublic) {
    // Click the "public" toggle button.
    await page.click('button:has-text("public")');
  }
  await page.click('[data-testid="create-gc-submit"]');
  await expect(page.locator('[data-testid="message-list"]')).toBeVisible();
}

/** Send a message and wait for its echo to render. */
export async function sendMessage(page: Page, text: string): Promise<void> {
  await page.fill('[data-testid="message-input"]', text);
  await page.press('[data-testid="message-input"]', "Enter");
  await expect(
    page.locator('[data-testid="message-bubble"]', { hasText: text })
  ).toBeVisible();
}
