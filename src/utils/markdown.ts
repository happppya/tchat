/**
 * A small, dependency-free markdown renderer for the subset the chat uses:
 * fenced code blocks (```), inline code, bold, italics, strikethrough,
 * links, custom formatting tags, and horizontal rules.
 * Output is HTML-escaped first so untrusted text can't inject markup.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only allow http(s) links; everything else renders as plain text. */
function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  return /^(https?:\/\/)/i.test(trimmed) ? trimmed : null;
}

const CODE_PREFIX = "\u0000code";
const TAG_PREFIX = "\u0000tag";
const HR_PLACEHOLDER = "\u0000hr0000\u0000";

/**
 * Custom formatting tags that users can embed in messages.
 * Each tag maps to an HTML element + CSS class.
 * Content inside a tag is recursively processed through markdown,
 * so you can nest **bold**, `code`, etc. inside custom tags.
 */
interface TagDef {
  /** The HTML element to wrap content in. */
  el: string;
  /** CSS class(es) applied to the element. */
  cls: string;
  /** Whether this is a block-level element (starts on its own line). */
  block: boolean;
  /** Optional extra attributes string (e.g. for spoiler open state). */
  attrs?: string;
}

const KNOWN_TAGS: Record<string, TagDef> = {
  big:      { el: "span",   cls: "md-big",       block: false },
  small:    { el: "span",   cls: "md-small",     block: false },
  subtitle: { el: "div",    cls: "md-subtitle",  block: true },
  header:   { el: "div",    cls: "md-header",    block: true },
  h1:       { el: "div",    cls: "md-h1",        block: true },
  h2:       { el: "div",    cls: "md-h2",        block: true },
  h3:       { el: "div",    cls: "md-h3",        block: true },
  warn:     { el: "div",    cls: "md-warn",      block: true },
  error:    { el: "span",   cls: "md-error",     block: false },
  success:  { el: "span",   cls: "md-success",   block: false },
  info:     { el: "span",   cls: "md-info",      block: false },
  quote:    { el: "blockquote", cls: "md-quote", block: true },
  center:   { el: "div",    cls: "md-center",    block: true },
  rainbow:  { el: "span",   cls: "md-rainbow",   block: false },
  spoiler:  { el: "span",   cls: "md-spoiler",   block: false, attrs: 'tabindex="0" role="button" title="Click to reveal spoiler"' },
  mono:     { el: "code",   cls: "md-mono",      block: false },
  highlight:{ el: "mark",   cls: "md-highlight", block: false },
  strike:   { el: "del",    cls: "",             block: false },
};

/** All known tag names joined for regex alternation. */
const TAG_NAMES = Object.keys(KNOWN_TAGS).join("|");
const TAG_RE = new RegExp(
  `<(${TAG_NAMES})>([\\s\\S]*?)<\\/\\1>`,
  "gi"
);
const HR_SELF_CLOSING_RE = /<hr\s*\/?>/gi;
const HR_MARKDOWN_RE = /^[ \t]*-{3,}[ \t]*$/gm;

/**
 * Render `source` to safe HTML. The pipeline:
 * 1. Extract custom tags → placeholders (content is markdown-processed)
 * 2. Extract fenced code blocks → placeholders
 * 3. Replace --- / <hr> → placeholders
 * 4. Escape remaining text, apply inline markdown
 * 5. Restore placeholders in order
 */
export function renderMarkdown(source: string): string {
  const tagReplacements: string[] = [];
  const codeBlocks: string[] = [];

  // --- Step 1: extract custom tags ------------------------------------------

  const withTagsExtracted = source.replace(TAG_RE, (_match, tagName: string, content: string) => {
    const def = KNOWN_TAGS[tagName.toLowerCase()];
    if (!def) return _match; // shouldn't happen, but guard

    const idx = tagReplacements.length;
    // Process the inner content through markdown too (recursively).
    // We'll call renderMarkdown on it, but we must be careful about infinite
    // recursion. The content inside a tag is a fresh string — renderMarkdown
    // on it will not re-trigger the outer tag extraction because the literal
    // <tagname> delimiters have been consumed.
    const inner = renderMarkdown(content);
    let open = `<${def.el}`;
    if (def.cls) open += ` class="${def.cls}"`;
    if (def.attrs) open += ` ${def.attrs}`;
    open += '>';
    const close = `</${def.el}>`;
    tagReplacements.push(open + inner + close);
    return `${TAG_PREFIX}${idx}\u0000`;
  });

  // --- Step 2: extract fenced code blocks -----------------------------------

  const withoutCode = withTagsExtracted.replace(
    /```[^\n`]*\n?([\s\S]*?)```/g,
    (_match, code: string) => {
      const index = codeBlocks.length;
      codeBlocks.push(escapeHtml(code.replace(/\n$/, "")));
      return `${CODE_PREFIX}${index}\u0000`;
    }
  );

  // --- Step 3: horizontal rules ---------------------------------------------
  // Replace <hr/> (or <hr>) and --- on its own line with <hr>.

  let html = withoutCode.replace(HR_SELF_CLOSING_RE, HR_PLACEHOLDER);
  html = html.replace(HR_MARKDOWN_RE, HR_PLACEHOLDER);

  // --- Step 4: escape + inline markdown -------------------------------------

  html = escapeHtml(html);

  html = html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, text: string, url: string) => {
      const href = safeUrl(url);
      return href
        ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`
        : text;
    })
    // Room links: [#12345]
    .replace(
      /\[#(\d{1,6})\]/g,
      (_match, roomCode: string) =>
        `<span class="room-link" data-room-id="${roomCode}" title="Join room #${roomCode}">[#${roomCode}]</span>`
    )
    // @mentions
    .replace(
      /(^|\s)@everyone(?=\s|[.,!?:;]|$)/gi,
      '$1<span class="mention mention-everyone">@everyone</span>'
    )
    .replace(
      /(^|\s)@([a-zA-Z0-9_]{1,30})(?=\s|[.,!?:;]|$)/g,
      '$1<span class="mention">@$2</span>'
    );

  // Restore horizontal rules — replace the (now-escaped) placeholder.
  // The placeholder \u0000hr0000\u0000 gets escaped to the literal text,
  // but since \u0000 is a null char, escapeHtml will leave it as-is (no
  // &, <, >, ", or ' in it). Let's verify: \u0000hr0000\u0000 contains
  // no escapable chars, so it survives. Good.
  html = html.replace(
    HR_PLACEHOLDER,
    '<hr class="md-hr" />'
  );

  // --- Step 5: restore placeholders -----------------------------------------

  // Restore code blocks
  codeBlocks.forEach((code, index) => {
    html = html.replace(
      `${CODE_PREFIX}${index}\u0000`,
      `<pre class="md-code"><code>${code}</code></pre>`
    );
  });

  // Restore custom tags (their inner HTML was already markdown-processed)
  tagReplacements.forEach((replacement, index) => {
    html = html.replace(
      `${TAG_PREFIX}${index}\u0000`,
      replacement
    );
  });

  return html;
}