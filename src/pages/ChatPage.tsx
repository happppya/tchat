import { useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMessages } from "../hooks/useMessages";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAuth } from "../hooks/useAuth";
import { deleteGroupChat, joinRoom, leaveRoom, roomCommand, renameRoom } from "../services/api";
import { removeGC, renameSavedGC, ROOM_RENAMED_EVENT } from "../services/storage";
import Sidebar from "../components/Sidebar";
import ChatWindow from "../components/ChatWindow";
import CommandPalette from "../components/CommandPalette";
import ProfileModal from "../components/ProfileModal";
import type { CommandAction } from "../components/CommandPalette";
import { roomTypeFullNames } from "../utils/roomTypes";
import type { WSMessage, FileAttachment } from "../types";

export default function ChatPage() {
  const [activeGCId, setActiveGCId] = useState<number | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [profileUser, setProfileUser] = useState<string | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const navigate = useNavigate();
  const { user, logout, persistWarning } = useAuth();
  const [actionError, setActionError] = useState("");
  const [wsError, setWsError] = useState("");
  // Clear WS error when changing rooms.
  useEffect(() => { setWsError(""); }, [activeGCId]);

  const {
    messages,
    gcName,
    gcInfo,
    error,
    hasMore,
    loadingOlder,
    loadOlder,
    handleWSMessage,
    editMessage,
    deleteMessage,
    toggleReaction,
  } = useMessages(activeGCId);

  // Wire WebSocket
  const handleWSIncoming = useCallback(
    (msg: WSMessage) => {
      if (msg.type === "error") {
        setWsError(msg.messageText || "Something went wrong");
        return;
      }
      if (msg.type === "deleteRoom" && msg.groupChatId === activeGCId) {
        removeGC(msg.groupChatId);
        setActiveGCId(null);
        setActionError("This room was deleted.");
        return;
      }
      if (msg.type === "kicked" && msg.groupChatId === activeGCId) {
        removeGC(msg.groupChatId);
        setActiveGCId(null);
        setActionError(msg.message || "You were kicked from this room.");
        return;
      }
      if (msg.type === "banned") {
        if (msg.groupChatId === activeGCId) {
          removeGC(msg.groupChatId);
          setActiveGCId(null);
          setActionError(msg.message || "You were banned from this room.");
        } else {
          removeGC(msg.groupChatId);
        }
        return;
      }
      // A room rename is broadcast to everyone; keep the saved list + any
      // open board tabs in sync.
      if (msg.type === "renameRoom" && msg.groupChatId != null && msg.name) {
        renameSavedGC(msg.groupChatId, msg.name);
        window.dispatchEvent(
          new CustomEvent(ROOM_RENAMED_EVENT, {
            detail: { id: msg.groupChatId, name: msg.name },
          })
        );
        handleWSMessage(msg);
        return;
      }
      handleWSMessage(msg);
    },
    [handleWSMessage, activeGCId]
  );

  const { send } = useWebSocket(handleWSIncoming);

  const handleSendMessage = useCallback(
    (
      text: string,
      gifUrl: string | null,
      file?: FileAttachment | null,
      replyToId?: number | null
    ) => {
      if (activeGCId === null) return;
      // The server sets displayNameText from the authenticated session, so we
      // don't send a client-supplied name (prevents identity spoofing). The
      // reply target is resolved + quoted server-side too.
      send(
        JSON.stringify({
          type: "message",
          groupChatId: activeGCId,
          messageText: text,
          gifUrl,
          fileUrl: file?.url ?? null,
          fileName: file?.name ?? null,
          fileType: file?.type ?? null,
          replyToId: replyToId ?? null,
        })
      );
    },
    [activeGCId, send]
  );

  const handleSelectGC = useCallback(async (id: number) => {
    setActionError("");
    try {
      await joinRoom(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not join room");
      removeGC(id);
      return;
    }
    setActiveGCId(id);
    // Deliberately keep the sidebar open: closing it on room select made a
    // single click feel fine but a double-click (two room opens) feel like
    // the sidebar vanished, and reopening it later could squeeze the chat.
  }, []);

  // Only the room's creator may delete it.
  const isOwner = !!user && !!gcInfo && gcInfo.owner_user_id === user.id;

  // Whether the current user is admin or room staff for mod actions.
  const viewerIsStaff = !!user?.isAdmin || !!(gcInfo as any)?.viewer_is_staff;

  const handleDeleteRoom = useCallback(async () => {
    if (activeGCId === null) return;
    if (
      !window.confirm(
        `Delete room "${gcName}"? All of its messages will be removed.`
      )
    ) {
      return;
    }
    try {
      await deleteGroupChat(activeGCId);
      removeGC(activeGCId);
      setActiveGCId(null);
      setActionError("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete room");
    }
  }, [activeGCId, gcName]);

  const handleLeaveRoom = useCallback(async () => {
    if (activeGCId === null) return;
    if (!window.confirm(`Leave room "${gcName}"?`)) return;
    try {
      await leaveRoom(activeGCId);
      removeGC(activeGCId);
      setActiveGCId(null);
      setActionError("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to leave room");
    }
  }, [activeGCId, gcName]);

  const handleEditMessage = useCallback(
    async (messageId: number, text: string) => {
      try {
        await editMessage(messageId, text);
        setActionError("");
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Failed to edit message"
        );
      }
    },
    [editMessage]
  );

  const handleRenameRoom = useCallback(
    async (name: string) => {
      if (activeGCId === null) return;
      try {
        await renameRoom(activeGCId, name);
        setActionError("");
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Failed to rename room"
        );
      }
    },
    [activeGCId]
  );

  // Slash command handler: delegates to the roomCommand API.
  const handleSlashCommand = useCallback(
    async (command: string, arg: string) => {
      if (activeGCId === null) return;
      setActionError("");
      // join/leave are handled client-side.
      if (command === "join") {
        const code = parseInt(arg.replace(/^#/, ""), 10);
        if (code) await handleSelectGC(code);
        return;
      }
      if (command === "leave") {
        await handleLeaveRoom();
        return;
      }
      // /help is sent via WebSocket so the server builds the message.
      if (command === "help") {
        const page = parseInt(arg, 10) || 1;
        send(JSON.stringify({ type: "help", groupChatId: activeGCId, page }));
        return;
      }
      try {
        const res = await roomCommand(activeGCId, command, arg);
        setActionError("");
        console.log("[roomCommand]", res.message);
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : `Command failed: ${command}`
        );
      }
    },
    [activeGCId, send, handleSelectGC, handleLeaveRoom]
  );

  // Room link handler from [#12345] in messages.
  const handleJoinRoom = useCallback(
    (roomCode: number) => {
      handleSelectGC(roomCode);
    },
    [handleSelectGC]
  );

  // Mod action from the name-click context menu.
  const handleModAction = useCallback(
    async (username: string, action: string) => {
      if (activeGCId === null) return;
      setActionError("");
      try {
        const res = await roomCommand(activeGCId, action, username);
        console.log("[modAction]", res.message);
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : `Action failed: ${action}`
        );
      }
    },
    [activeGCId]
  );

  const handleDeleteMessage = useCallback(
    async (messageId: number) => {
      try {
        await deleteMessage(messageId);
        setActionError("");
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Failed to delete message"
        );
      }
    },
    [deleteMessage]
  );

  const handleToggleReaction = useCallback(
    async (messageId: number, emoji: string) => {
      try {
        await toggleReaction(messageId, emoji);
        setActionError("");
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : "Failed to react"
        );
      }
    },
    [toggleReaction]
  );

  const handleViewProfile = useCallback((username: string) => {
    setProfileUser(username);
    setProfileEditing(false);
  }, []);

  const handleEditProfile = useCallback(() => {
    if (!user) return;
    setProfileUser(user.username);
    setProfileEditing(true);
  }, [user]);

  const handleCloseProfile = useCallback(() => {
    setProfileUser(null);
    setProfileEditing(false);
  }, []);

  // Global backtick (`) listener to open the command palette.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "`") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        // Don't intercept when typing in an input/textarea — but allow it when
        // the palette itself is open (so the palette's input can handle it).
        if (paletteOpen) return;
        if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
          return;
        }
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [paletteOpen]);

  // Esc / closing the palette also handled inside the palette. Also close on
  // backtick when the palette is open + focused in its search (it will type it,
  // so we additionally let Esc close).
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  // App-level actions for the palette.
  const actions: CommandAction[] = useMemo(
    () => [
      {
        id: "toggle-sidebar",
        section: "View",
        label: "Toggle sidebar",
        shortcut: "`",
        run: () => setSidebarVisible((v) => !v),
      },
      {
        id: "close-sidebar",
        section: "View",
        label: "Hide sidebar",
        run: () => setSidebarVisible(false),
      },
      {
        id: "open-sidebar",
        section: "View",
        label: "Show sidebar",
        run: () => setSidebarVisible(true),
      },
      {
        id: "edit-profile",
        section: "Account",
        label: "Edit profile",
        keywords: "bio picture avatar",
        run: handleEditProfile,
      },
      {
        id: "logout",
        section: "Account",
        label: "Log out",
        keywords: "signout signout exit quit",
        run: () => {
          logout();
          navigate("/login", { replace: true });
        },
      },
    ],
    // logout + navigate are stable; refresh identity when they change
    [logout, navigate, handleEditProfile]
  );

  return (
    <div className="flex h-full">
      <Sidebar
        activeGCId={activeGCId}
        onSelectGC={handleSelectGC}
        onEditProfile={handleEditProfile}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        className={sidebarVisible ? "w-[264px] flex-shrink-0" : "hidden"}
      />
      {!sidebarVisible && (
        <button
          onClick={() => setSidebarVisible((v) => !v)}
          className="h-[50px] w-[44px] text-[var(--accent)] border-none bg-transparent cursor-pointer m-0.5 flex-shrink-0 hover:text-[var(--accent-light)] transition-colors"
          title="Toggle sidebar"
        >
          ☰
        </button>
      )}

      {activeGCId === null ? (
        <div className="flex-1 flex items-center justify-center flex-col text-[var(--text-muted)] text-sm">
          <div className="flex items-center gap-2">
            <span className="text-[var(--accent)] glow">tchat</span>
            <span className="text-[var(--text-muted)]">—</span>
            <span className="opacity-70">no channel selected</span>
          </div>
          <div className="mt-3 text-xs opacity-50 flex items-center gap-1.5">
            <span>press</span>
            <kbd className="border border-[var(--border-primary)] px-1.5 py-0.5 text-[var(--text-secondary)]">
              `
            </kbd>
            <span>for commands · select a channel to begin</span>
          </div>
          {actionError && (
            <div className="mt-3 border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-1.5 text-[var(--error)] text-sm">
              {actionError}
            </div>
          )}
          {!actionError && persistWarning && (
            <div className="mt-3 border border-[var(--warning, #b58900)]/40 bg-[var(--warning, #b58900)]/10 px-3 py-1.5 text-[var(--warning, #b58900)] text-sm max-w-md">
              {persistWarning}
            </div>
          )}
        </div>
      ) : (
        <ChatWindow
          key={activeGCId}
          messages={messages}
          gcName={gcName}
          isOwner={isOwner}
          viewerIsStaff={viewerIsStaff}
          viewerIsAdmin={!!user?.isAdmin}
          hasMore={hasMore}
          loadingOlder={loadingOlder}
          error={error || actionError || wsError}
          onSendMessage={handleSendMessage}
          onDeleteRoom={handleDeleteRoom}
          onLeaveRoom={handleLeaveRoom}
          onViewProfile={handleViewProfile}
          onLoadOlder={loadOlder}
          onSlashCommand={handleSlashCommand}
          onJoinRoom={handleJoinRoom}
          onModAction={handleModAction}
          onRenameRoom={handleRenameRoom}
          roomTypeNames={gcInfo ? roomTypeFullNames(gcInfo) : []}
          currentUserId={user?.id ?? null}
          onEditMessage={handleEditMessage}
          onDeleteMessage={handleDeleteMessage}
          onToggleReaction={handleToggleReaction}
        />
      )}

      <CommandPalette
        isOpen={paletteOpen}
        onClose={closePalette}
        actions={actions}
      />

      <ProfileModal
        username={profileUser}
        initialEditing={profileEditing}
        activeGCId={activeGCId}
        onClose={handleCloseProfile}
      />
    </div>
  );
}
