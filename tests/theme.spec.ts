import { test, expect } from "@playwright/test";

/**
 * Theme switching via the command palette.
 *
 * Verifies that selecting a theme changes the CSS variables applied to the
 * document root (guards against the regression where themes were applied via
 * an injected <style> tag whose :root rule lost to Tailwind layering; they're
 * now applied as inline styles on <html>).
 */

const UNIQUE_GC = () => String(Date.now() % 1_000_000);

const BACKTICK = String.fromCharCode(96); // avoid a literal backtick in source

async function openPalette(page: import("@playwright/test").Page) {
  // The backtick listener lives on ChatPage, which only mounts after the
  // initial /api/me check resolves. Wait for a chat-page landmark so we don't
  // press backtick while AuthLoading is shown (listener not attached yet).
  await expect(
    page.locator('[data-testid="create-gc-toggle"]')
  ).toBeVisible();
  // The palette opens on the backtick key when no input is focused.
  await page.keyboard.press(BACKTICK);
  const palette = page.locator('[data-testid=command-palette]');
  await expect(palette).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

/** Helper: sign up a new user (server sets a session cookie). */
let userCounter = 0;
async function signUp(page: import("@playwright/test").Page) {
  const name = `tester${Date.now()}_${userCounter++}`;
  await page.goto("/signup");
  await page.fill('input[placeholder="user"]', name);
  await page.fill('input[placeholder="at least 8 chars"]', "password123");
  await page.fill('input[placeholder="••••••••"]', "password123");
  await page.click('button[type="submit"]');
  // Wait for the chat page to mount (the signup response sets the session
  // cookie + the app redirects to "/"). Without this, a reload fired too
  // soon can beat the cookie landing, leaving /api/me returning 401 after
  // reload and the chat page never mounting.
  await expect(
    page.locator('[data-testid="create-gc-toggle"]').first()
  ).toBeVisible();
  return name;
}

test("switching to the Cyberpunk theme changes the accent CSS variable", async ({
  page,
}) => {
  // Clear any previously stored theme so we start from the default (Dawn).
  await page.evaluate(() => localStorage.removeItem("chat-theme-id"));
  await page.reload();

  // Create a GC so the chat surface is visible (background uses theme vars).
  await signUp(page);
  await page.click('[data-testid="create-gc-toggle"]');
  await page.fill('[data-testid="create-gc-id"]', UNIQUE_GC());
  await page.fill('[data-testid="create-gc-name"]', "Theme Room");
  await page.click('[data-testid="create-gc-submit"]');
  await expect(page.locator('[data-testid="message-list"]')).toBeVisible();

  // Capture the default accent.
  const beforeAccent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
  );
  expect(beforeAccent.length).toBeGreaterThan(0);

  // Open the palette and switch to Cyberpunk.
  await openPalette(page);
  await page.fill('[data-testid="palette-search"]', "cyberpunk");
  await page.keyboard.press("Enter");

  // The palette closes after running an action.
  const palette1 = page.locator('[data-testid=command-palette]');
  await expect(palette1).toBeHidden();

  // The accent variable on <html> should now be the Cyberpunk cyan.
  const afterAccent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
  );
  expect(afterAccent.toLowerCase()).toBe("#00f0ff");

  // It should differ from the default.
  expect(afterAccent.toLowerCase()).not.toBe(beforeAccent.toLowerCase());
});

test("theme persists across a page reload", async ({ page }) => {
  await signUp(page);
  await page.evaluate(() => localStorage.removeItem("chat-theme-id"));
  await page.reload();
  // openPalette() itself waits for the chat page to finish booting (the
  // backtick listener is attached by ChatPage's useEffect, which only runs
  // after the auth check resolves).
  await openPalette(page);
  await page.fill('[data-testid="palette-search"]', "amber");
  await page.keyboard.press("Enter");
  const palette2 = page.locator('[data-testid=command-palette]');
  await expect(palette2).toBeHidden();

  const amber = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
  );
  expect(amber.toLowerCase()).toBe("#ffb000");

  // Reload — the stored theme should be reapplied on load.
  await page.reload();
  const afterReload = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
  );
  expect(afterReload.toLowerCase()).toBe("#ffb000");
});
