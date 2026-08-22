# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat.spec.ts >> real-time: messages sent in one tab appear in another
- Location: tests\chat.spec.ts:125:5

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  locator('[data-testid="message-bubble"]')
Expected: 1
Received: 0
Timeout:  5000ms

Call log:
  - Expect "toHaveCount" with timeout 5000ms
  - waiting for locator('[data-testid="message-bubble"]')
    14 × locator resolved to 0 elements
       - unexpected value "0"

```

# Page snapshot

```yaml
- generic [ref=e4]:
  - generic [ref=e5]:
    - heading "tchat login" [level=2] [ref=e6]
    - text: authenticate to continue
  - generic [ref=e7]: username
  - textbox "user" [ref=e8]
  - generic [ref=e9]: password
  - textbox "••••••••" [ref=e10]
  - button "[ authenticate ]" [ref=e11] [cursor=pointer]
  - paragraph [ref=e12]:
    - text: no account?
    - link "sign up" [ref=e13] [cursor=pointer]:
      - /url: /signup
```

# Test source

```ts
  56  |   await expect(page.locator('[data-testid="message-bubble"]')).toHaveCount(1);
  57  |   const bubble = page.locator('[data-testid="message-bubble"]');
  58  |   await expect(bubble).toContainText(username);
  59  |   await expect(bubble).toContainText("Hello, world!");
  60  | });
  61  | 
  62  | // ---------------------------------------------------------------------------
  63  | // 3. No duplicate messages per send
  64  | // ---------------------------------------------------------------------------
  65  | test("only one message appears per send (no duplicates)", async ({ page }) => {
  66  |   const id = UNIQUE_GC();
  67  |   await signUp(page);
  68  |   await createGroupChat(page, id, "NoDupe Room");
  69  | 
  70  |   await sendMessage(page, "Unique message");
  71  | 
  72  |   // Settle any extra broadcasts that a buggy client might emit.
  73  |   await page.waitForTimeout(600);
  74  | 
  75  |   await expect(page.locator('[data-testid="message-bubble"]')).toHaveCount(1);
  76  | });
  77  | 
  78  | // ---------------------------------------------------------------------------
  79  | // 4. Message ordering: oldest at top, newest at bottom — live and after refresh
  80  | // ---------------------------------------------------------------------------
  81  | test("messages are ordered oldest-first (top to bottom) live and after refresh", async ({
  82  |   page,
  83  | }) => {
  84  |   const id = UNIQUE_GC();
  85  |   await signUp(page);
  86  |   await createGroupChat(page, id, "Order Room");
  87  | 
  88  |   // Send three messages as the same user. They collapse into one group but
  89  |   // must still render oldest→newest, top→bottom.
  90  |   const texts = ["First message", "Second message", "Third message"];
  91  |   for (const text of texts) {
  92  |     await sendMessage(page, text);
  93  |     await page.waitForTimeout(150);
  94  |   }
  95  | 
  96  |   // One collapsed group (same author, within the gap window).
  97  |   await expect(page.locator('[data-testid="message-bubble"]')).toHaveCount(1);
  98  |   const group = page.locator('[data-testid="message-bubble"]');
  99  | 
  100 |   // Live: oldest at the top, newest at the bottom of the group.
  101 |   await expect(group).toContainText("First message");
  102 |   await expect(group).toContainText("Third message");
  103 | 
  104 |   // Reload. Pre-seed localStorage so the sidebar button exists immediately.
  105 |   await page.addInitScript(
  106 |     (gc) => {
  107 |       localStorage.setItem("savedGCList", JSON.stringify([{ id: Number(gc), name: "Order Room" }]));
  108 |     },
  109 |     id
  110 |   );
  111 |   await page.reload();
  112 |   await page.click(`[data-testid="gc-button-${id}"]`);
  113 |   await expect(page.locator('[data-testid="message-bubble"]')).toHaveCount(1);
  114 | 
  115 |   // After refresh: still oldest at top, newest at bottom.
  116 |   const refreshed = page.locator('[data-testid="message-bubble"]');
  117 |   await expect(refreshed).toContainText("First message");
  118 |   await expect(refreshed).toContainText("Second message");
  119 |   await expect(refreshed).toContainText("Third message");
  120 | });
  121 | 
  122 | // ---------------------------------------------------------------------------
  123 | // 5. Real-time updates across tabs
  124 | // ---------------------------------------------------------------------------
  125 | test("real-time: messages sent in one tab appear in another", async ({ browser }) => {
  126 |   // Two contexts + WS handshakes need a bit more headroom than the default 30s.
  127 |   test.setTimeout(60_000);
  128 |   const id = UNIQUE_GC();
  129 |   const name = "RT Room";
  130 | 
  131 |   const aliceContext = await browser.newContext();
  132 |   const bobContext = await browser.newContext();
  133 |   const alice = await aliceContext.newPage();
  134 |   const bob = await bobContext.newPage();
  135 | 
  136 |   try {
  137 |   // Alice creates the GC; Bob joins the same freshly-created GC. Each has
  138 |   // their own account/session.
  139 |   await signUp(alice);
  140 |   await createGroupChat(alice, id, name);
  141 | 
  142 |   // Seed Bob's localStorage BEFORE first navigation so the sidebar button is
  143 |   // present on initial render (the Sidebar only re-reads on focus).
  144 |   await bob.addInitScript(
  145 |     ({ gc, name }) => {
  146 |       localStorage.setItem("savedGCList", JSON.stringify([{ id: Number(gc), name }]));
  147 |     },
  148 |     { gc: id, name }
  149 |   );
  150 |   await signUp(bob);
  151 |   await bob.click(`[data-testid="gc-button-${id}"]`);
  152 |   await expect(bob.locator('[data-testid="message-list"]')).toBeVisible();
  153 | 
  154 |   // Alice sends a message; Bob should receive it in real time.
  155 |   await sendMessage(alice, "Hi Bob!");
> 156 |   await expect(bob.locator('[data-testid="message-bubble"]')).toHaveCount(1, {
      |                                                               ^ Error: expect(locator).toHaveCount(expected) failed
  157 |     timeout: 5_000,
  158 |   });
  159 |   await expect(bob.locator('[data-testid="message-bubble"]')).toContainText("Hi Bob!");
  160 | 
  161 |   // Bob replies; Alice should see it appended at the bottom.
  162 |   await sendMessage(bob, "Hey Alice!");
  163 |   await expect(alice.locator('[data-testid="message-bubble"]')).toHaveCount(2, {
  164 |     timeout: 5_000,
  165 |   });
  166 |   await expect(alice.locator('[data-testid="message-bubble"]').last()).toContainText(
  167 |     "Hey Alice!"
  168 |   );
  169 |   } finally {
  170 |     await aliceContext.close();
  171 |     await bobContext.close();
  172 |   }
  173 | });
  174 | 
  175 | // ---------------------------------------------------------------------------
  176 | // 6. Persistence: messages survive a full reload
  177 | // ---------------------------------------------------------------------------
  178 | test("messages persist across a page reload", async ({ page }) => {
  179 |   const id = UNIQUE_GC();
  180 |   await signUp(page);
  181 |   await createGroupChat(page, id, "Persist Room");
  182 |   await sendMessage(page, "persisted hello");
  183 | 
  184 |   await page.addInitScript(
  185 |     (gc) => {
  186 |       localStorage.setItem("savedGCList", JSON.stringify([{ id: Number(gc), name: "Persist Room" }]));
  187 |     },
  188 |     id
  189 |   );
  190 |   await page.reload();
  191 |   await page.click(`[data-testid="gc-button-${id}"]`);
  192 | 
  193 |   await expect(page.locator('[data-testid="message-bubble"]')).toHaveCount(1);
  194 |   await expect(page.locator('[data-testid="message-bubble"]')).toContainText(
  195 |     "persisted hello"
  196 |   );
  197 | });
  198 | 
  199 | // ---------------------------------------------------------------------------
  200 | // 7. Duplicate room code is reported to the user
  201 | // ---------------------------------------------------------------------------
  202 | test("creating a room with an existing code shows an error", async ({ page }) => {
  203 |   const id = UNIQUE_GC();
  204 |   await signUp(page);
  205 |   await createGroupChat(page, id, "Original Room");
  206 | 
  207 |   // Try to create a second room with the same code.
  208 |   await page.click('[data-testid="create-gc-toggle"]');
  209 |   await page.fill('[data-testid="create-gc-id"]', id);
  210 |   await page.fill('[data-testid="create-gc-name"]', "Impostor Room");
  211 |   await page.click('[data-testid="create-gc-submit"]');
  212 | 
  213 |   await expect(page.locator('[data-testid="create-gc-error"]')).toContainText(
  214 |     "already exists"
  215 |   );
  216 | });
  217 | 
  218 | // ---------------------------------------------------------------------------
  219 | // 8. Room codes have a max length
  220 | // ---------------------------------------------------------------------------
  221 | test("room code input is capped at 6 digits", async ({ page }) => {
  222 |   await signUp(page);
  223 |   await page.click('[data-testid="create-gc-toggle"]');
  224 |   await page.fill('[data-testid="create-gc-id"]', "123456789");
  225 | 
  226 |   await expect(page.locator('[data-testid="create-gc-id"]')).toHaveValue("123456");
  227 | });
  228 | 
  229 | // ---------------------------------------------------------------------------
  230 | // 9. Room owner can delete the room
  231 | // ---------------------------------------------------------------------------
  232 | test("room owner can delete the room", async ({ page }) => {
  233 |   const id = UNIQUE_GC();
  234 |   await signUp(page);
  235 |   await createGroupChat(page, id, "Doomed Room");
  236 | 
  237 |   await expect(page.locator('[data-testid="delete-room-button"]')).toBeVisible();
  238 | 
  239 |   page.on("dialog", (d) => d.accept());
  240 |   await page.click('[data-testid="delete-room-button"]');
  241 | 
  242 |   await expect(page.locator('[data-testid="delete-room-button"]')).toHaveCount(0);
  243 |   await expect(page.getByText("no channel selected")).toBeVisible();
  244 |   await expect(page.locator(`[data-testid="gc-button-${id}"]`)).toHaveCount(0);
  245 | });
  246 | 
  247 | // ---------------------------------------------------------------------------
  248 | // 10. Non-owners cannot delete a room
  249 | // ---------------------------------------------------------------------------
  250 | test("a non-owner cannot delete a room", async ({ browser }) => {
  251 |   const id = UNIQUE_GC();
  252 |   const ownerContext = await browser.newContext();
  253 |   const joinerContext = await browser.newContext();
  254 |   const owner = await ownerContext.newPage();
  255 |   const joiner = await joinerContext.newPage();
  256 | 
```