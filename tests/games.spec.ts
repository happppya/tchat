import { test, expect, type Browser, type Page } from "@playwright/test";
import {
  uniqueGcId,
  resetApp,
  signUp,
  signUpAdmin,
  createGroupChat,
} from "./helpers";

/**
 * Game invitation card + overlay (Phase 1 spec §2/§3).
 *
 * Flow covered:
 *   - the game button in the composer opens a dropdown of available games;
 *   - picking one drops an invitation card (rendered from the server's
 *     `gameState` broadcast) into the chat for everyone in the room, and the
 *     creator's lobby overlay opens;
 *   - another room member clicks the invitation to join the lobby;
 *   - the host starts the game, flipping everyone's overlay to "In Progress";
 *   - closing the overlay returns to chat (the invitation stays);
 *   - clicking the invitation again rejoins the same in-progress game.
 */

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test("invitation card and overlay: lobby → start → close → rejoin", async ({
  browser,
}) => {
  // Alice creates the room (as owner/admin) in her own session.
  const alice = await freshPage(browser);
  const id = uniqueGcId();
  await signUpAdmin(alice);
  await createGroupChat(alice, id, "Game Room");

  // Bob signs up in a second session and joins the room by code.
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await resetApp(bob);
  await signUp(bob);
  await bob.fill('[data-testid="room-code-input"]', id);
  await bob.press('[data-testid="room-code-input"]', "Enter");
  await expect(bob.locator('[data-testid="message-list"]')).toBeVisible();
  await expect(bob.locator('[data-testid="room-header-name"]')).toContainText(
    "Game Room"
  );

  // Alice picks a game from the composer dropdown; her lobby opens.
  await alice.click('[data-testid="game-button"]');
  await expect(alice.locator('[data-testid="game-dropdown"]')).toBeVisible();
  await alice.click('[data-testid="game-option-impostor"]');
  await expect(alice.locator('[data-testid="game-overlay"]')).toBeVisible();
  await expect(alice.locator('[data-testid="game-overlay"]')).toContainText(
    "Impostor"
  );

  // Bob sees the invitation card and clicks it to join the lobby.
  await expect(bob.locator('[data-testid="game-invitation"]')).toBeVisible();
  await bob.click('[data-testid="game-invitation"]');
  await expect(bob.locator('[data-testid="game-overlay"]')).toBeVisible();

  // Both lobbies list the two participants.
  await expect(
    alice.locator('[data-testid="game-participant"]')
  ).toHaveCount(2);
  await expect(bob.locator('[data-testid="game-participant"]')).toHaveCount(2);

  // The host starts the game; everyone's overlay flips to "In Progress".
  await alice.click('[data-testid="game-start-button"]');
  await expect(alice.locator('[data-testid="game-status"]')).toHaveText(
    "In Progress"
  );
  await expect(bob.locator('[data-testid="game-status"]')).toHaveText(
    "In Progress"
  );

  // Alice closes the overlay: back to chat, invitation card still there.
  await alice.click('[data-testid="game-overlay-close"]');
  await expect(alice.locator('[data-testid="game-overlay"]')).toHaveCount(0);
  await expect(alice.locator('[data-testid="game-invitation"]')).toBeVisible();

  // Clicking the invitation again rejoins the same in-progress game.
  await alice.click('[data-testid="game-invitation"]');
  await expect(alice.locator('[data-testid="game-overlay"]')).toBeVisible();
  await expect(alice.locator('[data-testid="game-status"]')).toHaveText(
    "In Progress"
  );

  await alice.close();
  await bobCtx.close();
});

/** A dedicated page in a dedicated context (separate auth session). */
async function freshPage(browser: Browser): Promise<Page> {
  const page = await browser.newContext().then((ctx) => ctx.newPage());
  return page;
}