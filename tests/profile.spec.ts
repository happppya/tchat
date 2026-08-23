import { test, expect } from "@playwright/test";
import { uniqueGcId, resetApp, signUp, signUpAdmin, createGroupChat } from "./helpers";

/**
 * Profile flow tests: editing your own bio/picture, avatars in chat, and
 * viewing another user's profile by clicking their message.
 */

const UNIQUE_GC = uniqueGcId;
const PICTURE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3Crect width='10' height='10' fill='red'/%3E%3C/svg%3E";

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test("a user can edit and persist their own profile", async ({ page }) => {
  const username = await signUp(page);

  // Profile edit doesn't need admin; room-code-input is enough.
  await expect(page.locator('[data-testid="room-code-input"]')).toBeVisible();

  // Open edit mode from the sidebar.
  await page.click('[data-testid="profile-button"]');
  await expect(page.locator('[data-testid="profile-modal"]')).toBeVisible();
  await expect(page.locator('[data-testid="profile-username"]')).toHaveText(
    username
  );

  await page.fill('[data-testid="profile-bio-input"]', "hello, I am a test bot");
  await page.fill('[data-testid="profile-picture-input"]', PICTURE);
  await page.click('[data-testid="profile-save-button"]');

  // Back in view mode, the saved bio + picture are shown.
  await expect(page.locator('[data-testid="profile-bio"]')).toContainText(
    "hello, I am a test bot"
  );
  await expect(
    page.locator('[data-testid="profile-modal"] [data-testid="avatar-image"]')
  ).toHaveAttribute("src", PICTURE);

  // Reload and reopen — the values should have been persisted server-side.
  await page.reload();
  await expect(page.locator('[data-testid="room-code-input"]')).toBeVisible();
  await page.click('[data-testid="profile-button"]');
  await expect(page.locator('[data-testid="profile-bio-input"]')).toHaveValue(
    "hello, I am a test bot"
  );
  await expect(
    page.locator('[data-testid="profile-picture-input"]')
  ).toHaveValue(PICTURE);
});

test("profile pictures appear in chat and profiles are viewable", async ({
  browser,
}) => {
  const id = UNIQUE_GC();
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  try {
    // Alice sets a bio + picture, then creates a room and says hello.
    const aliceName = await signUpAdmin(alice);
    await alice.click('[data-testid="profile-button"]');
    await alice.fill('[data-testid="profile-bio-input"]', "alice bio");
    await alice.fill('[data-testid="profile-picture-input"]', PICTURE);
    await alice.click('[data-testid="profile-save-button"]');
    await alice.click('[data-testid="profile-close-button"]');

    await createGroupChat(alice, id, "Profile Room");
    await alice.fill('[data-testid="message-input"]', "hello from alice");
    await alice.press('[data-testid="message-input"]', "Enter");
    await expect(
      alice.locator('[data-testid="message-bubble"]', { hasText: "hello from alice" })
    ).toBeVisible();

    // Bob joins and sees Alice's avatar on her message.
    await signUp(bob);
    await bob.fill('[data-testid="room-code-input"]', id);
    await bob.press('[data-testid="room-code-input"]', "Enter");
    await expect(bob.locator('[data-testid="message-list"]')).toBeVisible();
    await expect(
      bob.locator('[data-testid="message-bubble"]', { hasText: "hello from alice" })
    ).toBeVisible();

    const avatar = bob
      .locator('[data-testid="message-bubble"] [data-testid="avatar-image"]')
      .first();
    await expect(avatar).toHaveAttribute("src", PICTURE);

    // Clicking Alice's name opens a context menu; click "view profile".
    await bob
      .locator('[data-testid="message-author"]', { hasText: aliceName })
      .click();
    await bob.locator('button', { hasText: "view profile" }).click();
    await expect(bob.locator('[data-testid="profile-modal"]')).toBeVisible();
    await expect(bob.locator('[data-testid="profile-username"]')).toHaveText(
      aliceName
    );
    await expect(bob.locator('[data-testid="profile-bio"]')).toContainText(
      "alice bio"
    );
    // Bob is viewing someone else, so there's no edit button.
    await expect(bob.locator('[data-testid="profile-edit-button"]')).toHaveCount(
      0
    );
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});
