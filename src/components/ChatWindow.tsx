import { useRef, useEffect, useMemo } from "react";
import type { Message } from "../types";
import { groupMessages } from "../utils/format";
import MessageBubble from "./MessageBubble";
import MessageComposer from "./MessageComposer";

interface Props {
  messages: Message[];
  gcName: string;
  error: string;
  /** Whether the current user created this room and may delete it. */
  isOwner: boolean;
  onSendMessage: (text: string, gifUrl: string | null) => void;
  onDeleteRoom: () => void;
}

export default function ChatWindow({
  messages,
  gcName,
  error,
  isOwner,
  onSendMessage,
  onDeleteRoom,
}: Props) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const groups = useMemo(() => groupMessages(messages), [messages]);

  return (
    <div className="flex flex-col flex-1 m-1 ml-0 min-h-0">
      {/* Terminal title bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <span className="text-[var(--accent)]">{"~"}</span>
        <span className="text-[var(--text-primary)] text-sm">{gcName}</span>
        <span className="text-[var(--text-muted)] text-xs">
          — {messages.length} msg{messages.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {isOwner && (
            <button
              onClick={onDeleteRoom}
              data-testid="delete-room-button"
              title="Delete this room"
              className="text-[var(--text-muted)] text-xs border border-[var(--border-primary)] px-2 py-0.5 hover:text-[var(--error)] hover:border-[var(--error)]/50 transition-colors cursor-pointer"
            >
              [ delete room ]
            </button>
          )}
          <span className="cursor-block !h-3 !w-2" />
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div className="border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-1.5 text-[var(--error)] text-sm my-1">
          <span className="opacity-60">err: </span>
          {error}
        </div>
      )}

      {/* Messages — oldest at top, newest at bottom */}
      <div
        className="flex-1 overflow-y-auto flex flex-col gap-1 py-2 px-1"
        data-testid="message-list"
      >
        {groups.length === 0 && !error && (
          <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-sm flex-col gap-2">
            <span className="opacity-50">$ awaiting input…</span>
            <span className="opacity-30 text-xs">no messages yet</span>
          </div>
        )}
        {groups.map((group) => (
          <MessageBubble key={group.key} group={group} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <MessageComposer onSend={onSendMessage} />
    </div>
  );
}
