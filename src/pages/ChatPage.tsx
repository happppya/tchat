import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMessages } from "../hooks/useMessages";
import { useWebSocket } from "../hooks/useWebSocket";
import { useAuth } from "../hooks/useAuth";
import { useNotifications } from "./useNotifications";
import { deleteGroupChat, joinRoom, leaveRoom, roomCommand, renameRoom } from "../services/api";
import {
  removeGC,
  renameSavedGC,
  ROOM_RENAMED_EVENT,
} from "../services/storage";
import type { NotifSettings } from "../services/storage";
import Sidebar from "../components/Sidebar";
import ChatWindow from "../components/ChatWindow";
import ForumPage from "../components/ForumPage";
import ForumPostPage from "../components/ForumPostPage";
import CommandPalette from "../components/CommandPalette";
import ProfileModal from "../components/ProfileModal";
import SettingsModal from "../components/SettingsModal";
import ThemePicker from "../components/ThemePicker";
import NotificationToast from "../components/NotificationToast";
import PasswordPrompt from "./PasswordPrompt";
import TutorialPage from "../components/TutorialPage";
import ChangelogPage from "../components/ChangelogPage";
import type { CommandAction } from "../components/CommandPalette";
import { roomTypeFullNames } from "../utils/roomTypes";
import { errorMessage } from "../utils/format";
import type { WSMessage, FileAttachment } from "../types";

export default function ChatPage() {
  const [activeGCId, setActiveGCId] = useState<number | null>(null);
  const [activeForumPostId, setActiveForumPostId] = useState<number | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [profileUser, setProfileUser] = useState<string | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const navigate = useNavigate();
  const { user, logout, persistWarning } = useAuth();
  const [actionError, setActionError] = useState("");
  const [wsError, setWsError] = useState("");

  // ---- Notifications ----

  const {
    notifications,
    notifSettings,
    roomNotifs,
    mutedRooms,
    myDisplayNames,
    selectGcRef,
    dismissNotification,
    clearRoomNotifs,
    saveSettings,
    handleWSNotifications,
    handleToggleMute,
  } = useNotifications(activeGCId, user?.id ?? null);

  // ---- UI state ----

  // Settings modal toggle.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Theme picker overlay toggle.
  const [themePickerOpen, setThemePickerOpen] = useState(false);

  // Info page state — replaces the chat content area with tutorial or changelog.
  const [infoPage, setInfoPage] = useState<"tutorial" | "changelog" | null>(null);

  // Password prompt state — shown when a hidden room rejects join with "Invalid room password".
  const [passwordPrompt, setPasswordPrompt] = useState<{
    gcId: number;
    error?: string;
  } | null>(null);

  const handleSaveSettings = useCallback((s: NotifSettings) => {
    saveSettings(s);
    setSettingsOpen(false);
  }, [saveSettings]);

  /** Detect @pings in message text. Returns true if the text mentions the
   *  current user's display name in that room (or their real username).
   *  Also matches @everyone. */
  const isPingForMe = useCallback(
    (gcId: number, text: string | null | undefined): boolean => {
      if (!text) return false;
      const lower = text.toLowerCase();

      // @everyone pings everyone. Use (?:^|\s) instead of \b because
      // @ is a non-word character, so a word-boundary assert at the
      // start of a message (before the @) would silently fail.
      if (/(?:^|\s)@everyone\b/i.test(text)) return true;

      const displayName = myDisplayNames.current.get(gcId);
      const names = displayName ? [displayName] : [];
      if (user?.username) names.push(user.username);
      if (names.length === 0) return false;
      return names.some((n) => {
        const idx = lower.indexOf(`@${n.toLowerCase()}`);
        if (idx === -1) return false;
        // Must be word-bounded.
        const after = lower[idx + n.length + 1];
        return (
          after === undefined ||
          after === " " ||
          after === "\n" ||
          after === "." ||
          after === "," ||
          after === "!" ||
          after === "?" ||
          after === ":" ||
          after === ";"
        );
      });
    },
    [user?.username]
  );

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
    pinMessage,
    unpinMessage,
    lastReadId,
    markAllRead,
  } = useMessages(activeGCId, null);

  // Separate message state for the active forum post thread (if any).
  const forumMessages = useMessages(
    activeForumPostId !== null ? activeGCId : null,
    activeForumPostId
  );

  // Compute which messages @ping the current user in the active room.
  const highlightedMessageIds = useMemo(() => {
    const ids: number[] = [];
    for (const msg of messages) {
      if (
        activeGCId !== null &&
        msg.id > 0 &&
        isPingForMe(activeGCId, msg.message_text)
      ) {
        ids.push(msg.id);
      }
    }
    return new Set(ids);
  }, [messages, activeGCId, isPingForMe]);

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

      // Delegate notification logic (display-name tracking, toasts, desktop, badges).
      handleWSNotifications(msg, isPingForMe);

      handleWSMessage(msg);
      forumMessages.handleWSMessage(msg);
    },
    [handleWSMessage, forumMessages.handleWSMessage, activeGCId, user?.id, handleWSNotifications, isPingForMe]
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
          forumPostId: activeForumPostId ?? null,
        })
      );
    },
    [activeGCId, activeForumPostId, send]
  );

  const handleSelectGC = useCallback(async (id: number) => {
    setActionError("");
    setPasswordPrompt(null);
    try {
      await joinRoom(id);
    } catch (err) {
      const msg = errorMessage(err, "Could not join room");
      if (msg === "Invalid room password") {
        // Room exists but is password-protected; prompt for the password
        // instead of removing it from the sidebar immediately.
        setPasswordPrompt({ gcId: id });
        return;
      }
      setActionError(msg);
      removeGC(id);
      return;
    }
    setActiveGCId(id);
    setActiveForumPostId(null);
    // Reset notification counters for this room since the user just opened it.
    clearRoomNotifs(id);
    // Deliberately keep the sidebar open: closing it on room select made a
    // single click feel fine but a double-click (two room opens) feel like
    // the sidebar vanished, and reopening it later could squeeze the chat.
  }, []);
  selectGcRef.current = handleSelectGC;

  // Password prompt handlers.

  const handlePasswordSubmit = useCallback(
    async (password: string) => {
      if (!passwordPrompt) return;
      try {
        await joinRoom(passwordPrompt.gcId, password);
        // Success — dismiss the prompt and open the room.
        setPasswordPrompt(null);
        setActiveGCId(passwordPrompt.gcId);
      } catch (err) {
        setPasswordPrompt((p) => (p ? { ...p, error: errorMessage(err, "Could not join room") } : null));
      }
    },
    [passwordPrompt],
  );

  const handlePasswordCancel = useCallback(() => {
    if (passwordPrompt) {
      removeGC(passwordPrompt.gcId);
      setPasswordPrompt(null);
    }
  }, [passwordPrompt]);

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
      setActionError(errorMessage(err, "Failed to delete room"));
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
      setActionError(errorMessage(err, "Failed to leave room"));
    }
  }, [activeGCId, gcName]);

  const handleEditMessage = useCallback(
    async (messageId: number, text: string) => {
      try {
        await editMessage(messageId, text);
        setActionError("");
      } catch (err) {
        setActionError(errorMessage(err, "Failed to edit message"));
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
        setActionError(errorMessage(err, "Failed to rename room"));
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
        setActionError(errorMessage(err, `Command failed: ${command}`));
      }
    },
    [activeGCId, send, handleSelectGC, handleLeaveRoom]
  );

  // Generic room-command runner with error clearing.
  const runRoomCommand = useCallback(
    async (command: string, target: string) => {
      if (activeGCId === null) return;
      setActionError("");
      try {
        const res = await roomCommand(activeGCId, command, target);
        console.log(`[${command}]`, res.message);
      } catch (err) {
        setActionError(errorMessage(err, `${command} failed`));
      }
    },
    [activeGCId]
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
    (username: string, action: string) => {
      void runRoomCommand(action, username);
    },
    [runRoomCommand]
  );

  const handleDeleteMessage = useCallback(
    async (messageId: number) => {
      try {
        await deleteMessage(messageId);
        setActionError("");
      } catch (err) {
        setActionError(errorMessage(err, "Failed to delete message"));
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
        setActionError(errorMessage(err, "Failed to react"));
      }
    },
    [toggleReaction]
  );

  const handlePinMessage = useCallback(
    async (messageId: number) => {
      try {
        await pinMessage(messageId);
        setActionError("");
      } catch (err) {
        setActionError(errorMessage(err, "Failed to pin message"));
      }
    },
    [pinMessage]
  );

  const handleUnpinMessage = useCallback(
    async (messageId: number) => {
      try {
        await unpinMessage(messageId);
        setActionError("");
      } catch (err) {
        setActionError(errorMessage(err, "Failed to unpin message"));
      }
    },
    [unpinMessage]
  );

  /** Scroll the message list to a specific message by id. */
  const handleJumpToMessage = useCallback((messageId: number) => {
    // The message-line divs carry data-message-id attributes.
    // We need to wait a tick in case the popover hasn't closed yet.
    setTimeout(() => {
      const line = document.querySelector(
        `[data-testid="message-line"][data-message-id="${messageId}"]`
      );
      if (line) {
        line.scrollIntoView({ behavior: "smooth", block: "center" });
        // Briefly flash the message to draw attention.
        (line as HTMLElement).style.transition = "background-color 0.3s";
        (line as HTMLElement).style.backgroundColor = "var(--accent-light)";
        setTimeout(() => {
          (line as HTMLElement).style.backgroundColor = "";
        }, 1500);
      }
    }, 100);
  }, []);

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
        run: () => setSidebarVisible((v) => !v),
      },
      {
        id: "edit-profile",
        section: "Account",
        label: "Edit profile",
        keywords: "bio picture avatar",
        run: handleEditProfile,
      },
      {
        id: "notif-settings",
        section: "Settings",
        label: "Notification settings",
        keywords: "notifications badges pings toasts",
        run: () => setSettingsOpen(true),
      },
      {
        id: "choose-theme",
        section: "Settings",
        label: "Choose theme",
        keywords: "theme color appearance",
        run: () => setThemePickerOpen(true),
      },
      {
        id: "logout",
        section: "Account",
        label: "Log out",
        keywords: "signout exit quit",
        run: () => {
          logout();
          navigate("/login", { replace: true });
        },
      },
    ],
    [logout, navigate, handleEditProfile]
  );

  return (
    <div className="flex h-full">
      <Sidebar
        activeGCId={activeGCId}
        onSelectGC={handleSelectGC}
        onEditProfile={handleEditProfile}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        onShowTutorial={() => setInfoPage("tutorial")}
        onShowChangelog={() => setInfoPage("changelog")}
        roomNotifs={roomNotifs}
        notifSettings={notifSettings}
        mutedRooms={mutedRooms}
        onToggleMute={handleToggleMute}
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

      {/* Info pages — tutorial / changelog */}
      {infoPage === "tutorial" && (
        <TutorialPage onClose={() => setInfoPage(null)} />
      )}
      {infoPage === "changelog" && (
        <ChangelogPage onClose={() => setInfoPage(null)} />
      )}

      {/* Password prompt — shown when joining a hidden room */}
      {!infoPage && passwordPrompt && (
        <PasswordPrompt
          gcId={passwordPrompt.gcId}
          error={passwordPrompt.error}
          onSubmit={handlePasswordSubmit}
          onCancel={handlePasswordCancel}
        />
      )}

      {!infoPage && !passwordPrompt && activeGCId === null ? (
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
            <div className="mt-3 flex items-center gap-2 border border-[var(--error)]/40 bg-[var(--error)]/10 px-3 py-1.5 text-[var(--error)] text-sm">
              <span className="flex-1">{actionError}</span>
              <button
                onClick={() => setActionError("")}
                className="shrink-0 text-[var(--error)] text-xs border border-[var(--error)]/40 px-1.5 py-0.5 bg-transparent cursor-pointer hover:bg-[var(--error)]/20 transition-colors"
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          )}
          {!actionError && persistWarning && (
            <div className="mt-3 border border-[var(--warning, #b58900)]/40 bg-[var(--warning, #b58900)]/10 px-3 py-1.5 text-[var(--warning, #b58900)] text-sm max-w-md">
              {persistWarning}
            </div>
          )}
        </div>
      ) : !infoPage && !passwordPrompt ? (
        // Forum room: show ForumPage or ForumPostPage instead of ChatWindow.
        gcInfo?.is_forum ? (
          activeForumPostId !== null ? (
            <ForumPostPage
              key={`${activeGCId}-${activeForumPostId}`}
              groupChatId={activeGCId!}
              forumPostId={activeForumPostId}
              gcName={gcName}
              onClosePost={() => setActiveForumPostId(null)}
              viewerIsStaff={viewerIsStaff}
              viewerIsAdmin={!!user?.isAdmin}
              currentUserId={user?.id ?? null}
              onViewProfile={handleViewProfile}
              onJoinRoom={handleJoinRoom}
              onModAction={handleModAction}
              onRenameRoom={handleRenameRoom}
              isOwner={isOwner}
              roomTypeNames={gcInfo ? roomTypeFullNames(gcInfo) : []}
            />
          ) : (
            <ForumPage
              key={activeGCId}
              groupChatId={activeGCId!}
              gcName={gcName}
              onSelectPost={(id) => setActiveForumPostId(id)}
            />
          )
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
            lastReadId={lastReadId}
            onMarkAllRead={markAllRead}
            highlightedMessageIds={highlightedMessageIds}
            onClearError={() => { setActionError(""); setWsError(""); }}
            onPinMessage={handlePinMessage}
            onUnpinMessage={handleUnpinMessage}
            onJumpToMessage={handleJumpToMessage}
            groupChatId={activeGCId!}
          />
        )
      ) : null}

      <CommandPalette
        isOpen={paletteOpen}
        onClose={closePalette}
        actions={actions}
      />

      {/* Notification toasts — stacked bottom-right */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 pointer-events-none">
        {notifications.map((n) => (
          <div key={n.id} className="pointer-events-auto">
            <NotificationToast
              notification={n}
              onNavigate={handleSelectGC}
              onDismiss={dismissNotification}
            />
          </div>
        ))}
      </div>

      <ProfileModal
        username={profileUser}
        initialEditing={profileEditing}
        activeGCId={activeGCId}
        onClose={handleCloseProfile}
      />

      <SettingsModal
        isOpen={settingsOpen}
        settings={notifSettings}
        onSave={handleSaveSettings}
      />

      <ThemePicker
        isOpen={themePickerOpen}
        onClose={() => setThemePickerOpen(false)}
      />
    </div>
  );
}
