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
  });
  it("marks real http(s) links with noopener noreferrer", () => {
    const html = renderMarkdown("[site](https://example.com)");
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("keeps quoted link urls from breaking out of the href attribute", () => {
    const html = renderMarkdown('[x](" onclick="alert(1))');
    expect(html).not.toContain("<a ");
    expect(html).not.toContain('" onclick=');
  });

  it("renders fenced code blocks escaped inside <pre><code>", () => {
    const html = renderMarkdown("```\n<b>bold</b>\n```");
    expect(html).toContain("<pre");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("is not fooled by forged code-block placeholders", () => {
    const evil = "\u0000code0\u0000<script>alert(1)</script>";
    const html = renderMarkdown(evil);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ── Custom formatting tags ────────────────────────────────────────────────

describe("custom formatting tags", () => {
  it("renders <big> as large bold text", () => {
    const html = renderMarkdown("<big>hello</big>");
    expect(html).toContain('<span class="md-big">hello</span>');
  });

  it("renders <small> as subtle text", () => {
    const html = renderMarkdown("<small>fine print</small>");
    expect(html).toContain('<span class="md-small">fine print</span>');
  });

  it("renders <subtitle> as a muted block", () => {
    const html = renderMarkdown("<subtitle>Chapter One</subtitle>");
    expect(html).toContain('<div class="md-subtitle">Chapter One</div>');
  });

  it("renders <header> with accent underline", () => {
    const html = renderMarkdown("<header>My Section</header>");
    expect(html).toContain('<div class="md-header">My Section</div>');
  });

  it("renders <h1>, <h2>, <h3>", () => {
    expect(renderMarkdown("<h1>Top</h1>")).toContain('<div class="md-h1">Top</div>');
    expect(renderMarkdown("<h2>Mid</h2>")).toContain('<div class="md-h2">Mid</div>');
    expect(renderMarkdown("<h3>Low</h3>")).toContain('<div class="md-h3">Low</div>');
  });

  it("renders <warn> as a bordered callout", () => {
    const html = renderMarkdown("<warn>deprecated</warn>");
    expect(html).toContain('<div class="md-warn">deprecated</div>');
  });

  it("renders <error>, <success>, <info> as inline colored text", () => {
    expect(renderMarkdown("<error>fail</error>")).toContain('<span class="md-error">fail</span>');
    expect(renderMarkdown("<success>pass</success>")).toContain('<span class="md-success">pass</span>');
    expect(renderMarkdown("<info>note</info>")).toContain('<span class="md-info">note</span>');
  });

  it("renders <quote> as a blockquote with accent bar", () => {
    const html = renderMarkdown("<quote>someone said this</quote>");
    expect(html).toContain('<blockquote class="md-quote">someone said this</blockquote>');
  });

  it("renders <center> as centered content", () => {
    const html = renderMarkdown("<center>middle</center>");
    expect(html).toContain('<div class="md-center">middle</div>');
  });

  it("renders <rainbow> with animation class", () => {
    const html = renderMarkdown("<rainbow>fabulous</rainbow>");
    expect(html).toContain('<span class="md-rainbow">fabulous</span>');
  });

  it("renders <spoiler> with click-to-reveal behavior", () => {
    const html = renderMarkdown("<spoiler>Luke's father is Darth Vader</spoiler>");
    expect(html).toContain("md-spoiler");
    expect(html).toContain("tabindex");
  });

  it("renders <mono> as monospace styled code", () => {
    const html = renderMarkdown("<mono>function()</mono>");
    expect(html).toContain('<code class="md-mono">function()</code>');
  });

  it("renders <highlight> with marker styling", () => {
    const html = renderMarkdown("<highlight>important</highlight>");
    expect(html).toContain('<mark class="md-highlight">important</mark>');
  });

  it("renders <strike> as deleted text", () => {
    const html = renderMarkdown("<strike>removed</strike>");
    expect(html).toContain("<del>removed</del>");
  });

  it("escapes HTML inside custom tags", () => {
    const html = renderMarkdown("<big><script>alert(1)</script></big>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("renders nested markdown inside custom tags", () => {
    const html = renderMarkdown("<big>**bold** and *italic*</big>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  it("supports case-insensitive tags", () => {
    expect(renderMarkdown("<BIG>LOUD</BIG>")).toContain('class="md-big">LOUD</span>');
    expect(renderMarkdown("<Big>Loud</Big>")).toContain('class="md-big">Loud</span>');
  });

  it("leaves unknown tags as escaped text", () => {
    const html = renderMarkdown("<blink>annoying</blink>");
    expect(html).toContain("&lt;blink&gt;annoying&lt;/blink&gt;");
  });

  it("does not match unclosed tags", () => {
    const html = renderMarkdown("<big>oops, no close");
    expect(html).toContain("&lt;big&gt;oops, no close");
  });
});

// ── Horizontal rules ───────────────────────────────────────────────────────

describe("horizontal rules", () => {
  it("renders --- on its own line as <hr>", () => {
    const html = renderMarkdown("before\n---\nafter");
    expect(html).toContain('<hr class="md-hr" />');
  });

  it("renders <hr/> self-closing tag", () => {
    const html = renderMarkdown("before<hr/>after");
    expect(html).toContain('<hr class="md-hr" />');
  });

  it("renders <hr> without closing slash", () => {
    const html = renderMarkdown("before<hr>after");
    expect(html).toContain('<hr class="md-hr" />');
  });

  it("keeps --- inside fenced code blocks as literal text", () => {
    const html = renderMarkdown("```\n---\n```");
    expect(html).not.toContain('<hr');
    expect(html).toContain("---");
  });
});