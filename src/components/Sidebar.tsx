import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import type { GroupChat, SavedGC, LocalGroup, BoardGroup } from "../types";
import {
  getSavedGCs,
  removeGC,
  saveGCList,
  mergeSavedGCs,
  renameSavedGC,
  GCS_CHANGED_EVENT,
  ROOM_RENAMED_EVENT,
  getLocalGroups,
  saveLocalGroups,
  createLocalGroup,
  renameLocalGroup,
  deleteLocalGroup,
  addRoomToLocalGroup,
  removeRoomFromLocalGroup,
  moveLocalRoom,
  moveRoomToStart,
  moveRoomToEnd,
} from "../services/storage";
import {
  fetchMyRooms,
  fetchPublicRooms,
  fetchBoardGroups,
  createBoardGroup,
  renameBoardGroup,
  deleteBoardGroup,
  addRoomToBoardGroup,
  removeRoomFromBoardGroup,
  reorderBoardGroups,
  reorderBoardGroupRooms,
  renameRoom,
} from "../services/api";
import { useAuth } from "../hooks/useAuth";
import Avatar from "./Avatar";
import RoomButton from "./RoomButton";
import GroupHeader from "./GroupHeader";
import CreateGroupChat from "./CreateGroupChat";
import { MAX_GC_ID_DIGITS } from "../constants";
import { canRenameRoom } from "../utils/roomPerms";
import type { RoomNotifMap, NotifSettings } from "../services/storage";

interface Props {
  activeGCId: number | null;
  onSelectGC: (id: number) => void;
  onEditProfile: () => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  onShowTutorial?: () => void;
  onShowChangelog?: () => void;
  className?: string;
  /** Per-room unread notification counts for sidebar badges. */
  roomNotifs?: RoomNotifMap;
  /** Toggle settings controlling which badges to show. */
  notifSettings?: NotifSettings;
  /** Set of muted room IDs (suppress all notifications). */
  mutedRooms?: Set<number>;
  /** Called when the user toggles mute on a room. */
  onToggleMute?: (gcId: number) => void;
}

export default function Sidebar({
  activeGCId,
  onSelectGC,
  onEditProfile,
  onOpenSettings,
  onToggleSidebar,
  onShowTutorial,
  onShowChangelog,
  roomNotifs = {},
  notifSettings,
  mutedRooms,
  onToggleMute,
  className,
}: Props) {
  const [savedGCs, setSavedGCs] = useState<SavedGC[]>(getSavedGCs());
  const [localGroups, setLocalGroups] = useState<LocalGroup[]>(getLocalGroups());
  const [boardGroups, setBoardGroups] = useState<BoardGroup[]>([]);
  const [roomCode, setRoomCode] = useState("");
  const [tab, setTab] = useState<"myrooms" | "board">("myrooms");
  const [publicRooms, setPublicRooms] = useState<GroupChat[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string | number>>(new Set());
  const [renaming, setRenaming] = useState<{ id: string | number; name: string } | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [dragOverGroup, setDragOverGroup] = useState<string | number | null>(null);
  const [dragOverRoom, setDragOverRoom] = useState<number | null>(null);
  const [boardGroupsLoading, setBoardGroupsLoading] = useState(false);
  /** Server room records (owner ids) for rename permission checks. */
  const [memberRooms, setMemberRooms] = useState<GroupChat[]>([]);
  /** Room currently being renamed in-place in the list. */
  const [renamingRoom, setRenamingRoom] = useState<{ id: number; name: string } | null>(null);
  /** Transient action errors (room rename failures). */
  const [actionError, setActionError] = useState("");
  // Guards against Enter + blur both committing the same rename.
  const renamingRoomRef = useRef<{ id: number; name: string } | null>(null);
  // Prevent onClick from firing after a completed drag.
  const didDrag = useRef(false);
  // Context-menu state for right-click on rooms (mute/unmute).
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; roomId: number } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const newGroupRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const isAdmin = !!user?.isAdmin;

  // ---- Refresh helpers ----

  const refresh = useCallback(() => {
    setSavedGCs(getSavedGCs());
    setLocalGroups(getLocalGroups());
  }, []);

  useEffect(() => {
    const onFocus = () => {
      setSavedGCs(getSavedGCs());
      setLocalGroups(getLocalGroups());
    };
    const onGCsChanged = () => {
      setSavedGCs(getSavedGCs());
      setLocalGroups(getLocalGroups());
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(GCS_CHANGED_EVENT, onGCsChanged);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(GCS_CHANGED_EVENT, onGCsChanged);
    };
  }, []);

  // Merge server rooms into local cache on mount.
  useEffect(() => {
    let cancelled = false;
    fetchMyRooms()
      .then((serverRooms) => {
        if (cancelled) return;
        setMemberRooms(serverRooms);
        const merged = mergeSavedGCs(
          serverRooms.map((g) => ({ id: g.id, name: g.name })),
          getSavedGCs()
        );
        setSavedGCs(merged);
        saveGCList(merged);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the board's public-room list in sync when any client renames a room.
  useEffect(() => {
    const onRoomRenamed = (e: Event) => {
      const detail = (e as CustomEvent<{ id?: number; name?: string }>).detail;
      if (!detail?.id || !detail?.name) return;
      setPublicRooms((prev) =>
        prev.map((r) => (r.id === detail.id ? { ...r, name: detail.name! } : r))
      );
    };
    window.addEventListener(ROOM_RENAMED_EVENT, onRoomRenamed);
    return () => window.removeEventListener(ROOM_RENAMED_EVENT, onRoomRenamed);
  }, []);

  // ---- Tab handlers ----

  const loadPublicRooms = useCallback(async () => {
    setRoomsLoading(true);
    setRoomsError("");
    try {
      const [rooms, groups] = await Promise.all([
        fetchPublicRooms(),
        fetchBoardGroups().catch(() => [] as BoardGroup[]),
      ]);
      setPublicRooms(rooms);
      setBoardGroups(groups);
    } catch (err) {
      setRoomsError(err instanceof Error ? err.message : "Failed to load rooms");
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "board") {
      loadPublicRooms();
    }
  }, [tab, loadPublicRooms]);

  // ---- Room code ----

  const handleRoomCode = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const code = parseInt(roomCode, 10);
    if (!code) return;
    setRoomCode("");
    onSelectGC(code);
  };

  const handleRoomCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRoomCode(e.target.value.replace(/\D/g, "").slice(0, MAX_GC_ID_DIGITS));
  };

  // ---- Group CRUD ----

  const handleCreateGroup = () => {
    if (tab === "myrooms") {
      const g = createLocalGroup(newGroupName || "New Group");
      setLocalGroups(getLocalGroups());
      setNewGroupName("");
      setCreatingGroup(false);
    } else {
      // Board group: call API
      if (!newGroupName.trim()) return;
      setBoardGroupsLoading(true);
      createBoardGroup(newGroupName.trim())
        .then((g) => {
          setBoardGroups((prev) => [...prev, g]);
          setNewGroupName("");
          setCreatingGroup(false);
        })
        .catch((err) => setRoomsError(err instanceof Error ? err.message : "Failed"))
        .finally(() => setBoardGroupsLoading(false));
    }
  };

  const startRename = (id: string | number, currentName: string) => {
    if (tab === "board" && !isAdmin) return;
    setRenaming({ id, name: currentName });
  };

  const commitRename = () => {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) {
      setRenaming(null);
      return;
    }
    if (tab === "myrooms") {
      renameLocalGroup(renaming.id as string, name);
      setLocalGroups(getLocalGroups());
    } else {
      renameBoardGroup(renaming.id as number, name).then(() => {
        setBoardGroups((prev) =>
          prev.map((g) => (g.id === renaming.id ? { ...g, name } : g))
        );
      });
    }
    setRenaming(null);
  };

  const commitRoomRename = async () => {
    const pending = renamingRoomRef.current;
    renamingRoomRef.current = null;
    if (!pending) return;
    const { id, name: raw } = pending;
    const name = raw.trim();
    setRenamingRoom(null);
    if (!name) return;
    try {
      // The server enforces owner/admin; the WS echo then updates every client.
      await renameRoom(id, name);
      renameSavedGC(id, name);
      setSavedGCs(getSavedGCs());
      setPublicRooms((prev) =>
        prev.map((r) => (r.id === id ? { ...r, name } : r))
      );
      setActionError("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to rename room");
    }
  };

  const handleDeleteGroup = (id: string | number) => {
    if (tab === "myrooms") {
      deleteLocalGroup(id as string);
      setLocalGroups(getLocalGroups());
    } else {
      deleteBoardGroup(id as number).then(() => {
        setBoardGroups((prev) => prev.filter((g) => g.id !== id));
        loadPublicRooms();
      });
    }
  };

  // ---- Fold/unfold ----

  const toggleCollapse = (id: string | number) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ---- Drag and drop ----

  /** Whether the current tab allows the current user to reorder rooms/groups. */
  const canReorder = tab === "myrooms" || isAdmin;

  const handleDragStartRoom = (roomId: number) => {
    return (e: React.DragEvent) => {
      if (!canReorder) return;
      e.dataTransfer.setData("text/plain", String(roomId));
      e.dataTransfer.effectAllowed = "move";
      didDrag.current = true;
    };
  };

  const handleDragStartGroup = (groupId: string | number) => {
    return (e: React.DragEvent) => {
      if (!canReorder) return;
      e.dataTransfer.setData("application/group-id", String(groupId));
      e.dataTransfer.effectAllowed = "move";
      didDrag.current = true;
    };
  };

  const handleDragOverGroup = (groupId: string | number) => {
    return (e: React.DragEvent) => {
      if (!canReorder) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverGroup(groupId);
    };
  };

  const handleDragOverRoom = (e: React.DragEvent, roomId: number) => {
    if (!canReorder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverRoom(roomId);
  };

  const handleDragOverTop = (e: React.DragEvent) => {
    if (!canReorder) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverGroup(null);
  };

  const handleDragLeave = () => {
    setDragOverGroup(null);
    setDragOverRoom(null);
  };

  const handleDropOnGroup = (
    e: React.DragEvent,
    groupId: string | number
  ) => {
    e.preventDefault();
    // Don't let this drop bubble up to the room-list container, whose
    // onDrop would treat it as a "drop on top level" and undo the move.
    e.stopPropagation();
    setDragOverGroup(null);
    setDragOverRoom(null);
    didDrag.current = false;

    const roomIdStr = e.dataTransfer.getData("text/plain");
    const groupIdStr = e.dataTransfer.getData("application/group-id");

    if (roomIdStr) {
      const roomId = parseInt(roomIdStr, 10);
      if (!roomId) return;
      if (tab === "myrooms") {
        addRoomToLocalGroup(roomId, groupId as string);
        setLocalGroups(getLocalGroups());
      } else if (canReorder) {
        addRoomToBoardGroup(groupId as number, roomId).then(() => {
          setBoardGroups((prev) =>
            prev.map((g) => {
              if (g.id === groupId && !g.roomIds.includes(roomId)) {
                return { ...g, roomIds: [...g.roomIds, roomId] };
              }
              if (g.id !== groupId && g.roomIds.includes(roomId)) {
                return { ...g, roomIds: g.roomIds.filter((r) => r !== roomId) };
              }
              return g;
            })
          );
        });
      }
    } else if (groupIdStr) {
      const srcGroupId = groupIdStr;
      if (tab === "myrooms") {
        const groups = getLocalGroups();
        const srcIdx = groups.findIndex((g) => g.id === srcGroupId);
        const dstIdx = groups.findIndex((g) => g.id === String(groupId));
        if (srcIdx >= 0 && dstIdx >= 0) {
          const [moved] = groups.splice(srcIdx, 1);
          groups.splice(dstIdx, 0, moved);
          saveLocalGroups(groups);
          setLocalGroups(getLocalGroups());
        }
      } else if (canReorder) {
        const ids = boardGroups.map((g) => g.id);
        const parsedSrc = parseInt(srcGroupId, 10);
        const srcIdx = ids.indexOf(parsedSrc);
        const dstIdx = ids.indexOf(groupId as number);
        if (srcIdx >= 0 && dstIdx >= 0) {
          const [moved] = ids.splice(srcIdx, 1);
          ids.splice(dstIdx, 0, moved);
          setBoardGroups((prev) => {
            const map = new Map(prev.map((g) => [g.id, g]));
            return ids.map((id) => map.get(id)!).filter(Boolean);
          });
          reorderBoardGroups(ids);
        }
      }
    }
  };

  /** Move a room next to a board room (reorder within a group / top-level). */
  const handleBoardRoomDrop = async (draggedId: number, targetRoomId: number) => {
    const targetGroup = boardGroups.find((g) => g.roomIds.includes(targetRoomId));
    if (!targetGroup) {
      // Target is a top-level board room: spill dragged to top level
      // and reorder within the top-level list.
      const bGrouped = new Set(boardGroups.flatMap((g) => g.roomIds));
      const topLevel = publicRooms.filter((r) => !bGrouped.has(r.id));
      const draggedInTop = topLevel.some((r) => r.id === draggedId);

      if (!draggedInTop) {
        // Dragged room is in a group — spill it to top level.
        await removeRoomFromBoardGroup(draggedId);
        setBoardGroups((prev) =>
          prev.map((g) => ({
            ...g,
            roomIds: g.roomIds.filter((r) => r !== draggedId),
          }))
        );
      }

      // Client-side reorder: insert dragged room right before the target
      // in the top-level publicRooms list.
      setPublicRooms((prev) => {
        const without = prev.filter((r) => r.id !== draggedId);
        const idx = without.findIndex((r) => r.id === targetRoomId);
        if (idx < 0) return prev;
        const reordered = [...without];
        reordered.splice(idx, 0, prev.find((r) => r.id === draggedId)!);
        return reordered;
      });
      return;
    }
    const groupId = targetGroup.id;
    await addRoomToBoardGroup(groupId, draggedId);
    const ids = boardGroups.find((g) => g.id === groupId)?.roomIds ?? [];
    const newIds = ids.filter((r) => r !== draggedId);
    const idx = newIds.indexOf(targetRoomId);
    newIds.splice(idx >= 0 ? idx : newIds.length, 0, draggedId);
    await reorderBoardGroupRooms(groupId, newIds);
    setBoardGroups((prev) =>
      prev.map((g) => {
        if (g.id === groupId) return { ...g, roomIds: newIds };
        return { ...g, roomIds: g.roomIds.filter((r) => r !== draggedId) };
      })
    );
  };

  const handleDropOnRoom = (e: React.DragEvent, targetRoomId: number) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverRoom(null);
    setDragOverGroup(null);
    didDrag.current = false;

    const roomIdStr = e.dataTransfer.getData("text/plain");
    if (!roomIdStr) return;
    const draggedId = parseInt(roomIdStr, 10);
    if (!draggedId || draggedId === targetRoomId) return;

    if (tab === "myrooms") {
      const targetGroup = localGroups.find((g) => g.roomIds.includes(targetRoomId));
      moveLocalRoom(draggedId, targetRoomId, targetGroup ? targetGroup.id : null);
      setLocalGroups(getLocalGroups());
      setSavedGCs(getSavedGCs());
    } else if (canReorder) {
      void handleBoardRoomDrop(draggedId, targetRoomId);
    }
  };

  const handleDropOnTop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverGroup(null);
    setDragOverRoom(null);
    didDrag.current = false;

    const roomIdStr = e.dataTransfer.getData("text/plain");

    if (roomIdStr) {
      const roomId = parseInt(roomIdStr, 10);
      if (!roomId) return;
      if (tab === "myrooms") {
        removeRoomFromLocalGroup(roomId);
        setLocalGroups(getLocalGroups());
        setSavedGCs(getSavedGCs());
      } else if (canReorder) {
        removeRoomFromBoardGroup(roomId).then(() => {
          setBoardGroups((prev) =>
            prev.map((g) => ({
              ...g,
              roomIds: g.roomIds.filter((r) => r !== roomId),
            }))
          );
        });
      }
    }
  };

  const handleDropAtStart = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const roomIdStr = e.dataTransfer.getData("text/plain");
    if (!roomIdStr) return;
    const roomId = parseInt(roomIdStr, 10);
    if (!roomId) return;
    setDragOverGroup(null);
    setDragOverRoom(null);
    didDrag.current = false;
    if (tab === "myrooms") {
      removeRoomFromLocalGroup(roomId);
      moveRoomToStart(roomId);
      setLocalGroups(getLocalGroups());
      setSavedGCs(getSavedGCs());
    }
  };

  const handleDropAtEnd = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const roomIdStr = e.dataTransfer.getData("text/plain");
    if (!roomIdStr) return;
    const roomId = parseInt(roomIdStr, 10);
    if (!roomId) return;
    setDragOverGroup(null);
    setDragOverRoom(null);
    didDrag.current = false;
    if (tab === "myrooms") {
      removeRoomFromLocalGroup(roomId);
      moveRoomToEnd(roomId);
      setLocalGroups(getLocalGroups());
      setSavedGCs(getSavedGCs());
    }
  };

  const handleEndZoneDragOver = useCallback((e: React.DragEvent) => {
    if (!canReorder) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
  }, [canReorder]);

  // ---- Keyboard shortcuts ----

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Shift+G: create group in my-rooms tab only
      if (e.key === "G" && e.shiftKey && tab === "myrooms" && !creatingGroup) {
        // Don't fire when typing in an input.
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        setCreatingGroup(true);
        setNewGroupName("");
        setTimeout(() => newGroupRef.current?.focus(), 0);
      }
      // Escape: cancel rename / create
      if (e.key === "Escape") {
        if (renaming) setRenaming(null);
        if (creatingGroup) {
          setCreatingGroup(false);
          setNewGroupName("");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, creatingGroup, renaming]);

  // Dismiss context menu on any click outside it, or Escape.
  useEffect(() => {
    if (!ctxMenu) return;
    const dismiss = (e: MouseEvent) => {
      // Don't dismiss if the click is inside the context menu itself.
      if (ctxMenuRef.current?.contains(e.target as Node)) return;
      setCtxMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    window.addEventListener("click", dismiss, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", dismiss, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  // ---- Derive which rooms are in which groups ----

  const roomMap = new Map(savedGCs.map((gc) => [gc.id, gc]));

  // Rooms NOT in any local group (top-level).
  const localGroupedRoomIds = new Set(localGroups.flatMap((g) => g.roomIds));
  const topLevelRooms = savedGCs.filter((gc) => !localGroupedRoomIds.has(gc.id));

  // Board: rooms NOT in any board group.
  const boardGroupedRoomIds = new Set(boardGroups.flatMap((g) => g.roomIds));
  const topLevelBoardRooms = publicRooms.filter((r) => !boardGroupedRoomIds.has(r.id));

  // ---- Render helpers ----

  const renderRoom = (room: SavedGC | GroupChat, prefix: string) => {
    const canRename = canRenameRoom({
      tab,
      isAdmin,
      roomOwnerId: memberRooms.find((r) => r.id === room.id)?.owner_user_id,
      userId: user?.id ?? null,
    });
    const renamingThis = renamingRoom?.id === room.id;

    return (
      <RoomButton
        key={room.id}
        room={room}
        prefix={prefix}
        active={activeGCId === room.id}
        dragOver={dragOverRoom === room.id}
        canReorder={canReorder}
        showNotifBadges={tab === "myrooms"}
        canRename={canRename}
        showRemoveBtn={tab === "myrooms"}
        renamingThis={!!renamingThis}
        renamingName={renamingRoom?.name ?? ""}
        roomNotifCounts={roomNotifs}
        notifSettings={notifSettings}
        mutedRooms={mutedRooms}
        didDragRef={didDrag}
        onSelect={() => onSelectGC(room.id)}
        onDragStart={handleDragStartRoom(room.id)}
        onDragOver={(e) => handleDragOverRoom(e, room.id)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDropOnRoom(e, room.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!onToggleMute) return;
          setCtxMenu({ x: e.clientX, y: e.clientY, roomId: room.id });
        }}
        onRenameChange={(name) => {
          if (renamingRoomRef.current) {
            renamingRoomRef.current = { ...renamingRoomRef.current, name };
          }
          setRenamingRoom((prev) => prev ? { ...prev, name } : { id: room.id, name });
        }}
        onRenameKeyDown={(e) => {
          if (e.key === "Enter") void commitRoomRename();
          if (e.key === "Escape") {
            renamingRoomRef.current = null;
            setRenamingRoom(null);
          }
        }}
        onRenameBlur={() => void commitRoomRename()}
        onRenameClick={(e) => {
          e.stopPropagation();
          setRenamingRoom({ id: room.id, name: room.name });
          renamingRoomRef.current = { id: room.id, name: room.name };
        }}
        onRemoveClick={(e) => {
          e.stopPropagation();
          removeGC(room.id);
          refresh();
          if (activeGCId === room.id) onSelectGC(0);
        }}
        dataTestId={`${tab === "myrooms" ? "gc-button" : "public-room"}-${room.id}`}
        renameInputTestId={`rename-room-input-${room.id}`}
      />
    );
  };

  const renderGroup = (group: { id: string | number; name: string; roomIds: number[] }) => {
    const collapsed = collapsedGroups.has(group.id);
    const isDragTarget = dragOverGroup === group.id;
    return (
      <GroupHeader
        key={group.id}
        groupId={group.id}
        name={group.name}
        roomCount={group.roomIds.length}
        collapsed={collapsed}
        isDragTarget={isDragTarget}
        renaming={renaming?.id === group.id}
        renamingName={renaming?.name ?? ""}
        canReorder={canReorder}
        didDragRef={didDrag}
        onToggleCollapse={() => toggleCollapse(group.id)}
        onDragStart={handleDragStartGroup(group.id)}
        onDragOver={handleDragOverGroup(group.id)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDropOnGroup(e, group.id)}
        onRenameChange={(name) => setRenaming((prev) => prev ? { ...prev, name } : { id: group.id, name })}
        onRenameKeyDown={(e) => {
          if (e.key === "Enter") commitRename();
          if (e.key === "Escape") setRenaming(null);
        }}
        onRenameBlur={commitRename}
        onRenameClick={(e) => {
          e.stopPropagation();
          startRename(group.id, group.name);
        }}
        onDeleteClick={(e) => {
          e.stopPropagation();
          handleDeleteGroup(group.id);
        }}
      />
    );
  };

  // ---- Render ----

  const handleCreated = (id: number) => {
    refresh();
    onSelectGC(id);
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className={`term-panel flex flex-col m-1 overflow-hidden ${className ?? ""}`}>
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-[var(--border-primary)] flex items-start justify-between">
        <div>
          <h1 className="text-[var(--accent)] glow text-lg font-normal tracking-wide">
            tchat 1.1
          </h1>
          <div className="flex items-center gap-2 mt-0.5">
            <button
              onClick={onShowTutorial}
              className="text-[var(--text-muted)] text-[10px] border border-[var(--border-primary)] px-1.5 py-0.5 bg-transparent cursor-pointer hover:text-[var(--accent)] hover:border-[var(--accent)]/60 transition-colors"
            >
              tutorial
            </button>
            <button
              onClick={onShowChangelog}
              className="text-[var(--text-muted)] text-[10px] border border-[var(--border-primary)] px-1.5 py-0.5 bg-transparent cursor-pointer hover:text-[var(--accent)] hover:border-[var(--accent)]/60 transition-colors"
            >
              changelog
            </button>
          </div>
        </div>
        <button
          onClick={onToggleSidebar}
          title="Hide sidebar"
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-sm border-none bg-transparent cursor-pointer px-1.5 py-0.5 mt-0.5 transition-colors"
        >
          ◀
        </button>
      </div>

      <CreateGroupChat onCreated={handleCreated} />

      <div className="border-t border-[var(--border-primary)] my-2 mx-3" />

      {/* Room code input */}
      <div className="px-3 pb-2">
        <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest block mb-1">
          join room
        </label>
        <input
          type="number"
          placeholder={`code (1–${MAX_GC_ID_DIGITS} digits)`}
          value={roomCode}
          onChange={handleRoomCodeChange}
          onKeyDown={handleRoomCode}
          maxLength={MAX_GC_ID_DIGITS}
          data-testid="room-code-input"
          className="w-full border border-[var(--border-primary)] px-2 py-1.5 bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </div>

      {/* Tabs */}
      <div className="px-3 pt-1 pb-2 flex items-center gap-1">
        <button
          onClick={() => setTab("myrooms")}
          data-testid="tab-myrooms"
          className={`text-xs border px-2 py-1 cursor-pointer transition-colors ${
            tab === "myrooms"
              ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
              : "border-[var(--border-primary)] text-[var(--text-secondary)] bg-[var(--bg-secondary)]"
          }`}
        >
          my rooms
        </button>
        <button
          onClick={() => setTab("board")}
          data-testid="tab-board"
          className={`text-xs border px-2 py-1 cursor-pointer transition-colors ${
            tab === "board"
              ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
              : "border-[var(--border-primary)] text-[var(--text-secondary)] bg-[var(--bg-secondary)]"
          }`}
        >
          board
        </button>

        {/* New group button */}
        {canReorder && (
          <button
            onClick={() => {
              setCreatingGroup(true);
              setNewGroupName("");
              setTimeout(() => newGroupRef.current?.focus(), 0);
            }}
            title={
              tab === "board"
                ? "Create board group"
                : "Create group (Shift+G)"
            }
            className="ml-auto text-[var(--text-muted)] text-xs border-none bg-transparent cursor-pointer hover:text-[var(--text-primary)]"
          >
            [ +group ]
          </button>
        )}

        {tab === "board" && (
          <button
            onClick={loadPublicRooms}
            disabled={roomsLoading}
            data-testid="refresh-rooms"
            className="text-[var(--text-muted)] text-xs border-none bg-transparent cursor-pointer hover:text-[var(--text-primary)]"
          >
            {roomsLoading ? "[ … ]" : "[ refresh ]"}
          </button>
        )}
      </div>

      {/* New group input */}
      {creatingGroup && (
        <div className="px-3 pb-2">
          <div className="flex items-center gap-1">
            <input
              ref={newGroupRef}
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateGroup();
                if (e.key === "Escape") {
                  setCreatingGroup(false);
                  setNewGroupName("");
                }
              }}
              placeholder={tab === "board" ? "create board group" : "group name"}
              className="flex-1 min-w-0 bg-[var(--bg-secondary)] border border-[var(--accent)] px-2 py-1 text-xs text-[var(--text-primary)] outline-none"
            />
            <button
              onClick={handleCreateGroup}
              disabled={!newGroupName.trim() || boardGroupsLoading}
              className="text-[var(--accent)] text-xs border border-[var(--accent)] px-2 py-1 cursor-pointer hover:bg-[var(--accent)]/10 disabled:opacity-50"
            >
              ok
            </button>
            <button
              onClick={() => {
                setCreatingGroup(false);
                setNewGroupName("");
              }}
              className="text-[var(--text-muted)] text-xs border-none bg-transparent cursor-pointer"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Room list */}
      <div
        className="flex-1 overflow-y-auto px-2 pb-2"
        onDragOver={handleDragOverTop}
        onDragLeave={handleDragLeave}
        onDrop={handleDropOnTop}
        onDragEnd={() => { didDrag.current = false; setDragOverGroup(null); setDragOverRoom(null); }}
      >
        {/* Drop zone at the very top — drop a room here to move it to the start. */}
        {canReorder && (
          <div
            onDragOver={handleEndZoneDragOver}
            onDrop={handleDropAtStart}
            data-testid="drop-zone-start"
            className="h-1.5 my-0.5 border border-dashed border-[var(--border-primary)]/40"
          />
        )}

        {tab === "myrooms" ? (
          <>
            {/* Top-level rooms (not in any group) */}
            {topLevelRooms.map((gc) => renderRoom(gc, "·"))}

            {/* Groups with their rooms */}
            {localGroups.map((group) => (
              <div
                key={`group-${group.id}`}
                onDragOver={handleDragOverGroup(group.id)}
                onDrop={(e) => handleDropOnGroup(e, group.id)}
              >
                {renderGroup(group)}
                {!collapsedGroups.has(group.id) && (
                  <div className="ml-3">
                    {group.roomIds.map((roomId) => {
                      const gc = roomMap.get(roomId);
                      if (!gc) return null;
                      return renderRoom(gc, "·");
                    })}
                    {group.roomIds.length === 0 && (
                      <div className="text-[10px] text-[var(--text-muted)] px-2 py-1 italic">
                        drag rooms here
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {savedGCs.length === 0 && (
              <div className="text-center text-xs text-[var(--text-muted)] py-6 px-2">
                $ no rooms joined
              </div>
            )}
          </>
        ) : (
          <>
            {roomsError && (
              <div className="flex items-center gap-1.5 text-[var(--error)] text-xs px-2 py-1">
                <span className="flex-1">err: {roomsError}</span>
                <button
                  onClick={() => setRoomsError("")}
                  className="shrink-0 text-[var(--error)] text-[10px] border border-[var(--error)]/40 px-1 py-0.5 bg-transparent cursor-pointer hover:bg-[var(--error)]/20 transition-colors"
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Top-level board rooms (not in any group) */}
            {topLevelBoardRooms.map((room) => renderRoom(room, "§"))}

            {/* Board groups with their rooms */}
            {boardGroups.map((group) => (
              <div
                key={`bgroup-${group.id}`}
                onDragOver={handleDragOverGroup(group.id)}
                onDrop={(e) => handleDropOnGroup(e, group.id)}
              >
                {renderGroup(group)}
                {!collapsedGroups.has(group.id) && (
                  <div className="ml-3">
                    {group.roomIds.map((roomId) => {
                      const room = publicRooms.find((r) => r.id === roomId);
                      if (!room) return null;
                      return renderRoom(room, "§");
                    })}
                    {group.roomIds.length === 0 && isAdmin && (
                      <div className="text-[10px] text-[var(--text-muted)] px-2 py-1 italic">
                        drag rooms here
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {!roomsLoading &&
              !roomsError &&
              publicRooms.length === 0 &&
              boardGroups.length === 0 && (
                <div className="text-center text-xs text-[var(--text-muted)] py-6 px-2">
                  $ no rooms
                </div>
              )}
          </>
        )}

        {/* Drop zone at the very bottom — drop a room here to move it to the end. */}
        {canReorder && (
          <div
            onDragOver={handleEndZoneDragOver}
            onDrop={handleDropAtEnd}
            data-testid="drop-zone-end"
            className="h-1.5 my-0.5 border border-dashed border-[var(--border-primary)]/40"
          />
        )}
      </div>

      {/* User + logout footer */}
      <div className="border-t border-[var(--border-primary)] px-3 py-2 flex items-center gap-2">
        <Avatar name={user?.username ?? "?"} src={user?.picture_url ?? null} size={24} />
        <button
          onClick={onEditProfile}
          data-testid="profile-button"
          title="View / edit your profile"
          className="flex-1 min-w-0 flex items-center text-left border-none bg-transparent p-0 cursor-pointer group"
        >
          <span
            data-testid="current-user"
            className="text-[var(--accent)] text-xs break-all group-hover:text-[var(--accent-light)] transition-colors"
          >
            {user?.username ?? "—"}
          </span>
        </button>
        <button
          onClick={onOpenSettings}
          data-testid="settings-button"
          title="Notification settings"
          className="text-[var(--text-muted)] text-xs border-none bg-transparent cursor-pointer hover:text-[var(--text-primary)]"
        >
          ⚙
        </button>
        <button
          onClick={handleLogout}
          data-testid="logout-button"
          className="text-[var(--text-muted)] text-xs border border-[var(--border-primary)] px-2 py-1 hover:text-[var(--error)] hover:border-[var(--error)]/50 transition-colors cursor-pointer"
        >
          [ logout ]
        </button>
      </div>

      {/* Context menu — right-click on a room */}
      {ctxMenu && onToggleMute && (
        <div
          ref={ctxMenuRef}
          className="fixed z-50"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="term-panel min-w-[140px] border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-lg py-1 text-xs">
            <button
              onClick={() => {
                onToggleMute(ctxMenu.roomId);
                setCtxMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] border-none bg-transparent cursor-pointer"
            >
              {mutedRooms?.has(ctxMenu.roomId) ? "🔊 Unmute room" : "🔇 Mute room"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}