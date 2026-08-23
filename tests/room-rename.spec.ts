import { test, expect } from "@playwright/test";
import {
  resetApp,
  uniqueGcId,
  signUp,
  signUpAdmin,
} from "./helpers";

/**
 * Room rename + room-type tag specs.
 *
 * Creating rooms requires a site admin, and the only way to become one is a
 * direct DB write (the same way a real operator promotes users). These tests
 * sign up a user, flip `is_admin` in ./test-database.db (the path the test
 * server uses), and reload — the account is then admin for the rest of the
 * test.
 */

/** Create an anonymous + public room through the admin form. */
async function createAnonPublicRoom(
  page: Page,
  id: string,
  name: string
): Promise<void> {
  await page.click('[data-testid="create-gc-toggle"]');
  await page.fill('[data-testid="create-gc-id"]', id);
  await page.fill('[data-testid="create-gc-name"]', name);
  await page.click('button:has-text("anonymous")');
  await page.click('button:has-text("public")');
  await page.click('[data-testid="create-gc-submit"]');
  await expect(page.locator('[data-testid="message-list"]')).toBeVisible();
}

test("board rooms show shorthand type tags; the chat header shows the full names", async ({
  page,
}) => {
  await resetApp(page);
  await signUpAdmin(page);
  const roomId = uniqueGcId();

  await createAnonPublicRoom(page, roomId, "Whisper Room");

  // Board tab: the row carries [A] + [P] shorthands, not emojis.
  await page.click('[data-testid="tab-board"]');
  const row = page.locator(`[data-testid="public-room-${roomId}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("[A]");
  await expect(row).toContainText("[P]");
  await expect(row).not.toContainText("👤");

  // Open the room: the header shows the full type names.
  await row.click();
  await expect(page.locator('[data-testid="message-list"]')).toBeVisible();
  await expect(page.getByText("anonymous", { exact: true })).toBeVisible();
  await expect(page.getByText("public", { exact: true })).toBeVisible();
  await expect(page.getByTestId("room-header-name")).toHaveText("Whisper Room");
});

test("an admin can rename a room from the sidebar and every client sees it", async ({
  browser,
}) => {
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  const roomId = uniqueGcId();

  try {
    await resetApp(admin);
    await signUpAdmin(admin);
    await createAnonPublicRoom(admin, roomId, "Old Name");

    // Second user opens the room and sees the original name.
    await resetApp(bob);
    await signUp(bob);
    await bob.click('[data-testid="tab-board"]');
    const bobRow = bob.locator(`[data-testid="public-room-${roomId}"]`);
    await expect(bobRow).toBeVisible();
    await bobRow.click();
    await expect(bob.locator('[data-testid="message-list"]')).toBeVisible();
    await expect(bob.getByTestId("room-header-name")).toHaveText("Old Name");

    // Admin renames the room from the sidebar.
    await admin.click('[data-testid="tab-myrooms"]');
    const adminRow = admin.locator(`[data-testid="gc-button-${roomId}"]`);
    await adminRow.hover();
    await admin.click(`[data-testid="rename-room-${roomId}"]`);
    await admin.fill(`[data-testid="rename-room-input-${roomId}"]`, "New Name");
    await admin.press(`[data-testid="rename-room-input-${roomId}"]`, "Enter");

    // Admin's sidebar updates.
    await expect
      .poll(async () => (await adminRow.textContent()) ?? "")
      .toContain("New Name");

    // Bob's open chat header updates live via WebSocket.
    await expect(bob.getByTestId("room-header-name")).toHaveText("New Name");

    // Bob's board list updates too.
    await bob.click('[data-testid="tab-board"]');
    await expect
      .poll(async () => (await bobRow.textContent()) ?? "")
      .toContain("New Name");
  } finally {
    await adminContext.close();
    await bobContext.close();
  }
});

test("a non-owner sees no rename button on their saved rooms", async ({
  page,
}) => {
  await resetApp(page);
  await signUp(page);
  // Seed a room that isn't owned by this user (server /myRooms only has Lobby).
  await page.evaluate(() => {
    localStorage.setItem(
      "savedGCList",
      JSON.stringify([{ id: 111, name: "Room One" }])
    );
  });
  await page.reload();
  await expect(page.locator('[data-testid="gc-button-111"]')).toBeVisible();

  await page.hover('[data-testid="gc-button-111"]');
  await expect(page.locator('[data-testid="rename-room-111"]')).toHaveCount(0);
  // The remove button still exists for everyone on the my rooms tab.
  await expect(page.locator('[data-testid="remove-room-111"]')).toBeVisible();
});

test("double-clicking a room does not close the sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 });
  await resetApp(page);
  await signUp(page);

  const sidebar = page.locator(".term-panel");
  await expect(sidebar).toBeVisible();

  await page.locator('[data-testid="gc-button-0"]').dblclick();
  await expect(page.locator('[data-testid="message-list"]')).toBeVisible();

  // The sidebar must still be open after a double-click.
  await expect(sidebar).toBeVisible();
  await expect(page.locator("button:has-text('☰')")).toHaveCount(0);
});