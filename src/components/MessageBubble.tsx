import { useState } from "react";
import type { Message, Reaction } from "../types";
import type { MessageGroup } from "../utils/format";
import { formatGroupTime } from "../utils/format";
import { MAX_MESSAGE_LENGTH } from "../constants";
import Avatar from "./Avatar";
import Markdown from "./Markdown";

/** Small fixed palette of reaction emojis. */
const EMOJI_OPTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉", "🔥"];

interface Props {
  group: MessageGroup;
  /** The logged-in user's id, for deciding whether to show edit/delete. */
  currentUserId: number | null;
  /** Whether the viewer is an admin or room staff. */
  viewerIsStaff: boolean;
  /** Whether the viewer is a site admin (can edit/delete any message). */
  viewerIsAdmin: boolean;
  onViewProfile: (username: string) => void;
  onEditMessage: (messageId: number, text: string) => void;
  onDeleteMessage: (messageId: number) => void;
  onReply: (message: Message) => void;
  onToggleReaction: (messageId: number, emoji: string) => void;
  /** Staff actions on a user: kick, ban, mute, mod, demod. */
  onModAction: (username: string, action: string) => void;
  /** Pin/unpin a message (staff only). */
  onPinMessage: (messageId: number) => void;
  onUnpinMessage: (messageId: number) => void;
  /** Set of message ids that @ping the current user. */
  highlightedMessageIds: ReadonlySet<number>;
}

/**
 * A single message group rendered in terminal style: an avatar + author line
 * with time, followed by indented message lines. Each line can carry a reply
 * quote, reactions, and (for your own messages) edit/delete controls.
 */
export default function MessageBubble({
  group,
  currentUserId,
  viewerIsStaff,
  viewerIsAdmin,
  onViewProfile,
  onEditMessage,
  onDeleteMessage,
  onReply,
  onToggleReaction,
  onModAction,
  onPinMessage,
  onUnpinMessage,
  highlightedMessageIds,
}: Props) {
  const time = formatGroupTime(group.firstSentAt);
  // True when any message in this group is pinned.
  const hasPinned = group.messages.some((m) => m.pinned === 1);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [nameMenuOpen, setNameMenuOpen] = useState(false);

  const startEdit = (message: Message) => {
    setEditingId(message.id);
    setDraft(message.message_text || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };

  const saveEdit = (message: Message) => {
    onEditMessage(message.id, draft.trim());
    setEditingId(null);
    setDraft("");
  };

  const confirmDelete = (message: Message) => {
    if (window.confirm("Delete this message?")) {
      onDeleteMessage(message.id);
    }
  };

  return (
    <div
      data-testid="message-bubble"
      className={`px-1 py-1 leading-relaxed ${
        hasPinned ? "bg-[var(--accent)]/5 border-l-2 border-[var(--accent)]/40" : ""
      }`}
    >
      {/* Author header: avatar + clickable name + time */}
      <div className="flex items-center gap-1.5 flex-wrap relative">
        {group.speaker ? (
          <span className="flex items-center gap-1.5">
            <span className="w-6 h-6 flex items-center justify-center text-xs border border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10 rounded-full">
              ✓
            </span>
            <span className="text-[var(--accent)] glow font-semibold">
              {group.displayName}
            </span>
            <span className="text-[10px] border px-1 py-0 border-[var(--accent)]/60 text-[var(--accent)] uppercase">
              {group.speaker}
            </span>
          </span>
        ) : (
          <button
            onClick={() => setNameMenuOpen((p) => !p)}
            data-testid="message-author"
            title={`${group.displayName} — click for actions`}
            className="flex items-center gap-1.5 p-0 border-none bg-transparent cursor-pointer text-left"
          >
            <Avatar name={group.displayName} src={group.avatarUrl} size={24} />
            <span className="text-[var(--accent)] glow font-semibold">
              {group.displayName}
            </span>
          </button>
        )}
        <span className="text-[var(--text-muted)] text-xs">
          {time && `[${time}]`}
        </span>

        {/* Name context menu */}
        {nameMenuOpen && (
          <div className="absolute top-full left-0 z-20 mt-1 min-w-[140px] border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl text-xs flex flex-col">
            <button
              onClick={() => {
                setNameMenuOpen(false);
                onViewProfile(group.displayName);
              }}
              className="px-2 py-1.5 text-left hover:bg-[var(--bg-tertiary)] text-[var(--text-primary)] cursor-pointer border-none bg-transparent"
            >
              view profile
            </button>
            {/* Staff menu: hidden in anon rooms unless viewer is admin, since
                display names are random and can't be resolved to users. */}
            {viewerIsStaff && (!group.username ? viewerIsAdmin : true) && (
              <>
                <div className="border-t border-[var(--border-primary)]" />
                {[
                  ["kick", "Kick"],
                  ["ban", "Ban"],
                ].map(([action, label]) => (
                  <button
                    key={action}
                    onClick={() => {
                      setNameMenuOpen(false);
                      onModAction(group.username ?? group.displayName, action);
                    }}
                    className="px-2 py-1 text-left hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer border-none bg-transparent"
                  >
                    {label}
                  </button>
                ))}
                <StaffToggleButton
                  labelOn="Unmute"
                  labelOff="Mute"
                  actionOn="unmute"
                  actionOff="mute"
                  displayName={group.username ?? group.displayName}
                  onModAction={onModAction}
                  closeMenu={() => setNameMenuOpen(false)}
                />
                <StaffToggleButton
                  labelOn="Demote mod"
                  labelOff="Promote mod"
                  actionOn="demod"
                  actionOff="mod"
                  displayName={group.username ?? group.displayName}
                  onModAction={onModAction}
                  closeMenu={() => setNameMenuOpen(false)}
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* Message lines */}
      <div className="pl-3 flex flex-col gap-1">
        {group.messages.map((msg, idx) => (
          <MessageLine
            key={msg.id ?? idx}
            message={msg}
            isOwn={
              viewerIsAdmin ||
              (currentUserId !== null &&
               msg.user_id !== null &&
               msg.user_id !== undefined &&
               msg.user_id === currentUserId)
            }
            canManage={viewerIsStaff || viewerIsAdmin}
            editing={editingId === msg.id}
            draft={draft}
            onStartEdit={() => startEdit(msg)}
            onSave={() => saveEdit(msg)}
            onCancelEdit={cancelEdit}
            onChangeDraft={setDraft}
            onDelete={() => confirmDelete(msg)}
            onReply={() => onReply(msg)}
            onToggleReaction={(emoji) => onToggleReaction(msg.id, emoji)}
            onPin={() => onPinMessage(msg.id)}
            onUnpin={() => onUnpinMessage(msg.id)}
            highlighted={highlightedMessageIds.has(msg.id)}
          />
        ))}
      </div>
    </div>
  );
}

interface LineProps {
  message: Message;
  isOwn: boolean;
  canManage: boolean;
  editing: boolean;
  draft: string;
  onStartEdit: () => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onChangeDraft: (value: string) => void;
  onDelete: () => void;
  onReply: () => void;
  onToggleReaction: (emoji: string) => void;
  onPin: () => void;
  onUnpin: () => void;
  highlighted: boolean;
}

function MessageLine({
  message,
  isOwn,
  canManage,
  editing,
  draft,
  onStartEdit,
  onSave,
  onCancelEdit,
  onChangeDraft,
  onDelete,
  onReply,
  onToggleReaction,
  onPin,
  onUnpin,
  highlighted,
}: LineProps) {
  const isPinned = message.pinned === 1;
  const [pickerOpen, setPickerOpen] = useState(false);
  const text = message.message_text || "";
  const gifUrl = message.gif_url;
  const fileUrl = message.file_url;
  const fileName = message.file_name || "attachment";
  const isImage = !!fileUrl && (message.file_type || "").startsWith("image/");
  const reactions: Reaction[] = message.reactions || [];

  if (editing) {
    return (
      <div className="flex flex-col gap-1" data-testid="message-editor">
        <textarea
          value={draft}
          onChange={(e) => onChangeDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onSave();
            }
            if (e.key === "Escape") {
              onCancelEdit();
            }
          }}
          maxLength={MAX_MESSAGE_LENGTH}
          autoFocus
          data-testid="edit-message-input"
          className="w-full max-w-[560px] box-border px-2 py-1.5 border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm leading-snug resize-none outline-none focus:border-[var(--accent)]"
        />
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={onSave}
            data-testid="edit-message-save"
            className="text-[var(--accent-light)] border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-0.5 hover:bg-[var(--bg-tertiary)] cursor-pointer"
          >
            [ save ]
          </button>
          <button
            onClick={onCancelEdit}
            data-testid="edit-message-cancel"
            className="text-[var(--text-muted)] border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-0.5 hover:text-[var(--text-primary)] cursor-pointer"
          >
            [ cancel ]
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="message-line"
      data-message-id={message.id}
      className={`group relative flex items-start gap-2 rounded-sm transition-colors hover:bg-[var(--bg-tertiary)] ${
        highlighted
          ? "bg-[var(--accent)]/10 border-l-2 border-[var(--accent)] pl-2 -ml-2"
          : ""
      }`}
    >
      {/* Content column */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* Reply quote */}
        {(message.reply_quote || message.reply_author) && (
          <div
            data-testid="message-reply"
            className="border-l-2 border-[var(--border-primary)] pl-2 text-xs text-[var(--text-muted)] max-w-[560px]"
          >
            <span className="text-[var(--accent-light)]">
              ↪ {message.reply_author || "unknown"}:
            </span>{" "}
            <span>{message.reply_quote}</span>
          </div>
        )}

        <div className="flex items-start gap-2 flex-wrap">
          {text && <Markdown text={text} />}
          {message.edited_at && (
            <span
              data-testid="edited-marker"
              className="text-[var(--text-muted)] text-xs self-center"
            >
              (edited)
            </span>
          )}
        </div>
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

        {/* Reaction chips are content — always visible. */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {reactions.map((r) => (
            <button
              key={r.emoji}
              onClick={() => onToggleReaction(r.emoji)}
              data-testid="reaction-chip"
              title={r.me ? "Remove your reaction" : "Add your reaction"}
              className={`inline-flex items-center gap-0.5 text-xs border px-1.5 py-0.5 cursor-pointer transition-colors ${
                r.me
                  ? "border-[var(--accent)] text-[var(--accent-light)] bg-[var(--accent)]/10"
                  : "border-[var(--border-primary)] text-[var(--text-secondary)] bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <span>{r.emoji}</span>
              <span>{r.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Hover actions — an icon menu revealed to the right of the message. */}
      <div
        data-testid="message-actions"
        className="absolute top-0 right-0 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
      >
        <ActionButton
          label="react"
          icon="😊"
          testId="react-message-button"
          onClick={() => setPickerOpen((p) => !p)}
        />
        <ActionButton
          label="reply"
          icon="↩️"
          testId="reply-message-button"
          onClick={onReply}
        />
        {canManage && (
          <ActionButton
            label={isPinned ? "unpin" : "pin"}
            icon="📌"
            testId={isPinned ? "unpin-message-button" : "pin-message-button"}
            active={isPinned}
            onClick={isPinned ? onUnpin : onPin}
          />
        )}
        {isOwn && (
          <>
            <ActionButton
              label="edit"
              icon="✏️"
              testId="edit-message-button"
              onClick={onStartEdit}
            />
            <ActionButton
              label="delete"
              icon="🗑️"
              testId="delete-message-button"
              danger
              onClick={onDelete}
            />
          </>
        )}
      </div>

      {/* Emoji picker, anchored under the action menu */}
      {pickerOpen && (
        <div className="absolute top-8 right-0 z-20 flex items-center gap-1 flex-wrap max-w-[240px] p-1 rounded-sm border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl">
          {EMOJI_OPTIONS.map((emoji) => (
            <button
              key={emoji}
              data-emoji={emoji}
              onClick={() => {
                onToggleReaction(emoji);
                setPickerOpen(false);
              }}
              className="h-7 w-7 flex items-center justify-center text-sm border border-[var(--border-primary)] bg-[var(--bg-secondary)] cursor-pointer hover:bg-[var(--bg-tertiary)]"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface ActionButtonProps {
  label: string;
  icon: string;
  onClick: () => void;
  testId?: string;
  danger?: boolean;
  active?: boolean;
}

/** A small icon action with a tooltip that appears above it on hover. */
function ActionButton({
  label,
  icon,
  onClick,
  testId,
  danger,
  active,
}: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      aria-label={label}
      className={`group/action relative flex items-center justify-center h-7 w-7 border bg-[var(--bg-secondary)] text-xs cursor-pointer transition-colors ${
        active
          ? "border-[var(--accent)]/60 text-[var(--accent-light)] hover:text-[var(--accent)] hover:border-[var(--accent)]"
          : danger
            ? "border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--error)] hover:border-[var(--error)]/60"
            : "border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--accent-light)] hover:border-[var(--accent)]/60"
      }`}
    >
      <span
        data-testid="action-tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 whitespace-nowrap text-[10px] text-[var(--text-primary)] bg-[var(--bg-secondary)] border border-[var(--border-primary)] px-1.5 py-0.5 rounded-sm opacity-0 group-hover/action:opacity-100 transition-opacity"
      >
        {label}
      </span>
      <span>{icon}</span>
    </button>
  );
}

interface ToggleButtonProps {
  labelOn: string;
  labelOff: string;
  actionOn: string;
  actionOff: string;
  displayName: string;
  onModAction: (username: string, action: string) => void;
  closeMenu: () => void;
}

function StaffToggleButton({
  labelOn,
  labelOff,
  actionOn,
  actionOff,
  displayName,
  onModAction,
  closeMenu,
}: ToggleButtonProps) {
  const [on, setOn] = useState(false);
  return (
    <button
      onClick={() => {
        closeMenu();
        setOn((p) => !p);
        onModAction(displayName, on ? actionOn : actionOff);
      }}
      className="px-2 py-1 text-left hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer border-none bg-transparent"
    >
      {on ? labelOn : labelOff}
    </button>
  );
}
