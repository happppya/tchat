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
    <span
      className="md-body break-words whitespace-pre-wrap"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
