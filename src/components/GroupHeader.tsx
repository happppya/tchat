interface Props {
  groupId: string | number;
  name: string;
  roomCount: number;
  collapsed: boolean;
  isDragTarget: boolean;
  renaming: boolean;
  renamingName: string;
  canReorder: boolean;
  didDragRef: React.MutableRefObject<boolean>;
  onToggleCollapse: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onRenameChange: (name: string) => void;
  onRenameKeyDown: (e: React.KeyboardEvent) => void;
  onRenameBlur: () => void;
  onRenameClick: (e: React.MouseEvent) => void;
  onDeleteClick: (e: React.MouseEvent) => void;
}

export default function GroupHeader({
  groupId,
  name,
  roomCount,
  collapsed,
  isDragTarget,
  renaming,
  renamingName,
  canReorder,
  didDragRef,
  onToggleCollapse,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onRenameChange,
  onRenameKeyDown,
  onRenameBlur,
  onRenameClick,
  onDeleteClick,
}: Props) {
  return (
    <div
      key={`group-${groupId}`}
      draggable={canReorder}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`flex items-center gap-1 px-2 py-1 my-0.5 border-l-2 border-transparent cursor-pointer group/gh ${
        isDragTarget
          ? "!border-[var(--accent)] bg-[var(--accent)]/10"
          : "hover:bg-[var(--bg-tertiary)]"
      } transition-colors`}
    >
      {/* Fold/unfold toggle */}
      <button
        onClick={onToggleCollapse}
        className="text-[var(--text-muted)] text-xs border-none bg-transparent cursor-pointer w-4 text-center shrink-0"
      >
        {collapsed ? "▸" : "▾"}
      </button>

      {/* Name or rename input */}
      {renaming ? (
        <input
          autoFocus
          value={renamingName}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={onRenameKeyDown}
          onBlur={onRenameBlur}
          className="flex-1 min-w-0 bg-[var(--bg-secondary)] border border-[var(--accent)] px-1 py-0.5 text-xs text-[var(--text-primary)] outline-none"
        />
      ) : (
        <span className="flex-1 min-w-0 text-xs text-[var(--text-secondary)] font-semibold truncate">
          {name}
        </span>
      )}

      {/* Room count */}
      <span className="text-[10px] text-[var(--text-muted)] shrink-0">
        {roomCount}
      </span>

      {/* Hover actions (rename + delete) */}
      {canReorder && !renaming && (
        <span className="hidden group-hover/gh:inline-flex items-center gap-0.5 shrink-0">
          <button
            onClick={onRenameClick}
            title="Rename group"
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs border-none bg-transparent cursor-pointer px-0.5"
          >
            ✎
          </button>
          <button
            onClick={onDeleteClick}
            title="Delete group"
            className="text-[var(--text-muted)] hover:text-[var(--error)] text-xs border-none bg-transparent cursor-pointer px-0.5"
          >
            ✕
          </button>
        </span>
      )}
    </div>
  );
}