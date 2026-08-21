import type { Message } from "../types";
import { formatTimestamp } from "../utils/format";

interface Props {
  message: Message;
}

export default function MessageBubble({ message }: Props) {
  const displayName = message.display_name || "Unknown";
  const text = message.message_text || "";
  const gifUrl = message.gif_url;
  const time = formatTimestamp(message.sent_at);

  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-2.5 text-sm leading-relaxed">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <strong className="text-[var(--text-primary)]">{displayName}:</strong>
        <span>{text}</span>
        {time && (
          <span className="text-xs text-[var(--text-muted)] ml-2">
            ({time})
          </span>
        )}
      </div>
      {gifUrl && (
        <img
          src={gifUrl}
          alt="GIF"
          className="max-w-[200px] block mt-1.5 rounded-lg"
        />
      )}
    </div>
  );
}