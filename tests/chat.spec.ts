import { test, expect } from "@playwright/test";
import {
  uniqueGcId,
  resetApp,
  signUp,
  signUpAdmin,
  createGroupChat,
  sendMessage,
} from "./helpers";

/**
 * Full chat-flow tests.
 *
 * Each test creates its own unique group chat so the suite is independent of
 * database state left over from previous runs. The webServer in
 * playwright.config.ts builds the app and starts Express against a test DB, so
 * the production build (served from :3000) is exercised end-to-end.
 */

const UNIQUE_GC = uniqueGcId;

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

// ---------------------------------------------------------------------------
// 1. Creating a group chat
// ---------------------------------------------------------------------------
test("creates a group chat and shows it in the sidebar", async ({ page }) => {
  const id = UNIQUE_GC();
  const name = "Test Room";
  await signUpAdmin(page);

  await createGroupChat(page, id, name);

  // The chat window header should show the GC name.
  await expect(page.locator('[data-testid="message-list"]')).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toBeVisible();

  // The new GC should be listed in the sidebar.
  await expect(page.locator(`[data-testid="gc-button-${id}"]`)).toBeVisible();
  await expect(page.locator(`[data-testid="gc-button-${id}"]`)).toContainText(name);
});

// ---------------------------------------------------------------------------
// 2. Sending a message
// ---------------------------------------------------------------------------
test("sends a message and sees it appear at the bottom", async ({ page }) => {
  const id = UNIQUE_GC();
  const username = await signUpAdmin(page);
  await createGroupChat(page, id, "Send Room");

  await sendMessage(page, "Hello, world!");

  // Exactly one bubble, and it contains the sent text + the username (server
  // sets the display name from the authenticated session).
  await expect(page.locator('[data-testid="message-bubble"]')).toHaveCount(1);
  const bubble = page.locator('[data-testid="message-bubble"]');
  await expect(bubble).toContainText(username);
  await expect(bubble).toContainText("Hello, world!");
});

// ---------------------------------------------------------------------------
// 3. No duplicate messages per send
// ---------------------------------------------------------------------------
test("only one message appears per send (no duplicates)", async ({ page }) => {
  const id = UNIQUE_GC();
  await signUpAdmin(page);
  await createGroupChat(page, id, "NoDupe Room");

  await sendMessage(page, "Unique message");

  // Settle any extra broadcasts that a buggy client might emit.
  await page.waitForTimeout(600);

  await expect(page.locator('[data-testid="message-bubble"]')).toHaveCount(1);
});

// ---------------------------------------------------------------------------
// 4. Message ordering: oldest at top, newest at bottom — live and after refresh
// ---------------------------------------------------------------------------
test("messages are ordered oldest-first (top to bottom) live and after refresh", async ({
  page,
}) => {
  const id = UNIQUE_GC();
  await signUpAdmin(page);
  await createGroupChat(page, id, "Order Room");

  // Send three messages as the same user. They collapse into one group but
  // must still render oldest→newest, top→bottom.
  const texts = ["First message", "Second message", "Third message"];
  for (const text of texts) {
    await sendMessage(page, text);
    await page.waitForTimeout(150);
  }

  // One collapsed group (same author, within the gap window).
  await expect(page.locator('[data-testid="message-bubble"]')).toHaveCount(1);
  const group = page.locator('[data-testid="message-bubble"]');

  // Live: oldest at the top, newest at the bottom of the group.
  await expect(group).toContainText("First message");
  await expect(group).toContainText("Third message");

  // Reload. Pre-seed localStorage so the sidebar button exists immediately.
  await page.addInitScript(
    (gc) => {
      localStorage.setItem("savedGCList", JSON.stringify([{ id: Number(gc), name: "Order Room" }]));
    },
    id
  );
  await page.reload();
  await page.click(`[data-testid="gc-button-${id}"]`);
  await expect(page.locator('[data-testid="message-bubble"]')).toHaveCount(1);

  // After refresh: still oldest at top, newest at bottom.
  const refreshed = page.locator('[data-testid="message-bubble"]');
  await expect(refreshed).toContainText("First message");
  await expect(refreshed).toContainText("Second message");
  await expect(refreshed).toContainText("Third message");
});

// ---------------------------------------------------------------------------
// 5. Real-time updates across tabs
// ---------------------------------------------------------------------------
test("real-time: messages sent in one tab appear in another", async ({ browser }) => {
  // Two contexts + WS handshakes need a bit more headroom than the default 30s.
  test.setTimeout(60_000);
  const id = UNIQUE_GC();
  const name = "RT Room";

  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  try {
  // Alice creates the GC; Bob joins the same freshly-created GC. Each has
  // their own account/session.
  await signUpAdmin(alice);
  await createGroupChat(alice, id, name);

  // Seed Bob's localStorage BEFORE first navigation so the sidebar button is
  // present on initial render (the Sidebar only re-reads on focus).
  await bob.addInitScript(
    ({ gc, name }) => {
      localStorage.setItem("savedGCList", JSON.stringify([{ id: Number(gc), name }]));
    },
    { gc: id, name }
  );
  await signUp(bob);
  await bob.click(`[data-testid="gc-button-${id}"]`);
  await expect(bob.locator('[data-testid="message-list"]')).toBeVisible();

  // Alice sends a message; Bob should receive it in real time.
  await sendMessage(alice, "Hi Bob!");
  await expect(bob.locator('[data-testid="message-bubble"]')).toHaveCount(1, {
    timeout: 5_000,
  });
  await expect(bob.locator('[data-testid="message-bubble"]')).toContainText("Hi Bob!");

  // Bob replies; Alice should see it appended at the bottom.
  await sendMessage(bob, "Hey Alice!");
  await expect(alice.locator('[data-testid="message-bubble"]')).toHaveCount(2, {
    timeout: 5_000,
  });
  await expect(alice.locator('[data-testid="message-bubble"]').last()).toContainText(
    "Hey Alice!"
  );
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

// ---------------------------------------------------------------------------
// 6. Persistence: messages survive a full reload
// ---------------------------------------------------------------------------
test("messages persist across a page reload", async ({ page }) => {
  const id = UNIQUE_GC();
  await signUpAdmin(page);
  await createGroupChat(page, id, "Persist Room");
  await sendMessage(page, "persisted hello");

  await page.addInitScript(
    (gc) => {
      localStorage.setItem("savedGCList", JSON.stringify([{ id: Number(gc), name: "Persist Room" }]));
    },
    id
  );
  await page.reload();
  await page.click(`[data-testid="gc-button-${id}"]`);

  await expect(page.locator('[data-testid="message-bubble"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="message-bubble"]')).toContainText(
    "persisted hello"
  );
});

// ---------------------------------------------------------------------------
// 7. Duplicate room code is reported to the user
// ---------------------------------------------------------------------------
test("creating a room with an existing code shows an error", async ({ page }) => {
  const id = UNIQUE_GC();
  await signUpAdmin(page);
  await createGroupChat(page, id, "Original Room");

  // Try to create a second room with the same code.
  await page.click('[data-testid="create-gc-toggle"]');
  await page.fill('[data-testid="create-gc-id"]', id);
  await page.fill('[data-testid="create-gc-name"]', "Impostor Room");
  await page.click('[data-testid="create-gc-submit"]');

  await expect(page.locator('[data-testid="create-gc-error"]')).toContainText(
    "already exists"
  );
});

// ---------------------------------------------------------------------------
// 8. Room codes have a max length
// ---------------------------------------------------------------------------
test("room code input is capped at 6 digits", async ({ page }) => {
  await signUpAdmin(page);
  await page.click('[data-testid="create-gc-toggle"]');
  await page.fill('[data-testid="create-gc-id"]', "123456789");

  await expect(page.locator('[data-testid="create-gc-id"]')).toHaveValue("123456");
});

// ---------------------------------------------------------------------------
// 9. Room owner can delete the room
// ---------------------------------------------------------------------------
test("room owner can delete the room", async ({ page }) => {
  const id = UNIQUE_GC();
  await signUpAdmin(page);
  await createGroupChat(page, id, "Doomed Room");

  await expect(page.locator('[data-testid="delete-room-button"]')).toBeVisible();

  page.on("dialog", (d) => d.accept());
  await page.click('[data-testid="delete-room-button"]');

  await expect(page.locator('[data-testid="delete-room-button"]')).toHaveCount(0);
  await expect(page.getByText("no channel selected")).toBeVisible();
  await expect(page.locator(`[data-testid="gc-button-${id}"]`)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 10. Non-owners cannot delete a room
// ---------------------------------------------------------------------------
test("a non-owner cannot delete a room", async ({ browser }) => {
  const id = UNIQUE_GC();
  const ownerContext = await browser.newContext();
  const joinerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const joiner = await joinerContext.newPage();

  try {
    await signUpAdmin(owner);
    await createGroupChat(owner, id, "Shared Room");

    await signUp(joiner);
    await joiner.fill('[data-testid="room-code-input"]', id);
    await joiner.press('[data-testid="room-code-input"]', "Enter");
    await expect(joiner.locator('[data-testid="message-list"]')).toBeVisible();

    await expect(joiner.locator('[data-testid="delete-room-button"]')).toHaveCount(0);
  } finally {
    await ownerContext.close();
    await joinerContext.close();
  }
});

// ---------------------------------------------------------------------------
// 11. Leaving a room
// ---------------------------------------------------------------------------
test("a user can leave a room", async ({ page }) => {
  const id = UNIQUE_GC();
  await signUpAdmin(page);
  await createGroupChat(page, id, "Temporary Room");

  await expect(page.locator('[data-testid="leave-room-button"]')).toBeVisible();

  page.on("dialog", (d) => d.accept());
  await page.click('[data-testid="leave-room-button"]');

  await expect(page.getByText("no channel selected")).toBeVisible();
  await expect(page.locator(`[data-testid="gc-button-${id}"]`)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 12. Leaving only removes the current user's membership
// ---------------------------------------------------------------------------
test("leaving a room keeps other members in it", async ({ browser }) => {
  const id = UNIQUE_GC();
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  try {
    await signUpAdmin(alice);
    await createGroupChat(alice, id, "Shared Room");

    await signUp(bob);
    await bob.fill('[data-testid="room-code-input"]', id);
    await bob.press('[data-testid="room-code-input"]', "Enter");
    await expect(bob.locator('[data-testid="message-list"]')).toBeVisible();

    bob.on("dialog", (d) => d.accept());
    await bob.click('[data-testid="leave-room-button"]');
    await expect(bob.getByText("no channel selected")).toBeVisible();

    // Alice's room is untouched and still usable.
    await sendMessage(alice, "still here");
    await expect(alice.locator('[data-testid="message-bubble"]')).toHaveCount(1);
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

// ---------------------------------------------------------------------------
// 13. Permanent user data: rooms load on a fresh device
// ---------------------------------------------------------------------------
test("rooms load from the server on a fresh device", async ({ browser }) => {
  const username = `syncuser${Date.now()}`;
  const id = UNIQUE_GC();

  const ctx1 = await browser.newContext();
  const ctx2 = await browser.newContext();
  const device1 = await ctx1.newPage();
  const device2 = await ctx2.newPage();

  try {
    await signUpAdmin(device1, username);
    await createGroupChat(device1, id, "Cloud Room");

    // Same account, different context (no localStorage): log in and expect the
    // room to be listed from the server-side membership.
    await device2.goto("/login");
    await device2.fill('input[placeholder="user"]', username);
    await device2.fill('input[placeholder="••••••••"]', "password123");
    await device2.click('button[type="submit"]');
    await expect(device2.locator('[data-testid="room-code-input"]')).toBeVisible();

    await expect(device2.locator(`[data-testid="gc-button-${id}"]`)).toBeVisible();
  } finally {
    await ctx1.close();
    await ctx2.close();
  }
});

// ---------------------------------------------------------------------------
// 14. Empty rooms are automatically deleted
// ---------------------------------------------------------------------------
test("empty rooms are automatically deleted", async ({ page }) => {
  const id = UNIQUE_GC();
  await signUpAdmin(page);
  await createGroupChat(page, id, "Ephemeral Room");

  page.on("dialog", (d) => d.accept());
  await page.click('[data-testid="leave-room-button"]');
  await expect(page.getByText("no channel selected")).toBeVisible();

  // Room now has no members; the cleanup job deletes it after the TTL.
  await page.waitForTimeout(3500);

  await page.fill('[data-testid="room-code-input"]', id);
  await page.press('[data-testid="room-code-input"]', "Enter");
  // Joining now fails because the room no longer exists on the server; the
  // join error is surfaced in the no-channel pane.
  await expect(page.getByText("Room not found")).toBeVisible();
});
