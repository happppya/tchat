/**
 * A small, dependency-free markdown renderer for the subset the chat uses:
 * fenced code blocks (```), inline code, bold, italics, strikethrough, and
 * links. Output is HTML-escaped first so untrusted text can't inject markup.
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

/**
 * Render `source` to safe HTML. Fenced code blocks are extracted before
 * escaping so their contents render verbatim inside `<pre><code>`.
 */
export function renderMarkdown(source: string): string {
  const codeBlocks: string[] = [];

  // Pull out ```fenced code blocks``` into placeholders first.
  const withoutCode = source.replace(
    /```[^\n`]*\n?([\s\S]*?)```/g,
    (_match, code: string) => {
      const index = codeBlocks.length;
      codeBlocks.push(escapeHtml(code.replace(/\n$/, "")));
      return `${CODE_PREFIX}${index}\u0000`;
    }
  );

  let html = escapeHtml(withoutCode);

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
    });

  // Restore the code blocks as escaped, monospace blocks.
  codeBlocks.forEach((code, index) => {
    html = html.replace(
      `${CODE_PREFIX}${index}\u0000`,
      `<pre class="md-code"><code>${code}</code></pre>`
    );
  });

  return html;
}
