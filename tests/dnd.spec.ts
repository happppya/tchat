import { test, expect } from "@playwright/test";
import { resetApp, uniqueUsername, TEST_PASSWORD } from "./helpers";

/**
 * Sidebar drag-and-drop regression tests (my rooms tab — available to every
 * user, not just admins):
 *  - dragging a room onto a group header moves it into the group
 *  - dragging a room onto another room reorders them
 *  - dragging a grouped room onto a top-level room moves it out of the group
 *  - right-click no longer deletes rooms; a hover delete button does
 */

/** Sign up a regular (non-admin) user and wait for the authenticated UI. */
async function signupRegularUser(page: import("@playwright/test").Page) {
  await page.goto("/signup");
  await page.fill('input[placeholder="user"]', uniqueUsername());
  await page.fill('input[placeholder="at least 8 chars"]', TEST_PASSWORD);
  await page.fill('input[placeholder="••••••••"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-testid="room-code-input"]')).toBeVisible();
}

/**
 * Seed three rooms + one group (containing room 333), reload, and wait for the
 * mount-time server merge (which prepends the Lobby room to the saved list) to
 * settle so it can't overwrite a reorder made later in the test.
 */
async function seedRoomsAndGroups(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    localStorage.setItem(
      "savedGCList",
      JSON.stringify([
        { id: 111, name: "Room One" },
        { id: 222, name: "Room Two" },
        { id: 333, name: "Room Three" },
      ])
    );
    localStorage.setItem(
      "tchat:local-groups",
      JSON.stringify([{ id: "g1", name: "Group 1", roomIds: [333] }])
    );
  });
  await page.reload();
  await expect(page.locator('[data-testid="gc-button-0"]')).toBeVisible();
  await expect(page.locator('[data-testid="gc-button-111"]')).toBeVisible();
}

const readGroups = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("tchat:local-groups") ?? "[]")
  );

const readSavedGCs = (page: import("@playwright/test").Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("savedGCList") ?? "[]")
  );

const savedIndex = (list: Array<{ id: number }>, id: number) =>
  list.findIndex((g) => g.id === id);

test("dragging a room onto a group header adds it to the group", async ({
  page,
}) => {
  await resetApp(page);
  await signupRegularUser(page);
  await seedRoomsAndGroups(page);

  await page
    .locator('[data-testid="gc-button-111"]')
    .dragTo(page.getByText("Group 1", { exact: true }));

  await expect
    .poll(async () => (await readGroups(page))[0]?.roomIds ?? [])
    .toContain(111);
});

test("dragging a top-level room onto another reorders them", async ({
  page,
}) => {
  await resetApp(page);
  await signupRegularUser(page);
  await seedRoomsAndGroups(page);

  // Drag room 222 onto room 111 → 222 moves above 111.
  await page
    .locator('[data-testid="gc-button-222"]')
    .dragTo(page.locator('[data-testid="gc-button-111"]'));

  await expect
    .poll(async () => {
      const list = await readSavedGCs(page);
      return savedIndex(list, 222) < savedIndex(list, 111);
    })
    .toBe(true);
});

test("dragging a room onto another in the same group reorders within the group", async ({
  page,
}) => {
  await resetApp(page);
  await signupRegularUser(page);
  await seedRoomsAndGroups(page);

  // Put 111 into the group first (group becomes [333, 111]).
  await page
    .locator('[data-testid="gc-button-111"]')
    .dragTo(page.getByText("Group 1", { exact: true }));
  await expect
    .poll(async () => (await readGroups(page))[0]?.roomIds ?? [])
    .toContain(111);

  // Drag 111 onto 333 within the group → [111, 333].
  await page
    .locator('[data-testid="gc-button-111"]')
    .dragTo(page.locator('[data-testid="gc-button-333"]'));

  await expect
    .poll(async () => (await readGroups(page))[0]?.roomIds ?? [])
    .toEqual([111, 333]);
});

test("dragging a grouped room onto a top-level room moves it out of the group", async ({
  page,
}) => {
  await resetApp(page);
  await signupRegularUser(page);
  await seedRoomsAndGroups(page);

  // Room 333 starts inside the group; drag it onto top-level room 222.
  await page
    .locator('[data-testid="gc-button-333"]')
    .dragTo(page.locator('[data-testid="gc-button-222"]'));

  await expect
    .poll(async () => (await readGroups(page))[0]?.roomIds ?? [])
    .not.toContain(333);
});

test("right-clicking a room no longer removes it", async ({ page }) => {
  await resetApp(page);
  await signupRegularUser(page);
  await seedRoomsAndGroups(page);

  await page.locator('[data-testid="gc-button-111"]').click({ button: "right" });

  const list = await readSavedGCs(page);
  expect(list.some((g) => g.id === 111)).toBe(true);
});

test("hovering a room reveals a delete button that removes it", async ({
  page,
}) => {
  await resetApp(page);
  await signupRegularUser(page);
  await seedRoomsAndGroups(page);

  await page.hover('[data-testid="gc-button-111"]');
  await page.click('[data-testid="remove-room-111"]');

  await expect
    .poll(async () => (await readSavedGCs(page)).some((g) => g.id === 111))
    .toBe(false);
});
