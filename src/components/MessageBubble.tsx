import type { Message } from "../types";
import type { MessageGroup } from "../utils/format";
import { formatGroupTime } from "../utils/format";

interface Props {
  group: MessageGroup;
}

/**
 * A single message group rendered in terminal style: a prompt line with the
 * author name and time, followed by indented message lines. GIFs render inline
 * below their text. Kept themeable via CSS variables only.
 */
export default function MessageBubble({ group }: Props) {
  const time = formatGroupTime(group.firstSentAt);

  return (
    <div
      data-testid="message-bubble"
      className="px-1 py-1 leading-relaxed"
    >
      {/* Prompt header: "name:" in accent, then a prompt sigil */}
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-[var(--accent)] glow font-semibold">
          {group.displayName}:
        </span>
        <span className="text-[var(--text-muted)] text-xs">
          {time && `[${time}]`}
        </span>
        <span className="text-[var(--accent)]">$</span>
      </div>

      {/* Message lines */}
      <div className="pl-3 flex flex-col gap-1">
        {group.messages.map((msg, idx) => (
          <MessageLine key={msg.id ?? idx} message={msg} />
        ))}
      </div>
    </div>
  );
}

function MessageLine({ message }: { message: Message }) {
  const text = message.message_text || "";
  const gifUrl = message.gif_url;

  return (
    <div className="flex flex-col gap-1">
      {text && (
        <span className="text-[var(--text-primary)] break-words whitespace-pre-wrap">
          {text}
        </span>
      )}
      {gifUrl && (
        <img
          src={gifUrl}
          alt="GIF"
          className="max-w-[220px] block rounded-sm border border-[var(--border-primary)]"
        />
      )}
    </div>
  );
}
