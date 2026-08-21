import { useState, useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMessages } from "../hooks/useMessages";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAuth } from "../hooks/useAuth";
import { deleteGroupChat, joinRoom, leaveRoom } from "../services/api";
import { removeGC } from "../services/storage";
import Sidebar from "../components/Sidebar";
import ChatWindow from "../components/ChatWindow";
import CommandPalette from "../components/CommandPalette";
import ProfileModal from "../components/ProfileModal";
import type { CommandAction } from "../components/CommandPalette";
import type { WSMessage, FileAttachment } from "../types";

export default function ChatPage() {
  const [activeGCId, setActiveGCId] = useState<number | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [profileUser, setProfileUser] = useState<string | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [actionError, setActionError] = useState("");

  const {
    messages,
    gcName,
    gcInfo,
    error,
    hasMore,
    loadingOlder,
    loadOlder,
    handleWSMessage,
  } = useMessages(activeGCId);

  // Wire WebSocket
  const handleWSIncoming = useCallback(
    (msg: WSMessage) => {
      if (msg.type === "error") {
        console.error("Server error:", msg.messageText);
        return;
      }
      handleWSMessage(msg);
    },
    [handleWSMessage]
  );

  const { send } = useWebSocket(handleWSIncoming);

  const handleSendMessage = useCallback(
    (text: string, gifUrl: string | null, file?: FileAttachment | null) => {
      if (!activeGCId) return;
      // The server sets displayNameText from the authenticated session, so we
      // don't send a client-supplied name (prevents identity spoofing).
      send(
        JSON.stringify({
          type: "message",
          groupChatId: activeGCId,
          messageText: text,
          gifUrl,
          fileUrl: file?.url ?? null,
          fileName: file?.name ?? null,
          fileType: file?.type ?? null,
        })
      );
    },
    [activeGCId, send]
  );

  const handleSelectGC = useCallback((id: number) => {
    setActiveGCId(id);
    setActionError("");
    // Selecting a room makes you a member (idempotent). Fire-and-forget so
    // the chat opens immediately; the server records the membership.
    if (id) joinRoom(id).catch(() => {});
    // On mobile, auto-close sidebar
    if (window.innerWidth < 768) {
      setSidebarVisible(false);
    }
  }, []);

  // Only the room's creator may delete it.
  const isOwner = !!user && !!gcInfo && gcInfo.owner_user_id === user.id;

  const handleDeleteRoom = useCallback(async () => {
    if (!activeGCId) return;
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
    if (!activeGCId) return;
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
        className={sidebarVisible ? "w-[240px] flex-shrink-0" : "hidden"}
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

      {!activeGCId ? (
        <div className="flex-1 flex items-center justify-center flex-col text-[var(--text-muted)] text-sm">
          <div className="flex items-center gap-2">
            <span className="text-[var(--accent)] glow">termchat</span>
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
        </div>
      ) : (
        <ChatWindow
          messages={messages}
          gcName={gcName}
          isOwner={isOwner}
          hasMore={hasMore}
          loadingOlder={loadingOlder}
          error={error || actionError}
          onSendMessage={handleSendMessage}
          onDeleteRoom={handleDeleteRoom}
          onLeaveRoom={handleLeaveRoom}
          onViewProfile={handleViewProfile}
          onLoadOlder={loadOlder}
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
        onClose={handleCloseProfile}
      />
    </div>
  );
}
