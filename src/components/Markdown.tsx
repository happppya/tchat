import { useMemo } from "react";
import { renderMarkdown } from "../utils/markdown";

interface Props {
  text: string;
}

/**
 * Renders the supported markdown subset. `whitespace-pre-wrap` keeps plain
 * newlines visible; code blocks manage their own whitespace internally.
 */
export default function Markdown({ text }: Props) {
  const html = useMemo(() => renderMarkdown(text), [text]);

  return (
    <>
      <style>{`.room-link{color:var(--accent,#3b82f6);text-decoration:underline;cursor:pointer}.room-link:hover{color:var(--accent-light,#60a5fa)}.mention{color:var(--accent-light,#60a5fa);font-weight:600;padding:0 1px;border-radius:2px}.mention-everyone{background:var(--accent,#3b82f6)/15;padding:0 2px;border:1px solid var(--accent,#3b82f6);text-shadow:0 0 4px var(--accent,#3b82f6)}`}</style>
      <span
        className="md-body break-words whitespace-pre-wrap"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
