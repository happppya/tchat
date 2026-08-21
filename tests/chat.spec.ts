import { test, expect } from "@playwright/test";

/**
 * Full chat-flow tests.
 *
 * Each test creates its own unique group chat so the suite is independent of
 * database state left over from previous runs. The webServer in
 * playwright.config.ts builds the app and starts Express against a test DB, so
 * the production build (served from :3000) is exercised end-to-end.
 */

const UNIQUE_GC = () => String(Date.now() % 1_000_000);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  // Clear localStorage so the sidebar starts fresh each test.
  await page.evaluate(() => localStorage.clear());
});

/** Helper: open the create-GC form, fill id + name, submit, wait for chat. */
async function createGroupChat(page: import("@playwright/test").Page, id: string, name: string) {
  await page.click('[data-testid="create-gc-toggle"]');
  await page.fill('[data-testid="create-gc-id"]', id);
  await page.fill('[data-testid="create-gc-name"]', name);
  await page.click('[data-testid="create-gc-submit"]');
  await expect(page.locator('[data-testid="message-list"]')).toBeVisible();
}

/** Helper: set a display name and send one message, waiting for the echo. */
async function sendMessage(page: import("@playwright/test").Page, displayName: string, text: string) {
  await page.fill('[data-testid="display-name-input"]', displayName);
  await page.fill('[data-testid="message-input"]', text);
  await page.press('[data-testid="message-input"]', "Enter");
  // Wait for the single new bubble (WebSocket broadcast echoes back to sender).
  await expect(
    page.locator('[data-testid="message-bubble"]', { hasText: text })
  ).toBeVisible();
}

// ---------------------------------------------------------------------------
// 1. Creating a group chat
// ---------------------------------------------------------------------------
test("creates a group chat and shows it in the sidebar", async ({ page }) => {
  const id = UNIQUE_GC();
  const name = "Test Room";

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
  await createGroupChat(page, id, "Send Room");

  await sendMessage(page, "Alice", "Hello, world!");

  // Exactly one bubble, and it contains the sent text + display name.
  await expect(page.locator('[data-testid="message-bubble"]')).toHaveCount(1);
  const bubble = page.locator('[data-testid="message-bubble"]');
  await expect(bubble).toContainText("Alice:");
  await expect(bubble).toContainText("Hello, world!");
});

// ---------------------------------------------------------------------------
// 3. No duplicate messages per send
// ---------------------------------------------------------------------------
test("only one message appears per send (no duplicates)", async ({ page }) => {
  const id = UNIQUE_GC();
  await createGroupChat(page, id, "NoDupe Room");

  await sendMessage(page, "Tester", "Unique message");

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
  await createGroupChat(page, id, "Order Room");

  const texts = ["First message", "Second message", "Third message"];
  for (const text of texts) {
    await sendMessage(page, "Alice", text);
    // Brief pause so timestamps don't collide on a second boundary.
    await page.waitForTimeout(150);
  }

  await expect(page.locator('[data-testid="message-bubble"]')).toHaveCount(3);

  // Live: newest at the bottom.
  const liveBubbles = page.locator('[data-testid="message-bubble"]');
  await expect(liveBubbles.nth(0)).toContainText("First message");
  await expect(liveBubbles.nth(2)).toContainText("Third message");

  // Reload. Pre-seed localStorage so the sidebar button exists immediately.
  await page.addInitScript(
    (gc) => {
      localStorage.setItem("savedGCList", JSON.stringify([{ id: Number(gc), name: "Order Room" }]));
    },
    id
  );
  await page.reload();
  await page.click(`[data-testid="gc-button-${id}"]`);
  await expect(page.locator('[data-testid="message-bubble"]')).toHaveCount(3);

  // After refresh: still oldest at top, newest at bottom.
  const refreshedBubbles = page.locator('[data-testid="message-bubble"]');
  await expect(refreshedBubbles.nth(0)).toContainText("First message");
  await expect(refreshedBubbles.nth(1)).toContainText("Second message");
  await expect(refreshedBubbles.nth(2)).toContainText("Third message");
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
    // Alice creates the GC; Bob joins the same freshly-created GC.
    await alice.goto("/");
    await alice.evaluate(() => localStorage.clear());
    await createGroupChat(alice, id, name);

    // Seed Bob's localStorage BEFORE first navigation so the sidebar button is
    // present on initial render (the Sidebar only re-reads on focus).
    await bob.addInitScript(
      ({ gc, name }) => {
        localStorage.setItem("savedGCList", JSON.stringify([{ id: Number(gc), name }]));
      },
      { gc: id, name }
    );
    await bob.goto("/");
    await bob.click(`[data-testid="gc-button-${id}"]`);
    await expect(bob.locator('[data-testid="message-list"]')).toBeVisible();

    // Alice sends a message; Bob should receive it in real time.
    await sendMessage(alice, "Alice", "Hi Bob!");
    await expect(bob.locator('[data-testid="message-bubble"]')).toHaveCount(1, {
      timeout: 5_000,
    });
    await expect(bob.locator('[data-testid="message-bubble"]')).toContainText("Hi Bob!");

    // Bob replies; Alice should see it appended at the bottom.
    await sendMessage(bob, "Bob", "Hey Alice!");
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
  await createGroupChat(page, id, "Persist Room");
  await sendMessage(page, "Alice", "persisted hello");

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
