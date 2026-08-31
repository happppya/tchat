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

  // Carol signs up in a third session and joins the room by code.
  const carolCtx = await browser.newContext();
  const carol = await carolCtx.newPage();
  await resetApp(carol);
  await signUp(carol);
  await carol.fill('[data-testid="room-code-input"]', id);
  await carol.press('[data-testid="room-code-input"]', "Enter");
  await expect(carol.locator('[data-testid="message-list"]')).toBeVisible();

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

  // Carol also joins the lobby.
  await expect(carol.locator('[data-testid="game-invitation"]')).toBeVisible();
  await carol.click('[data-testid="game-invitation"]');
  await expect(carol.locator('[data-testid="game-overlay"]')).toBeVisible();

  // All lobbies list the three participants.
  await expect(
    alice.locator('[data-testid="game-participant"]')
  ).toHaveCount(3);
  await expect(bob.locator('[data-testid="game-participant"]')).toHaveCount(3);
  await expect(carol.locator('[data-testid="game-participant"]')).toHaveCount(3);

  // The host starts the game; everyone's overlay flips to "In Progress".
  await alice.click('[data-testid="game-start-button"]');
  await expect(alice.locator('[data-testid="game-status"]')).toHaveText(
    "In Progress"
  );
  await expect(bob.locator('[data-testid="game-status"]')).toHaveText(
    "In Progress"
  );
  await expect(carol.locator('[data-testid="game-status"]')).toHaveText(
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
  await carolCtx.close();
});

/**
 * Impostor max-rounds enforcement (I-2): when the host sets maxRounds=1 and
 * everyone chooses "continue" after the hint phase, the server ends the game
 * as a tie — the invitation card disappears and the overlay closes.
 */
test("impostor: max rounds enforced — game ends as tie at the round cap", async ({
  browser,
}) => {
  const alice = await freshPage(browser);
  const id = uniqueGcId();
  await signUpAdmin(alice);
  await createGroupChat(alice, id, "Game Room");

  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await resetApp(bob);
  await signUp(bob);
  await bob.fill('[data-testid="room-code-input"]', id);
  await bob.press('[data-testid="room-code-input"]', "Enter");
  await expect(bob.locator('[data-testid="room-header-name"]')).toContainText(
    "Game Room"
  );

  const carolCtx = await browser.newContext();
  const carol = await carolCtx.newPage();
  await resetApp(carol);
  await signUp(carol);
  await carol.fill('[data-testid="room-code-input"]', id);
  await carol.press('[data-testid="room-code-input"]', "Enter");
  await expect(carol.locator('[data-testid="room-header-name"]')).toContainText(
    "Game Room"
  );

  // Alice creates the game; both bob and carol join the lobby.
  await alice.click('[data-testid="game-button"]');
  await alice.click('[data-testid="game-option-impostor"]');
  await expect(alice.locator('[data-testid="game-overlay"]')).toBeVisible();
  await bob.click('[data-testid="game-invitation"]');
  await expect(bob.locator('[data-testid="game-overlay"]')).toBeVisible();
  await carol.click('[data-testid="game-invitation"]');
  await expect(carol.locator('[data-testid="game-overlay"]')).toBeVisible();

  // Alice (host) sets maxRounds=1 and starts the game.
  await alice.fill('[data-testid="set-maxRounds"]', "1");
  await alice.click('[data-testid="game-start-button"]');
  await expect(alice.locator('[data-testid="game-status"]')).toHaveText(
    "In Progress"
  );
  await expect(bob.locator('[data-testid="game-status"]')).toHaveText(
    "In Progress"
  );
  await expect(carol.locator('[data-testid="game-status"]')).toHaveText(
    "In Progress"
  );

  // Hint phase: dismiss role reveals, then each player submits a hint on
  // their turn. The turn order is shuffled; only the turn player sees the
  // hint input.
  for (const page of [alice, bob, carol]) {
    await expect(page.locator('[data-testid="impostor-role-reveal"]')).toBeVisible({
      timeout: 10_000,
    });
    await page.click('[data-testid="impostor-role-reveal-dismiss"]');
  }
  const pages = [alice, bob, carol];
  for (let i = 0; i < 3; i++) {
    // Wait until exactly one page shows the hint input.
    await expect(async () => {
      const visible = await Promise.all(
        pages.map((p) => p.locator('[data-testid="impostor-hint-input"]').isVisible())
      );
      expect(visible.filter(Boolean)).toHaveLength(1);
    }).toPass({ timeout: 10_000 });
    // Find and use the page with the visible input.
    for (const p of pages) {
      if (await p.locator('[data-testid="impostor-hint-input"]').isVisible()) {
        await p.fill('[data-testid="impostor-hint-input"]', "a clue");
        await p.click('[data-testid="impostor-hint-submit"]');
        break;
      }
    }
  }

  // Choose phase: all three choose continue.
  for (const page of [alice, bob, carol]) {
    await expect(page.locator('[data-testid="impostor-choose-continue"]')).toBeVisible({
      timeout: 10_000,
    });
    await page.click('[data-testid="impostor-choose-continue"]');
  }

  // Max rounds (1) reached + everyone continued → game ends as a tie.
  // The server sends gameEnded; the overlay stays open showing the result
  // ("Game Over" status) until the player manually closes it.
  await expect(alice.locator('[data-testid="game-status"]')).toHaveText(
    "Game Over",
    { timeout: 10_000 }
  );
  await expect(bob.locator('[data-testid="game-status"]')).toHaveText(
    "Game Over",
    { timeout: 10_000 }
  );
  await expect(carol.locator('[data-testid="game-status"]')).toHaveText(
    "Game Over",
    { timeout: 10_000 }
  );
  // The invitation card is removed (game is over).
  await expect(alice.locator('[data-testid="game-invitation"]')).toHaveCount(0);
  await expect(bob.locator('[data-testid="game-invitation"]')).toHaveCount(0);
  // Closing the overlay dismisses the result.
  await alice.click('[data-testid="game-overlay-close"]');
  await expect(alice.locator('[data-testid="game-overlay"]')).toHaveCount(0);

  await alice.close();
  await bobCtx.close();
  await carolCtx.close();
});

/**
 * Minigames require at least 3 players to start. With only 2 players in the
 * lobby, the host's Start button should fail with an error and the game
 * stays in the lobby.
 */
test("impostor: rejects starting with fewer than 3 players", async ({
  browser,
}) => {
  const alice = await freshPage(browser);
  const id = uniqueGcId();
  await signUpAdmin(alice);
  await createGroupChat(alice, id, "Game Room");

  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await resetApp(bob);
  await signUp(bob);
  await bob.fill('[data-testid="room-code-input"]', id);
  await bob.press('[data-testid="room-code-input"]', "Enter");
  await expect(bob.locator('[data-testid="room-header-name"]')).toContainText(
    "Game Room"
  );

  // Alice creates the game; bob joins the lobby (only 2 players).
  await alice.click('[data-testid="game-button"]');
  await alice.click('[data-testid="game-option-impostor"]');
  await expect(alice.locator('[data-testid="game-overlay"]')).toBeVisible();
  await bob.click('[data-testid="game-invitation"]');
  await expect(bob.locator('[data-testid="game-overlay"]')).toBeVisible();

  // Host tries to start; the server rejects it (min 3 players).
  await alice.click('[data-testid="game-start-button"]');

  // The game stays in the lobby (not "In Progress").
  await expect(alice.locator('[data-testid="game-status"]')).toHaveText(
    "Lobby"
  );

  await alice.close();
  await bobCtx.close();
});

/** A dedicated page in a dedicated context (separate auth session). */
async function freshPage(browser: Browser): Promise<Page> {
  const page = await browser.newContext().then((ctx) => ctx.newPage());
  return page;
}