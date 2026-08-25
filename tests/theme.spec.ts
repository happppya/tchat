import { test, expect } from "@playwright/test";
import { uniqueGcId, resetApp, signUpAdmin } from "./helpers";

/**
 * Theme switching via the command palette.
 *
 * Verifies that selecting a theme changes the CSS variables applied to the
 * document root (guards against the regression where themes were applied via
 * an injected <style> tag whose :root rule lost to Tailwind layering; they're
 * now applied as inline styles on <html>). Also covers the dark/light mode
 * toggle: light has as many themes as dark, switching to light applies the
 * default light theme, and the two modes remember their own selections.
 */

const UNIQUE_GC = uniqueGcId;

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
  await resetApp(page);
});

test("switching to the Cyberpunk theme changes the accent CSS variable", async ({
  page,
}) => {
  // Clear any previously stored theme so we start from the default (Dawn).
  await page.evaluate(() => localStorage.removeItem("chat-theme-id"));
  await page.reload();

  // Create a GC so the chat surface is visible (background uses theme vars).
  await signUpAdmin(page);
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

  // Open the palette and choose "Choose theme" to open the theme picker overlay.
  await openPalette(page);
  await page.fill('[data-testid="palette-search"]', "choose theme");
  await page.keyboard.press("Enter");

  // The palette closes; click the Cyberpunk theme card in the overlay.
  await page.click('[data-testid="theme-option-cyberpunk"]');

  // Click the "close" button or backdrop to dismiss.
  await page.click('text=close');

  // The accent variable on <html> should now be the new Cyberpunk teal.
  const afterAccent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
  );
  expect(afterAccent.toLowerCase()).toBe("#6ec6ca");

  // It should differ from the default.
  expect(afterAccent.toLowerCase()).not.toBe(beforeAccent.toLowerCase());
});

test("theme persists across a page reload", async ({ page }) => {
  await signUpAdmin(page);
  await page.evaluate(() => localStorage.removeItem("chat-theme-id"));
  await page.reload();
  // openPalette() itself waits for the chat page to finish booting (the
  // backtick listener is attached by ChatPage's useEffect, which only runs
  // after the auth check resolves).
  await openPalette(page);
  await page.fill('[data-testid="palette-search"]', "choose theme");
  await page.keyboard.press("Enter");

  // Switch to Amber via the overlay.
  await page.click('[data-testid="theme-option-amber"]');
  await page.click('text=close');

  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
  );
  expect(accent.toLowerCase()).toBe("#c4956a");

  // Reload — the stored theme should be reapplied on load.
  await page.reload();
  const afterReload = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
  );
  expect(afterReload.toLowerCase()).toBe("#c4956a");
});

test("dark/light toggle: equal counts, light defaults to Sunrise, modes remember their picks", async ({
  page,
}) => {
  const getAccent = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()
    );

  await signUpAdmin(page);
  await page.evaluate(() => localStorage.removeItem("chat-theme-id"));
  await page.reload();
  await openPalette(page);
  await page.fill('[data-testid="palette-search"]', "choose theme");
  await page.keyboard.press("Enter");

  // Pick a dark theme first so we can prove each mode remembers its own pick.
  await page.click('[data-testid="theme-option-cyberpunk"]');
  const darkCount = await page.locator('[data-testid^="theme-option-"]').count();
  expect(darkCount).toBeGreaterThan(0);

  // Switching to light applies the default light theme (Sunrise) and shows
  // the same number of options as dark.
  await page.click('[data-testid="theme-mode-light"]');
  const lightCount = await page.locator('[data-testid^="theme-option-"]').count();
  expect(lightCount).toBe(darkCount);
  expect((await getAccent()).toLowerCase()).toBe("#e2713b"); // Sunrise

  // Pick a light theme explicitly, then flip back and forth: each mode
  // restores the theme last chosen in it (Cyberpunk dark, Sky light).
  await page.click('[data-testid="theme-option-sky"]');
  await page.click('[data-testid="theme-mode-dark"]');
  expect((await getAccent()).toLowerCase()).toBe("#6ec6ca"); // Cyberpunk
  await page.click('[data-testid="theme-mode-light"]');
  expect((await getAccent()).toLowerCase()).toBe("#2f8fc1"); // Sky

  // The light selection survives a reload.
  await page.click('text=close');
  await page.reload();
  expect((await getAccent()).toLowerCase()).toBe("#2f8fc1");

  // And the dark selection is still remembered after reload too.
  await openPalette(page);
  await page.fill('[data-testid="palette-search"]', "choose theme");
  await page.keyboard.press("Enter");
  await page.click('[data-testid="theme-mode-dark"]');
  await page.click('text=close');
  expect((await getAccent()).toLowerCase()).toBe("#6ec6ca"); // Cyberpunk
});
