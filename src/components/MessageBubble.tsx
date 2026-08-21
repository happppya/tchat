import type { Message } from "../types";
import type { MessageGroup } from "../utils/format";
import { formatGroupTime } from "../utils/format";
import Avatar from "./Avatar";
import Markdown from "./Markdown";

interface Props {
  group: MessageGroup;
  onViewProfile: (username: string) => void;
}

/**
 * A single message group rendered in terminal style: an avatar + author line
 * with time, followed by indented message lines. GIFs render inline below
 * their text. Clicking the author opens their profile. Kept themeable via CSS
 * variables only.
 */
export default function MessageBubble({ group, onViewProfile }: Props) {
  const time = formatGroupTime(group.firstSentAt);

  return (
    <div
      data-testid="message-bubble"
      className="px-1 py-1 leading-relaxed"
    >
      {/* Author header: avatar + clickable name + time + prompt sigil */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => onViewProfile(group.displayName)}
          data-testid="message-author"
          title={`View ${group.displayName}'s profile`}
          className="flex items-center gap-1.5 p-0 border-none bg-transparent cursor-pointer text-left"
        >
          <Avatar name={group.displayName} src={group.avatarUrl} size={24} />
          <span className="text-[var(--accent)] glow font-semibold">
            {group.displayName}:
          </span>
        </button>
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
  const fileUrl = message.file_url;
  const fileName = message.file_name || "attachment";
  const isImage = !!fileUrl && (message.file_type || "").startsWith("image/");

  return (
    <div className="flex flex-col gap-1">
      {text && <Markdown text={text} />}
      {gifUrl && (
        <img
          src={gifUrl}
          alt="GIF"
          className="max-w-[220px] block rounded-sm border border-[var(--border-primary)]"
        />
      )}
      {fileUrl && (
        <div className="mt-0.5">
          {isImage ? (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              download={fileName}
            >
              <img
                src={fileUrl}
                alt={fileName}
                className="max-w-[260px] max-h-[200px] block rounded-sm border border-[var(--border-primary)] object-contain"
              />
            </a>
          ) : (
            <a
              href={fileUrl}
              download={fileName}
              data-testid="file-attachment"
              className="inline-flex items-center gap-1.5 text-[var(--accent-light)] text-xs border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              <span>📎</span>
              <span className="max-w-[180px] truncate">{fileName}</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}
