import { test, expect } from "@playwright/test";

/**
 * Profile flow tests: editing your own bio/picture, avatars in chat, and
 * viewing another user's profile by clicking their message.
 */

const UNIQUE_GC = () => String(Date.now() % 1_000_000);
const PICTURE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10'%3E%3Crect width='10' height='10' fill='red'/%3E%3C/svg%3E";

let userCounter = 0;
async function signUp(page: import("@playwright/test").Page, username?: string) {
  const name = username ?? `profiler${Date.now()}_${userCounter++}`;
  await page.goto("/signup");
  await page.fill('input[placeholder="user"]', name);
  await page.fill('input[placeholder="at least 8 chars"]', "password123");
  await page.fill('input[placeholder="••••••••"]', "password123");
  await page.click('button[type="submit"]');
  await expect(
    page.locator('[data-testid="create-gc-toggle"]').first()
  ).toBeVisible();
  return name;
}

async function createGroupChat(
  page: import("@playwright/test").Page,
  id: string,
  name: string
) {
  await page.click('[data-testid="create-gc-toggle"]');
  await page.fill('[data-testid="create-gc-id"]', id);
  await page.fill('[data-testid="create-gc-name"]', name);
  await page.click('[data-testid="create-gc-submit"]');
  await expect(page.locator('[data-testid="message-list"]')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test("a user can edit and persist their own profile", async ({ page }) => {
  const username = await signUp(page);

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
  await expect(page.locator('[data-testid="create-gc-toggle"]')).toBeVisible();
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
    const aliceName = await signUp(alice);
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

    // Clicking Alice's name opens her public profile.
    await bob
      .locator('[data-testid="message-author"]', { hasText: aliceName })
      .click();
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
