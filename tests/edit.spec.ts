import { test, expect } from "@playwright/test";
import {
  uniqueGcId,
  resetApp,
  signUp,
  createGroupChat,
  sendMessage,
} from "./helpers";

/**
 * Message ownership tests: users can edit/delete their own messages, edits are
 * marked "(edited)", and other users get no controls (and are rejected by the
 * API).
 */

const UNIQUE_GC = uniqueGcId;

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test("a user can edit their own message and sees (edited)", async ({ page }) => {
  const id = UNIQUE_GC();
  await signUp(page);
  await createGroupChat(page, id, "Edit Room");
  await sendMessage(page, "original text");

  const bubble = page.locator('[data-testid="message-bubble"]');
  await bubble.locator('[data-testid="edit-message-button"]').click();

  const input = bubble.locator('[data-testid="edit-message-input"]');
  await expect(input).toBeVisible();
  await input.fill("edited text");
  await bubble.locator('[data-testid="edit-message-save"]').click();

  await expect(bubble).toContainText("edited text");
  await expect(bubble.locator('[data-testid="edited-marker"]')).toBeVisible();

  // Persisted: reload, reopen, still edited.
  await page.addInitScript(
    (gc) => {
      localStorage.setItem(
        "savedGCList",
        JSON.stringify([{ id: Number(gc), name: "Edit Room" }])
      );
    },
    id
  );
  await page.reload();
  await page.click(`[data-testid="gc-button-${id}"]`);
  await expect(
    page.locator('[data-testid="message-bubble"]', { hasText: "edited text" })
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="message-bubble"] [data-testid="edited-marker"]')
  ).toBeVisible();
});

test("a user can delete their own message", async ({ page }) => {
  const id = UNIQUE_GC();
  await signUp(page);
  await createGroupChat(page, id, "Delete Room");
  await sendMessage(page, "delete me");

  page.on("dialog", (d) => d.accept());
  await page
    .locator('[data-testid="message-bubble"] [data-testid="delete-message-button"]')
    .click();

  await expect(
    page.locator('[data-testid="message-bubble"]', { hasText: "delete me" })
  ).toHaveCount(0);
  await expect(page.locator('[data-testid="message-bubble"]')).toHaveCount(0);
});

test("a non-owner cannot edit or delete someone else's message", async ({
  browser,
}) => {
  const id = UNIQUE_GC();
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  try {
    await signUp(alice);
    await createGroupChat(alice, id, "Owned Room");
    await sendMessage(alice, "alice's message");

    await signUp(bob);
    await bob.fill('[data-testid="room-code-input"]', id);
    await bob.press('[data-testid="room-code-input"]', "Enter");
    await expect(
      bob.locator('[data-testid="message-bubble"]', { hasText: "alice's message" })
    ).toBeVisible();

    // Bob sees Alice's message but no edit/delete controls.
    const bubble = bob.locator('[data-testid="message-bubble"]');
    await expect(bubble.locator('[data-testid="edit-message-button"]')).toHaveCount(0);
    await expect(bubble.locator('[data-testid="delete-message-button"]')).toHaveCount(0);

    // The API also rejects Bob: fetch the message id and try to delete it.
    const res = await bob.request.get(
      `/api/getMessages?groupChatId=${id}&limit=50`
    );
    const msgs = await res.json();
    const target = msgs.find((m: { message_text: string | null }) =>
      (m.message_text || "").includes("alice's message")
    );
    expect(target).toBeTruthy();

    const del = await bob.request.delete("/api/deleteMessage", {
      data: { messageId: target.id },
    });
    expect(del.status()).toBe(403);

    const edit = await bob.request.put("/api/editMessage", {
      data: { messageId: target.id, messageText: "hijacked" },
    });
    expect(edit.status()).toBe(403);
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});
