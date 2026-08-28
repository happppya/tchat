import { test, expect } from "@playwright/test";
import { uniqueGcId, resetApp, signUpAdmin, createGroupChat } from "./helpers";

/**
 * Message length limit (250 chars) and word wrapping: long unbroken runs
 * (URLs, keysmash) must wrap at the container edge instead of pushing the
 * chat horizontally — the bug that only showed on narrower windows.
 */

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test("composer truncates input at 250 characters", async ({ page }) => {
  await signUpAdmin(page);
  await createGroupChat(page, uniqueGcId(), "Limit Room");

  const input = page.locator('[data-testid="message-input"]');
  await expect(input).toHaveAttribute("maxlength", "250");

  // Typing past the cap is truncated by the textarea's maxlength.
  await input.pressSequentially("z".repeat(260));
  expect(await input.inputValue()).toHaveLength(250);
});

test("a 250-char run without spaces wraps instead of overflowing", async ({
  page,
}) => {
  await signUpAdmin(page);
  await createGroupChat(page, uniqueGcId(), "Wrap Room");

  const run = "w".repeat(250);
  await page.fill('[data-testid="message-input"]', run);
  await page.press('[data-testid="message-input"]', "Enter");

  const bubble = page.locator('[data-testid="message-bubble"]');
  await expect(bubble).toBeVisible();

  // The scroll container must not gain a horizontal scrollbar, and the
  // message body must occupy more than one line (i.e. it wrapped).
  const metrics = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="message-list"]');
    const md = document.querySelector(".md-body");
    if (!list || !md) return null;
    return {
      hOverflow: list.scrollWidth - list.clientWidth,
      bodyHeight: md.clientHeight,
    };
  });
  expect(metrics).not.toBeNull();
  // Unwrapped, 250 chars is thousands of px wide; wrapping keeps it at the
  // container width (a few px of rounding/scrollbar slack is fine).
  expect(metrics!.hOverflow).toBeLessThanOrEqual(20);
  // A single line of text-sm/leading-relaxed is ~23px; wrapped text is 2+ lines.
  expect(metrics!.bodyHeight).toBeGreaterThan(30);
});
