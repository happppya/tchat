import React, { useRef, useEffect, useMemo, useState, useCallback } from "react";
import type { FileAttachment, Message, ReplyTarget } from "../types";
import { groupMessages, messagePreview, isoDate, formatDay } from "../utils/format";
import MessageBubble from "./MessageBubble";
import MessageComposer from "./MessageComposer";
import PinnedMessages from "./PinnedMessages";

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
  onRenameRoom: (name: string) => void;
  /** Full room-type names for the header, e.g. ["anonymous"]. */
  roomTypeNames?: string[];
  /** The logged-in user's id, passed down to gate edit/delete controls. */
  currentUserId: number | null;
  onEditMessage: (messageId: number, text: string) => void;
  onDeleteMessage: (messageId: number) => void;
  onToggleReaction: (messageId: number, emoji: string) => void;
  /** Highest message ID the user has "seen" — ids above this are unread. */
  lastReadId: number;
  /** Called when the user scrolls to the bottom so all messages become read. */
  onMarkAllRead: () => void;
  /** Set of message ids that @ping the current user — highlighted rows. */
  highlightedMessageIds: ReadonlySet<number>;
  /** Called when the user dismisses the error banner. */
  onClearError?: () => void;
  /** Pin/unpin a message (staff only). */
  onPinMessage: (messageId: number) => void;
  onUnpinMessage: (messageId: number) => void;
  /** Called when the user clicks a pinned message to scroll to it. */
  onJumpToMessage: (messageId: number) => void;
  /** Hide the [ leave room ] / [ delete room ] buttons. */
  hideRoomActions?: boolean;
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
  onRenameRoom,
  roomTypeNames = [],
  currentUserId,
  onEditMessage,
  onDeleteMessage,
  onToggleReaction,
  lastReadId,
  onMarkAllRead,
  highlightedMessageIds,
  onClearError,
  onPinMessage,
  onUnpinMessage,
  onJumpToMessage,
  hideRoomActions = false,
}: Props) {
  const [replyingTo, setReplyingTo] = useState<ReplyTarget | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameName, setRenameName] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const shouldRestoreScrollRef = useRef(false);
  const scrollAnchorRef = useRef(0);
  // True once we've scrolled to the unread bar on initial load
  // (avoid re-scrolling on every render).
  const scrolledToUnreadRef = useRef(false);

  const groups = useMemo(() => groupMessages(messages), [messages]);

  // Unique display names in the room for slash-command @username autocomplete.
  const memberNames = useMemo(
    () => [...new Set(messages.map((m) => m.display_name).filter(Boolean))] as string[],
    [messages]
  );

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

    // Show the "scroll to bottom" FAB when the user is scrolled up at
    // least one viewport height from the bottom.
    setShowScrollFab(el.scrollHeight - el.scrollTop - el.clientHeight > el.clientHeight);

    // When the user scrolls near the bottom, dismiss the unread bar
    // permanently — they've seen everything below it.
    if (nearBottom) {
      onMarkAllRead();
      setUnreadDismissed(true);
    }

    // Scrolled to the top: request the previous page, remembering the scroll
    // height so we can restore the viewport after the prepend.
    if (el.scrollTop <= 24 && hasMore && !loadingOlder) {
      shouldRestoreScrollRef.current = true;
      scrollAnchorRef.current = el.scrollHeight;
      onLoadOlder();
    }
  };

  // Find the index of the first message group that contains any unread message.
  const unreadGroupIndex = useMemo(() => {
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].messages.some((m) => m.id > lastReadId)) return i;
    }
    return -1;
  }, [groups, lastReadId]);

  // Find indices where the calendar day changes between consecutive groups.
  const dayBoundaries = useMemo(() => {
    const set = new Set<number>();
    for (let i = 1; i < groups.length; i++) {
      if (isoDate(groups[i - 1].firstSentAt) !== isoDate(groups[i].firstSentAt)) {
        set.add(i);
      }
    }
    return set;
  }, [groups]);

  // FAB shown when the user is scrolled far from the bottom.
  const [showScrollFab, setShowScrollFab] = useState(false);

  // Once the user scrolls to the bottom (has seen all unread messages),
  // dismiss the unread bar permanently for this room visit. New live
  // messages should not bring it back — it's only for the initial catch-up.
  const [unreadDismissed, setUnreadDismissed] = useState(false);

  // Count of unread messages (for the bar label).
  const unreadCount = groups.slice(unreadGroupIndex === -1 ? groups.length : unreadGroupIndex).reduce(
    (sum, g) => sum + g.messages.filter((m) => m.id > lastReadId).length,
    0
  );

  // Event delegation for room link clicks in the message list.
  const handleListClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const roomLink = target.closest('[data-room-id]') as HTMLElement | null;
    if (roomLink) {
      const roomId = parseInt(roomLink.dataset.roomId ?? '', 10);
      if (roomId) onJoinRoom(roomId);
    }
  };

  // Scroll to the unread bar (or bottom) ONCE when entering a room.
  useEffect(() => {
    if (scrolledToUnreadRef.current) return;
    if (groups.length === 0) return;

    const el = listRef.current;
    if (!el) return;

    if (unreadGroupIndex >= 0) {
      const bar = el.querySelector('[data-testid="unread-bar"]');
      if (bar) bar.scrollIntoView({ block: "start" });
    } else {
      messagesEndRef.current?.scrollIntoView();
    }
    scrolledToUnreadRef.current = true;
  }, [groups, lastReadId, unreadGroupIndex]);

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

  const scrollToBottom = useCallback(() => {
    stickToBottomRef.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  return (
    <div className="flex flex-col flex-1 m-1 ml-0 min-h-0 relative">
      {/* Terminal title bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <span className="text-[var(--accent)]">{"~"}</span>
        {renaming ? (
          <input
            autoFocus
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const trimmed = renameName.trim();
                if (trimmed) onRenameRoom(trimmed);
                setRenaming(false);
              }
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={() => setRenaming(false)}
            className="bg-[var(--bg-secondary)] border border-[var(--accent)] px-1.5 py-0.5 text-sm text-[var(--text-primary)] outline-none"
          />
        ) : (
          <span
            className="text-[var(--text-primary)] text-sm group/gcn relative cursor-default"
            title={isOwner || viewerIsAdmin ? "Click to rename" : undefined}
          >
            <span data-testid="room-header-name">{gcName}</span>
            {roomTypeNames.map((type) => (
              <span
                key={type}
                className="ml-2 text-[10px] text-[var(--text-muted)] border border-[var(--border-primary)] px-1 py-0.5"
              >
                {type}
              </span>
            ))}
            {(isOwner || viewerIsAdmin) && (
              <button
                onClick={() => {
                  setRenameName(gcName);
                  setRenaming(true);
                }}
                className="hidden group-hover/gcn:inline-block absolute -right-5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs border-none bg-transparent cursor-pointer"
                title="Rename room"
              >
                ✎
              </button>
            )}
          </span>
        )}
        <span
          data-testid="message-count"
          className="text-[var(--text-muted)] text-xs"
        >
          — {messages.length} msg{messages.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <PinnedMessages messages={messages} onJumpToMessage={onJumpToMessage} />
          {!hideRoomActions && (
            <>
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
            </>
          )}
          <span className="cursor-block !h-3 !w-2" />
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-1.5 text-[var(--error)] text-sm my-1">
          <span className="flex-1">
            <span className="opacity-60">err: </span>
            {error}
          </span>
          {onClearError && (
            <button
              onClick={onClearError}
              className="shrink-0 text-[var(--error)] text-xs border border-[var(--error)]/40 px-1.5 py-0.5 bg-transparent cursor-pointer hover:bg-[var(--error)]/20 transition-colors"
              title="Dismiss"
            >
              ✕
            </button>
          )}
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
        {groups.map((group, idx) => (
          <React.Fragment key={group.key}>
            {/* Day divider — inserted when the calendar day changes. */}
            {dayBoundaries.has(idx) && (
              <div
                data-testid="day-divider"
                className="flex items-center gap-2 py-1.5 px-1"
              >
                <div className="flex-1 border-t border-[var(--border-primary)]/60" />
                <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap tracking-wider uppercase">
                  {formatDay(group.firstSentAt)}
                </span>
                <div className="flex-1 border-t border-[var(--border-primary)]/60" />
              </div>
            )}
            {/* Unread divider — only on entry with unread, dismissed once scrolled to bottom */}
            {!unreadDismissed && idx === unreadGroupIndex && (
              <div
                data-testid="unread-bar"
                className="flex items-center gap-2 py-1.5 px-1"
              >
                <div className="flex-1 border-t border-[var(--error)]/60" />
                <span className="text-[11px] text-[var(--error)] font-semibold whitespace-nowrap">
                  ── {unreadCount} new message{unreadCount === 1 ? "" : "s"} below ──
                </span>
                <div className="flex-1 border-t border-[var(--error)]/60" />
              </div>
            )}
            <MessageBubble
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
              onPinMessage={onPinMessage}
              onUnpinMessage={onUnpinMessage}
              highlightedMessageIds={highlightedMessageIds}
            />
          </React.Fragment>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* "Scroll to bottom" FAB — appears when scrolled far up */}
      {showScrollFab && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-[80px] right-6 z-10 text-xs border border-[var(--accent)] text-[var(--accent)] bg-[var(--bg-primary)] px-2.5 py-1 cursor-pointer hover:bg-[var(--accent)]/10 transition-colors shadow-md"
        >
          ↓ scroll to bottom
        </button>
      )}

      {/* Composer */}
      <MessageComposer
        onSend={handleComposerSend}
        replyTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onSlashCommand={onSlashCommand}
        memberNames={memberNames}
        viewerIsStaff={viewerIsStaff}
        viewerIsAdmin={viewerIsAdmin}
      />
    </div>
  );
}
