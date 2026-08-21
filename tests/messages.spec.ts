import { test, expect } from "@playwright/test";
import { uniqueGcId, resetApp, signUp, createGroupChat } from "./helpers";

/**
 * Rich-message tests: markdown, fenced code blocks, and small file uploads.
 */

const UNIQUE_GC = uniqueGcId;

test.beforeEach(async ({ page }) => {
  await resetApp(page);
});

test("fenced code blocks render as code", async ({ page }) => {
  const id = UNIQUE_GC();
  await signUp(page);
  await createGroupChat(page, id, "Code Room");

  await page.fill(
    '[data-testid="message-input"]',
    "before\n```\nconst x = 1;\n```\nafter"
  );
  await page.press('[data-testid="message-input"]', "Enter");

  const bubble = page.locator('[data-testid="message-bubble"]');
  await expect(bubble).toBeVisible();
  const codeBlock = bubble.locator("pre.md-code");
  await expect(codeBlock).toContainText("const x = 1;");
  await expect(bubble).toContainText("before");
  await expect(bubble).toContainText("after");
});

test("markdown renders bold, inline code, and links", async ({ page }) => {
  const id = UNIQUE_GC();
  await signUp(page);
  await createGroupChat(page, id, "Markdown Room");

  await page.fill(
    '[data-testid="message-input"]',
    "**bold** and `code` and [link](https://example.com)"
  );
  await page.press('[data-testid="message-input"]', "Enter");

  const bubble = page.locator('[data-testid="message-bubble"]');
  await expect(bubble.locator("strong", { hasText: "bold" })).toBeVisible();
  await expect(bubble.locator("code", { hasText: "code" })).toBeVisible();
  const link = bubble.locator("a", { hasText: "link" });
  await expect(link).toHaveAttribute("href", "https://example.com");
});

test("small files upload and appear as attachments", async ({ page }) => {
  const id = UNIQUE_GC();
  await signUp(page);
  await createGroupChat(page, id, "Files Room");

  await page.setInputFiles('[data-testid="file-input"]', {
    name: "hello.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("hello world"),
  });

  // The upload resolves and the pending attachment is shown.
  await expect(page.getByText("hello.txt")).toBeVisible();

  await page.press('[data-testid="message-input"]', "Enter");

  const attachment = page.locator('[data-testid="file-attachment"]');
  await expect(attachment).toBeVisible();
  await expect(attachment).toContainText("hello.txt");
});
