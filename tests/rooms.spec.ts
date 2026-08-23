import { test, expect } from "@playwright/test";
import { uniqueGcId, resetApp, signUp, signUpAdmin, createGroupChat } from "./helpers";

/**
 * Room visibility tests: public rooms are discoverable in the rooms tab and
 * joinable there; private rooms are not listed.
 */

const UNIQUE_GC = uniqueGcId;

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test("public rooms are listed in the rooms tab; private rooms are not", async ({
  page,
}) => {
  const privId = UNIQUE_GC();
  const pubId = UNIQUE_GC();
  await signUpAdmin(page);

  await createGroupChat(page, privId, "Private Room");
  await createGroupChat(page, pubId, "Public Room", true);

  await page.click('[data-testid="tab-board"]');

  await expect(page.locator(`[data-testid="public-room-${pubId}"]`)).toBeVisible();
  await expect(
    page.locator(`[data-testid="public-room-${pubId}"]`)
  ).toContainText("Public Room");
  await expect(page.locator(`[data-testid="public-room-${privId}"]`)).toHaveCount(0);
});

test("a user can join a public room from the rooms tab", async ({ browser }) => {
  const pubId = UNIQUE_GC();
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alice = await aliceContext.newPage();
  const bob = await bobContext.newPage();

  try {
    await signUpAdmin(alice);
    await createGroupChat(alice, pubId, "Discoverable Room", true);

    await signUp(bob);
    await bob.click('[data-testid="tab-board"]');
    await expect(bob.locator(`[data-testid="public-room-${pubId}"]`)).toBeVisible();

    await bob.click(`[data-testid="public-room-${pubId}"]`);
    await expect(bob.locator('[data-testid="message-list"]')).toBeVisible();
    await expect(bob.getByText("Discoverable Room", { exact: true })).toBeVisible();
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});
