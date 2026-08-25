import { useState, useEffect, useCallback, useRef } from "react";
import type { ForumPost, FileAttachment } from "../types";
import { getForumPost, editForumPost as editForumPostApi, deleteForumPost as deleteForumPostApi } from "../services/api";
import { useMessages } from "../hooks/useMessages";
import type { WSMessage } from "../types";
import ChatWindow from "./ChatWindow";
import Markdown from "./Markdown";

interface Props {
  groupChatId: number;
  forumPostId: number;
  gcName: string;
  onClosePost: () => void;
  /** Whether the viewer is a room owner, mod, or admin. */
  viewerIsStaff: boolean;
  viewerIsAdmin: boolean;
  currentUserId: number | null;
  onViewProfile: (username: string) => void;
  onJoinRoom: (roomCode: number) => void;
  onModAction: (username: string, action: string) => void;
  onRenameRoom: (name: string) => void;
  isOwner: boolean;
  roomTypeNames: string[];
  onSendMessage: (text: string, gifUrl: string | null, file?: FileAttachment | null, replyToId?: number | null) => void;
  /** Called to register this thread's WS handler with the parent ChatPage. */
  registerWSHandler: (handler: (msg: WSMessage) => void) => void;
}

/**
 * Post detail view: the full title + content rendered as markdown,
 * followed by a full ChatWindow scoped to this thread (forumPostId).
 * The author, room owner, mod, or admin can edit or delete the post.
 */
export default function ForumPostPage({
  groupChatId,
  forumPostId,
  gcName,
  onClosePost,
  viewerIsStaff,
  viewerIsAdmin,
  currentUserId,
  onViewProfile,
  onJoinRoom,
  onModAction,
  onRenameRoom,
  isOwner,
  roomTypeNames,
  onSendMessage,
  registerWSHandler,
}: Props) {
  const [post, setPost] = useState<ForumPost | null>(null);
  const [loading, setLoading] = useState(true);

  // Editing state
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadPost = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    getForumPost(forumPostId)
      .then((p) => { if (!cancelled) { setPost(p); setEditTitle(p.title); setEditContent(p.content); } })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [forumPostId]);

  useEffect(loadPost, [loadPost]);

  // Messages for this thread
  const {
    messages,
    error: msgError,
    hasMore,
    loadingOlder,
    loadOlder,
    handleWSMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
    pinMessage,
    unpinMessage,
    lastReadId,
    markAllRead,
  } = useMessages(groupChatId, forumPostId);

  // Register this thread's WS handler with the parent so live messages
  // flow through ChatPage's single WebSocket listener.
  useEffect(() => {
    registerWSHandler(handleWSMessage);
    return () => registerWSHandler(() => {});
  }, [registerWSHandler, handleWSMessage]);

  // Decide who can manage this post
  const canManage =
    viewerIsAdmin ||
    viewerIsStaff ||
    (currentUserId !== null && post?.author_id === currentUserId);

  const handleStartEdit = () => {
    if (!post) return;
    setEditing(true);
    setEditTitle(post.title);
    setEditContent(post.content);
    setError("");
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setError("");
    // Restore original values
    if (post) {
      setEditTitle(post.title);
      setEditContent(post.content);
    }
  };

  const handleSaveEdit = async () => {
    if (!post || !editTitle.trim()) return;
    setSaving(true);
    setError("");
    try {
      const updated = await editForumPostApi(post.id, editTitle.trim(), editContent.trim());
      setPost(updated);
      setEditing(false);
    } catch (err: any) {
      setError(err?.message || "Failed to edit post");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!post) return;
    if (!window.confirm("Delete this post and all its replies?")) return;
    try {
      await deleteForumPostApi(post.id);
      onClosePost();
    } catch (err: any) {
      setError(err?.message || "Failed to delete post");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col flex-1 m-1 ml-0 min-h-0">
        <div className="px-3 py-4 text-center text-xs text-[var(--text-muted)]">loading post…</div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="flex flex-col flex-1 m-1 ml-0 min-h-0">
        <div className="px-3 py-4 text-center text-xs text-[var(--error)]">Post not found.</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 m-1 ml-0 min-h-0">
      {/* Post header bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <button
          onClick={onClosePost}
          title="Back to forum"
          className="text-[var(--text-muted)] hover:text-[var(--error)] text-xs border-none bg-transparent cursor-pointer px-1"
        >
          ✕
        </button>
        <span className="text-[var(--accent)]">~</span>
        {editing ? (
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSaveEdit();
              }
            }}
            className="flex-1 bg-[var(--bg-primary)] border border-[var(--accent)] px-2 py-0.5 text-sm text-[var(--text-primary)] outline-none"
            autoFocus
          />
        ) : (
          <span className="text-[var(--text-primary)] text-sm font-semibold truncate flex-1">
            {post.title}
          </span>
        )}
        {canManage && !editing && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleStartEdit}
              title="Edit post"
              className="text-[var(--text-muted)] hover:text-[var(--accent-light)] text-xs border border-[var(--border-primary)] px-1.5 py-0.5 bg-transparent cursor-pointer transition-colors"
            >
              edit
            </button>
            <button
              onClick={handleDelete}
              title="Delete post"
              className="text-[var(--text-muted)] hover:text-[var(--error)] text-xs border border-[var(--border-primary)] px-1.5 py-0.5 bg-transparent cursor-pointer transition-colors"
            >
              delete
            </button>
          </div>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 border-b border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-1 text-[var(--error)] text-xs">
          <span className="flex-1">{error}</span>
          <button onClick={() => setError("")} className="text-[var(--error)] cursor-pointer bg-transparent border-none text-xs">✕</button>
        </div>
      )}

      {/* Post content */}
      <div className="px-4 py-3 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <div className="text-xs text-[var(--text-muted)] mb-2">
          {post.display_name} · {new Date(post.created_at.replace(" ", "T") + "Z").toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
          {post.updated_at !== post.created_at && !editing && (
            <span className="ml-2 opacity-60">(edited)</span>
          )}
        </div>

        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full bg-[var(--bg-primary)] border border-[var(--border-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] resize-none"
              rows={6}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveEdit}
                disabled={saving || !editTitle.trim()}
                className="text-xs border border-[var(--accent)] text-[var(--accent)] bg-transparent px-2 py-0.5 cursor-pointer hover:bg-[var(--accent)]/10 transition-colors disabled:opacity-40 disabled:cursor-default"
              >
                {saving ? "saving…" : "save"}
              </button>
              <button
                onClick={handleCancelEdit}
                className="text-xs border border-[var(--border-primary)] text-[var(--text-muted)] bg-transparent px-2 py-0.5 cursor-pointer hover:text-[var(--text-primary)] transition-colors"
              >
                cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="text-sm text-[var(--text-primary)] leading-relaxed">
            <Markdown text={post.content} />
          </div>
        )}
        <div className="text-xs text-[var(--text-muted)] mt-2">
          {messages.length} repl{messages.length === 1 ? "y" : "ies"}
        </div>
      </div>

      {/* Thread chat — ChatWindow scoped to forumPostId */}
      <ChatWindow
        key={`${groupChatId}-${forumPostId}`}
        messages={messages}
        gcName={post.title}
        isOwner={isOwner}
        viewerIsStaff={viewerIsStaff}
        viewerIsAdmin={viewerIsAdmin}
        hasMore={hasMore}
        loadingOlder={loadingOlder}
        error={msgError}
        onSendMessage={onSendMessage}
        onDeleteRoom={() => {}}
        onLeaveRoom={() => {}}
        hideRoomActions
        onViewProfile={onViewProfile}
        onLoadOlder={loadOlder}
        onSlashCommand={() => {}}
        onJoinRoom={onJoinRoom}
        onModAction={onModAction}
        onUnmuteUser={(username) => onModAction(username, "unmute")}
        onUnbanUser={(username) => onModAction(username, "unban")}
        roomId={groupChatId}
        onRenameRoom={onRenameRoom}
        roomTypeNames={roomTypeNames}
        currentUserId={currentUserId}
        onEditMessage={editMessage}
        onDeleteMessage={deleteMessage}
        onToggleReaction={toggleReaction}
        lastReadId={lastReadId}
        onMarkAllRead={markAllRead}
        highlightedMessageIds={new Set()}
        onPinMessage={pinMessage}
        onUnpinMessage={unpinMessage}
        onJumpToMessage={() => {}}
      />
    </div>
  );
}