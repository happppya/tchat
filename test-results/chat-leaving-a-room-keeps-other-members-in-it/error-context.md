# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat.spec.ts >> leaving a room keeps other members in it
- Location: tests\chat.spec.ts:293:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: locator('[data-testid="create-gc-toggle"]').first()
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for locator('[data-testid="create-gc-toggle"]').first()

```

```yaml
- heading "tchat signup" [level=2]
- text: create a new account
- alert: Can't reach the server. Check your connection and try again.
- text: username
- textbox "user": tester1787362857129_0
- text: password
- textbox "at least 8 chars": password123
- text: confirm
- textbox "••••••••": password123
- button "[ register ]"
- paragraph:
  - text: already have an account?
  - link "log in":
    - /url: /login
```

# Test source

```ts
  1  | import { expect, type Page } from "@playwright/test";
  2  | 
  3  | /** Password shared by all specs (the signup form requires 8+ chars). */
  4  | export const TEST_PASSWORD = "password123";
  5  | 
  6  | /** Monotonic room-code generator: back-to-back calls are always distinct. */
  7  | let idCounter = 0;
  8  | export function uniqueGcId(): string {
  9  |   idCounter += 1;
  10 |   return String((Date.now() % 900_000) + idCounter);
  11 | }
  12 | 
  13 | let userCounter = 0;
  14 | export function uniqueUsername(prefix = "tester"): string {
  15 |   return `${prefix}${Date.now()}_${userCounter++}`;
  16 | }
  17 | 
  18 | /** Navigate to the app root and clear localStorage (standard test setup). */
  19 | export async function resetApp(page: Page): Promise<void> {
  20 |   await page.goto("/");
  21 |   await page.evaluate(() => localStorage.clear());
  22 | }
  23 | 
  24 | /** Fill the signup form (does not submit). */
  25 | export async function fillSignupForm(
  26 |   page: Page,
  27 |   username: string,
  28 |   password = TEST_PASSWORD
  29 | ): Promise<void> {
  30 |   await page.fill('input[placeholder="user"]', username);
  31 |   await page.fill('input[placeholder="at least 8 chars"]', password);
  32 |   await page.fill('input[placeholder="••••••••"]', password);
  33 | }
  34 | 
  35 | /** Fill the login form (does not submit). */
  36 | export async function fillLoginForm(
  37 |   page: Page,
  38 |   username: string,
  39 |   password = TEST_PASSWORD
  40 | ): Promise<void> {
  41 |   await page.fill('input[placeholder="user"]', username);
  42 |   await page.fill('input[placeholder="••••••••"]', password);
  43 | }
  44 | 
  45 | /** Sign up a fresh user and wait for the authenticated chat page. */
  46 | export async function signUp(
  47 |   page: Page,
  48 |   username?: string
  49 | ): Promise<string> {
  50 |   const name = username ?? uniqueUsername();
  51 |   await page.goto("/signup");
  52 |   await fillSignupForm(page, name);
  53 |   await page.click('button[type="submit"]');
  54 |   await expect(
  55 |     page.locator('[data-testid="create-gc-toggle"]').first()
> 56 |   ).toBeVisible();
     |     ^ Error: expect(locator).toBeVisible() failed
  57 |   return name;
  58 | }
  59 | 
  60 | /** Create a room through the sidebar form and wait for the chat surface. */
  61 | export async function createGroupChat(
  62 |   page: Page,
  63 |   id: string,
  64 |   name: string,
  65 |   isPublic = false
  66 | ): Promise<void> {
  67 |   await page.click('[data-testid="create-gc-toggle"]');
  68 |   await page.fill('[data-testid="create-gc-id"]', id);
  69 |   await page.fill('[data-testid="create-gc-name"]', name);
  70 |   if (isPublic) {
  71 |     await page.click('[data-testid="visibility-public"]');
  72 |   }
  73 |   await page.click('[data-testid="create-gc-submit"]');
  74 |   await expect(page.locator('[data-testid="message-list"]')).toBeVisible();
  75 | }
  76 | 
  77 | /** Send a message and wait for its echo to render. */
  78 | export async function sendMessage(page: Page, text: string): Promise<void> {
  79 |   await page.fill('[data-testid="message-input"]', text);
  80 |   await page.press('[data-testid="message-input"]', "Enter");
  81 |   await expect(
  82 |     page.locator('[data-testid="message-bubble"]', { hasText: text })
  83 |   ).toBeVisible();
  84 | }
  85 | 
```