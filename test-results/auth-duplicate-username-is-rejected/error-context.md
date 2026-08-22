# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> duplicate username is rejected
- Location: tests\auth.spec.ts:64:5

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.fill: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('input[placeholder="user"]')

```

# Page snapshot

```yaml
- generic [ref=f2e3]:
  - generic [ref=f2e4]:
    - generic [ref=f2e5]:
      - heading "tchat" [level=1] [ref=f2e6]
      - text: v1.0.0
    - button "new channel" [ref=f2e8] [cursor=pointer]
    - generic [ref=f2e10]:
      - generic [ref=f2e11]: join room
      - spinbutton "code (1–6 digits)" [ref=f2e12]
    - generic [ref=f2e13]:
      - button "channels" [ref=f2e14] [cursor=pointer]
      - button "rooms" [ref=f2e15] [cursor=pointer]
    - list [ref=f2e16]:
      - listitem [ref=f2e17]: $ no channels joined
    - generic [ref=f2e18]:
      - button "authuser1787362793607_3" [ref=f2e19] [cursor=pointer]
      - button "[ logout ]" [ref=f2e21] [cursor=pointer]
  - generic [ref=f2e22]:
    - generic [ref=f2e23]:
      - generic [ref=f2e24]: tchat
      - generic [ref=f2e25]: —
      - generic [ref=f2e26]: no channel selected
    - generic [ref=f2e27]:
      - generic [ref=f2e28]: press
      - generic [ref=f2e29]: "`"
      - generic [ref=f2e30]: for commands · select a channel to begin
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
> 30 |   await page.fill('input[placeholder="user"]', username);
     |              ^ Error: page.fill: Test timeout of 30000ms exceeded.
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
  56 |   ).toBeVisible();
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