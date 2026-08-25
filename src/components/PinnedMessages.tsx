import { useState, useEffect, useCallback } from "react";
import type { Message } from "../types";
import { fetchPinnedMessages } from "../services/api";
import { messagePreview } from "../utils/format";

interface Props {
  groupChatId: number;
  /** Called when the user clicks a pinned message to scroll to it. */
  onJumpToMessage: (messageId: number) => void;
}

/**
 * A pin icon button in the chat window header. On click, opens a popover
 * listing every pinned message in the current room. Each row shows a
 * truncated preview; clicking a row scrolls the message list to that
 * message.
 */
export default function PinnedMessages({ groupChatId, onJumpToMessage }: Props) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchPinnedMessages(groupChatId);
      setPinned(list);
    } catch {
      setPinned([]);
    } finally {
      setLoading(false);
    }
  }, [groupChatId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleJump = (msg: Message) => {
    setOpen(false);
    onJumpToMessage(msg.id);
  };

  const count = pinned.length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        data-testid="pinned-messages-toggle"
        title={count ? `${count} pinned message${count === 1 ? "" : "s"}` : "No pinned messages"}
        className={`text-xs border px-1.5 py-0.5 transition-colors cursor-pointer ${
          count
            ? "text-[var(--accent-light)] border-[var(--accent)]/60 hover:border-[var(--accent)]"
            : "text-[var(--text-muted)] border-[var(--border-primary)] hover:text-[var(--text-primary)]"
        }`}
      >
        📌{count ? ` ${count}` : ""}
      </button>

      {open && (
        <>
          {/* Backdrop to close on outside click */}
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
          />
          <div
            data-testid="pinned-popover"
            className="absolute top-full right-0 z-40 mt-1 w-72 max-h-64 overflow-y-auto border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl"
          >
            <div className="px-2 py-1.5 text-xs text-[var(--text-muted)] border-b border-[var(--border-primary)] flex items-center justify-between">
              <span>Pinned Messages</span>
              <button
                onClick={() => setOpen(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs border-none bg-transparent cursor-pointer"
              >
                ✕
              </button>
            </div>
            {loading && (
              <div className="px-3 py-2 text-xs text-[var(--text-muted)]">
                loading…
              </div>
            )}
            {!loading && pinned.length === 0 && (
              <div className="px-3 py-2 text-xs text-[var(--text-muted)]">
                No pinned messages in this room.
              </div>
            )}
            {pinned.map((msg) => (
              <button
                key={msg.id}
                onClick={() => handleJump(msg)}
                data-testid="pinned-message-row"
                className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer border-none bg-transparent border-b border-[var(--border-primary)]/50 last:border-b-0"
              >
                <span className="text-[var(--accent-light)] font-semibold">
                  {msg.display_name || "unknown"}
                </span>
                <span className="text-[var(--text-muted)] ml-1">
                  — {messagePreview(msg).slice(0, 60)}
                  {messagePreview(msg).length > 60 ? "…" : ""}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}