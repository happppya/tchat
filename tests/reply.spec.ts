import { test, expect } from "@playwright/test";
import {
  uniqueGcId,
  resetApp,
  signUp,
  createGroupChat,
  sendMessage,
} from "./helpers";

/**
 * Reply + reaction tests: replying quotes the target message, and emoji
 * reactions toggle on/off.
 */

const UNIQUE_GC = uniqueGcId;

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test("replying to a message shows a quote", async ({ page }) => {
  const id = UNIQUE_GC();
  await signUp(page);
  await createGroupChat(page, id, "Reply Room");
  await sendMessage(page, "original message");

  await page
    .locator('[data-testid="message-bubble"] [data-testid="reply-message-button"]')
    .click();
  await expect(page.locator('[data-testid="reply-preview"]')).toContainText(
    "original message"
  );

  await page.fill('[data-testid="message-input"]', "my reply");
  await page.press('[data-testid="message-input"]', "Enter");

  const bubble = page.locator('[data-testid="message-bubble"]');
  await expect(bubble).toContainText("my reply");
  await expect(bubble.locator('[data-testid="message-reply"]')).toContainText(
    "original message"
  );

  // The quote is denormalized on the row so it survives reloads.
  const res = await page.request.get(
    `/api/getMessages?groupChatId=${id}&limit=50`
  );
  const msgs = await res.json();
  const reply = msgs.find(
    (m: { message_text: string | null }) => m.message_text === "my reply"
  );
  expect(reply).toBeTruthy();
  expect(reply.reply_quote).toBe("original message");
  expect(reply.reply_author).toBeTruthy();
});

test("reacting to a message toggles an emoji", async ({ page }) => {
  const id = UNIQUE_GC();
  await signUp(page);
  await createGroupChat(page, id, "React Room");
  await sendMessage(page, "react to me");

  const bubble = page.locator('[data-testid="message-bubble"]');
  await bubble.locator('[data-testid="react-message-button"]').click();
  await bubble.locator('[data-emoji="👍"]').click();

  const chip = bubble.locator('[data-testid="reaction-chip"]');
  await expect(chip).toContainText("👍");
  await expect(chip).toContainText("1");

  // Clicking the chip again removes your reaction.
  await chip.click();
  await expect(bubble.locator('[data-testid="reaction-chip"]')).toHaveCount(0);
});

test("message actions are hidden until you hover the message", async ({ page }) => {
  const id = UNIQUE_GC();
  await signUp(page);
  await createGroupChat(page, id, "Hover Room");
  await sendMessage(page, "hover target");

  const line = page.locator('[data-testid="message-line"]').first();
  const actions = line.locator('[data-testid="message-actions"]');

  // Hidden by default (opacity 0), even though the buttons are in the DOM.
  await expect(actions).toHaveCSS("opacity", "0");

  await line.hover();
  await expect(actions).toHaveCSS("opacity", "1");
});

test("hovering an action icon shows its tooltip", async ({ page }) => {
  const id = UNIQUE_GC();
  await signUp(page);
  await createGroupChat(page, id, "Tooltip Room");
  await sendMessage(page, "tooltip target");

  const line = page.locator('[data-testid="message-line"]').first();
  await line.hover();

  const replyBtn = line.locator('[data-testid="reply-message-button"]');
  const tooltip = replyBtn.locator('[data-testid="action-tooltip"]');

  await expect(tooltip).toHaveCSS("opacity", "0");
  await replyBtn.hover();
  await expect(tooltip).toHaveCSS("opacity", "1");
  await expect(tooltip).toHaveText("reply");
});
