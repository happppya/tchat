import { describe, expect, it } from "vitest";

import { renderMarkdown } from "./markdown";

/**
 * XSS regression locks: user-typed markdown is untrusted input rendered via
 * dangerouslySetInnerHTML, so these cases must keep rendering inert text.
 */
describe("renderMarkdown XSS regressions", () => {
  it("escapes raw <script> tags", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes event-handler attributes on injected elements", () => {
    const html = renderMarkdown(`<img src=x onerror="alert(1)">`);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("never turns javascript: links into anchors", () => {
    const html = renderMarkdown("[click](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("javascript:");
  });

  it("strips javascript: even with padding tricks", () => {
    for (const url of [
      "[x](JAVASCRIPT:alert(1))",
      "[x](java\tscript:alert(1))",
      '[x](javascript&#58;alert(1))',
    ]) {
      expect(renderMarkdown(url)).not.toContain("<a ");
    }
  });  it("marks real http(s) links with noopener noreferrer", () => {
    const html = renderMarkdown("[site](https://example.com)");
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("keeps quoted link urls from breaking out of the href attribute", () => {
    const html = renderMarkdown('[x](" onclick="alert(1))');
    // No anchor may be generated, and the quote must stay escaped so it can't
    // open an attribute — the words themselves as escaped text are harmless.
    expect(html).not.toContain("<a ");
    expect(html).not.toContain('" onclick=');
  });

  it("renders fenced code blocks escaped inside <pre><code>", () => {
    const html = renderMarkdown("```\n<b>bold</b>\n```");
    expect(html).toContain("<pre");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("is not fooled by forged code-block placeholders", () => {
    // The \u0000codeN\u0000 sequence is an internal placeholder; attacker
    // input containing it (plus a real block) must stay inert either way.
    const evil = "\u0000code0\u0000<script>alert(1)</script>";
    const html = renderMarkdown(evil);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
