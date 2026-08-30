/** A single room row in the sidebar: select, drag-and-drop, context menu. */
import type { GroupChat, SavedGC } from "../../types";
import type { RoomNotifMap, NotifSettings } from "../../services/storage";
import { roomTypeTags } from "../../utils/roomTypes";

interface Props {
  room: SavedGC | GroupChat;
  prefix: string;
  active: boolean;
  dragOver: boolean;
  canReorder: boolean;
  showNotifBadges: boolean;
  canRename: boolean;
  showRemoveBtn: boolean;
  renamingThis: boolean;
  renamingName: string;
  roomNotifCounts: RoomNotifMap;
  notifSettings: NotifSettings | undefined;
  mutedRooms: Set<number> | undefined;
  /** Shared ref that dragStart sets to true; click checks it to prevent opening after a drag. */
  didDragRef: React.MutableRefObject<boolean>;
  onSelect: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameChange: (name: string) => void;
  onRenameKeyDown: (e: React.KeyboardEvent) => void;
  onRenameBlur: () => void;
  onRenameClick: (e: React.MouseEvent) => void;
  onRemoveClick: (e: React.MouseEvent) => void;
  dataTestId: string;
  renameInputTestId: string;
}

export default function RoomButton({
  room,
  prefix,
  active,
  dragOver,
  canReorder,
  showNotifBadges,
  canRename,
  showRemoveBtn,
  renamingThis,
  renamingName,
  roomNotifCounts,
  notifSettings,
  mutedRooms,
  didDragRef,
  onSelect,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onContextMenu,
  onRenameChange,
  onRenameKeyDown,
  onRenameBlur,
  onRenameClick,
  onRemoveClick,
  dataTestId,
  renameInputTestId,
}: Props) {
  const muted = mutedRooms?.has(room.id) ?? false;

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={canReorder}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onMouseDown={() => { didDragRef.current = false; }}
      onClick={() => {
        if (didDragRef.current) return;
        onSelect();
      }}
      onContextMenu={onContextMenu}
      data-testid={dataTestId}
      className={`group/room flex items-center w-full text-left px-2 py-1.5 my-0.5 border-l-2 border-transparent text-[var(--text-secondary)] text-sm bg-transparent cursor-pointer hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors ${
        active
          ? "!border-[var(--accent)] !text-[var(--text-primary)] !bg-[var(--bg-tertiary)]"
          : ""
      } ${
        dragOver
          ? "!border-[var(--accent)] bg-[var(--accent)]/10"
          : ""
      }`}
    >
      <span className="text-[var(--accent)] mr-1">
        {active ? ">" : prefix}
      </span>
      {renamingThis ? (
        <input
          autoFocus
          value={renamingName}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={onRenameKeyDown}
          onBlur={onRenameBlur}
          data-testid={renameInputTestId}
          className="flex-1 min-w-0 bg-[var(--bg-secondary)] border border-[var(--accent)] px-1 py-0.5 text-sm text-[var(--text-primary)] outline-none"
        />
      ) : (
        <>
          {room.name}
          <span className="pl-1 text-[10px] text-[var(--text-muted)]">
            #{room.id}
          </span>
          {"is_hidden" in room && (
            <span className="ml-1">
              {roomTypeTags(room as GroupChat).map((t) => (
                <span
                  key={t.code}
                  className="text-[10px] text-[var(--text-muted)]"
                >
                  {t.code}
                </span>
              ))}
            </span>
          )}
        </>
      )}
      {/* Muted indicator */}
      {!renamingThis && muted && (
        <span
          title="Notifications muted"
          className="shrink-0 text-[var(--text-muted)] text-[10px] ml-1"
        >
          🔇
        </span>
      )}
      {/* Notification badges */}
      {!renamingThis && showNotifBadges && notifSettings && (() => {
        const counts = roomNotifCounts[room.id];
        if (!counts || (counts.general === 0 && counts.important === 0)) return null;
        return (
          <span className="inline-flex items-center shrink-0 ml-auto gap-1">
            {notifSettings.showGeneralBadges && counts.general > 0 && (
              <span
                data-testid={`unread-general-${room.id}`}
                className="text-[10px] text-[var(--text-muted)] bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded px-1 leading-tight"
              >
                {counts.general}
              </span>
            )}
            {notifSettings.showImportantBadges && counts.important > 0 && (
              <span
                data-testid={`unread-important-${room.id}`}
                className="text-[10px] text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/60 rounded px-1 leading-tight font-semibold"
              >
                {counts.important}
              </span>
            )}
          </span>
        );
      })()}
      {!renamingThis && (canRename || showRemoveBtn) && (
        <span className="hidden group-hover/room:inline-flex items-center shrink-0 ml-auto gap-0.5">
          {canRename && (
            <button
              draggable={false}
              onClick={onRenameClick}
              title="Rename room"
              data-testid={`rename-room-${room.id}`}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs border-none bg-transparent cursor-pointer px-1"
            >
              ✎
            </button>
          )}
          {showRemoveBtn && (
            <button
              draggable={false}
              onClick={onRemoveClick}
              title="Remove room"
              data-testid={`remove-room-${room.id}`}
              className="text-[var(--text-muted)] hover:text-[var(--error)] text-xs border-none bg-transparent cursor-pointer px-1"
            >
              ✕
            </button>
          )}
        </span>
      )}
    </div>
  );
}