import { test, expect } from "@playwright/test";
import { uniqueGcId, resetApp, signUpAdmin, createGroupChat } from "./helpers";

/**
 * Message pagination: the server pages with a (sent_at, id) cursor (no
 * OFFSET), and the client opens on the newest page then loads older pages as
 * the user scrolls up.
 */

const UNIQUE_GC = uniqueGcId;

/**
 * Bulk-send messages through a second WebSocket in the page, waiting until the
 * server has echoed all of them back (so we know they were persisted).
 */
async function bulkSend(
  page: import("@playwright/test").Page,
  groupChatId: string,
  count: number
) {
  await page.evaluate(
    async ({ groupChatId, count }) => {
      const ws = new WebSocket(`ws://${location.host}/ws`);
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error("ws connect failed"));
      });

      const echoed = new Promise<void>((resolve) => {
        let received = 0;
        ws.onmessage = () => {
          received += 1;
          if (received >= count) {
            ws.close();
            resolve();
          }
        };
      });

      for (let i = 0; i < count; i++) {
        ws.send(
          JSON.stringify({
            type: "message",
            groupChatId,
            messageText: `bulk ${i}`,
          })
        );
      }

      await Promise.race([
        echoed,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("bulk send timed out")), 10000)
        ),
      ]);
    },
    { groupChatId: Number(groupChatId), count }
  );
}

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test("getMessages pages backward with a cursor, without overlap or gaps", async ({
  page,
}) => {
  const id = UNIQUE_GC();
  await signUpAdmin(page);
  await createGroupChat(page, id, "Paging Room");
  await bulkSend(page, id, 7);

  const seen = new Set<number>();
  let previousOldestId = Number.POSITIVE_INFINITY;
  let before: { sent_at: string; id: number } | null = null;
  let total = 0;

  // Walk the whole history 3 messages at a time.
  for (let i = 0; i < 5; i++) {
    const q = new URLSearchParams({ groupChatId: id, limit: "3" });
    if (before) {
      q.set("beforeSentAt", before.sent_at);
      q.set("beforeId", String(before.id));
    }
    const res = await page.request.get(`/api/getMessages?${q.toString()}`);
    expect(res.ok()).toBe(true);
    const msgs = await res.json();

    if (msgs.length === 0) break;

    // Newest-first within the page and strictly older than the prior page.
    for (let j = 0; j < msgs.length; j++) {
      expect(msgs[j].id).toBeLessThan(previousOldestId);
      expect(seen.has(msgs[j].id)).toBe(false);
      seen.add(msgs[j].id);
      previousOldestId = msgs[j].id;
    }

    total += msgs.length;
    before = { sent_at: msgs[msgs.length - 1].sent_at, id: msgs[msgs.length - 1].id };
  }

  expect(total).toBe(7);
  expect(seen.size).toBe(7);
});

test("chat opens on the newest page and scroll-up loads older messages", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const id = UNIQUE_GC();
  await signUpAdmin(page);
  await createGroupChat(page, id, "Big Room");
  await bulkSend(page, id, 60);

  // Reopen the room fresh: only the most recent page is loaded.
  await page.reload();
  await expect(page.locator('[data-testid="room-code-input"]')).toBeVisible();
  await page.click(`[data-testid="gc-button-${id}"]`);
  await expect(page.locator('[data-testid="message-list"]')).toBeVisible();
  await expect(page.locator('[data-testid="message-count"]')).toContainText(
    "50 msgs"
  );

  // Scroll to the top to request the previous page.
  await page.evaluate(() => {
    const list = document.querySelector('[data-testid="message-list"]');
    if (!(list instanceof HTMLElement)) throw new Error("message list missing");
    list.scrollTop = 0;
    list.dispatchEvent(new Event("scroll"));
  });

  await expect(page.locator('[data-testid="message-count"]')).toContainText(
    "60 msgs"
  );
});
