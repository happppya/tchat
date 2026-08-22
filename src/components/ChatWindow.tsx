import { useRef, useEffect, useMemo, useState } from "react";
import type { FileAttachment, Message, ReplyTarget } from "../types";
import { groupMessages, messagePreview } from "../utils/format";
import MessageBubble from "./MessageBubble";
import MessageComposer from "./MessageComposer";

interface Props {
  messages: Message[];
  gcName: string;
  error: string;
  /** Whether the current user created this room and may delete it. */
  isOwner: boolean;
  /** Whether the viewer is a room owner, mod, or admin. */
  viewerIsStaff: boolean;
  viewerIsAdmin: boolean;
  /** True when there are older pages still available on the server. */
  hasMore: boolean;
  /** True while an older page is being fetched. */
  loadingOlder: boolean;
  onSendMessage: (
    text: string,
    gifUrl: string | null,
    file?: FileAttachment | null,
    replyToId?: number | null
  ) => void;
  onDeleteRoom: () => void;
  onLeaveRoom: () => void;
  onViewProfile: (username: string) => void;
  onLoadOlder: () => void;
  onSlashCommand: (command: string, arg: string) => void;
  onJoinRoom: (roomCode: number) => void;
  onModAction: (username: string, action: string) => void;
  /** The logged-in user's id, passed down to gate edit/delete controls. */
  currentUserId: number | null;
  onEditMessage: (messageId: number, text: string) => void;
  onDeleteMessage: (messageId: number) => void;
  onToggleReaction: (messageId: number, emoji: string) => void;
}

export default function ChatWindow({
  messages,
  gcName,
  error,
  isOwner,
  viewerIsStaff,
  viewerIsAdmin,
  hasMore,
  loadingOlder,
  onSendMessage,
  onDeleteRoom,
  onLeaveRoom,
  onViewProfile,
  onLoadOlder,
  onSlashCommand,
  onJoinRoom,
  onModAction,
  currentUserId,
  onEditMessage,
  onDeleteMessage,
  onToggleReaction,
}: Props) {
  const [replyingTo, setReplyingTo] = useState<ReplyTarget | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const shouldRestoreScrollRef = useRef(false);
  const scrollAnchorRef = useRef(0);

  const groups = useMemo(() => groupMessages(messages), [messages]);

  const handleReply = (message: Message) => {
    setReplyingTo({
      id: message.id,
      quote: messagePreview(message),
      author: message.display_name || "unknown",
    });
  };

  const handleComposerSend = (
    text: string,
    gifUrl: string | null,
    file?: FileAttachment | null
  ) => {
    onSendMessage(text, gifUrl, file, replyingTo?.id ?? null);
    setReplyingTo(null);
  };

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;

    // Stay glued to the bottom only while the user is actually near it, so a
    // new live message doesn't yank them away from older history.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stickToBottomRef.current = nearBottom;

    // Scrolled to the top: request the previous page, remembering the scroll
    // height so we can restore the viewport after the prepend.
    if (el.scrollTop <= 24 && hasMore && !loadingOlder) {
      shouldRestoreScrollRef.current = true;
      scrollAnchorRef.current = el.scrollHeight;
      onLoadOlder();
    }
  };

  // Event delegation for room link clicks in the message list.
  const handleListClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const roomLink = target.closest('[data-room-id]') as HTMLElement | null;
    if (roomLink) {
      const roomId = parseInt(roomLink.dataset.roomId ?? '', 10);
      if (roomId) onJoinRoom(roomId);
    }
  };

  useEffect(() => {
    const el = listRef.current;
    if (shouldRestoreScrollRef.current && el) {
      // Older messages were prepended: keep the same content in view.
      const delta = el.scrollHeight - scrollAnchorRef.current;
      el.scrollTop += delta;
      shouldRestoreScrollRef.current = false;
    } else if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  return (
    <div className="flex flex-col flex-1 m-1 ml-0 min-h-0">
      {/* Terminal title bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <span className="text-[var(--accent)]">{"~"}</span>
        <span className="text-[var(--text-primary)] text-sm">{gcName}</span>
        <span
          data-testid="message-count"
          className="text-[var(--text-muted)] text-xs"
        >
          — {messages.length} msg{messages.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <button
            onClick={onLeaveRoom}
            data-testid="leave-room-button"
            title="Leave this room"
            className="text-[var(--text-muted)] text-xs border border-[var(--border-primary)] px-2 py-0.5 hover:text-[var(--error)] hover:border-[var(--error)]/50 transition-colors cursor-pointer"
          >
            [ leave room ]
          </button>
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
        ref={listRef}
        onScroll={handleScroll}
        onClick={handleListClick}
        className="flex-1 overflow-y-auto flex flex-col gap-1 py-2 px-1"
        data-testid="message-list"
      >
        {loadingOlder && (
          <div
            data-testid="loading-older"
            className="text-center text-xs text-[var(--text-muted)] py-1"
          >
            $ loading older…
          </div>
        )}
        {groups.length === 0 && !error && (
          <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-sm flex-col gap-2">
            <span className="opacity-50">$ awaiting input…</span>
            <span className="opacity-30 text-xs">no messages yet</span>
          </div>
        )}
        {groups.map((group) => (
          <MessageBubble
            key={group.key}
            group={group}
            currentUserId={currentUserId}
            viewerIsStaff={viewerIsStaff}
            viewerIsAdmin={viewerIsAdmin}
            onViewProfile={onViewProfile}
            onEditMessage={onEditMessage}
            onDeleteMessage={onDeleteMessage}
            onReply={handleReply}
            onToggleReaction={onToggleReaction}
            onModAction={onModAction}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <MessageComposer
        onSend={handleComposerSend}
        replyTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onSlashCommand={onSlashCommand}
      />
    </div>
  );
}
