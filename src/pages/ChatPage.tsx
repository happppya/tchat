/** The main chat app page: composes sidebar + chat window (or forum views),
 *  owns the minigame overlay state, and wires the WebSocket message handler. */
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
import Sidebar from "../components/sidebar/Sidebar";
import ChatWindow from "../components/chat/ChatWindow";
import ForumPage from "../components/forum/ForumPage";
import ForumPostPage from "../components/forum/ForumPostPage";
import CommandPalette from "../components/ui/CommandPalette";
import ProfileModal from "../components/ui/ProfileModal";
import SettingsModal from "../components/ui/SettingsModal";
import ThemePicker from "../components/ui/ThemePicker";
import NotificationToast from "../components/ui/NotificationToast";
import PasswordPrompt from "./PasswordPrompt";
import TutorialPage from "../components/ui/TutorialPage";
import ChangelogPage from "../components/ui/ChangelogPage";
import type { CommandAction } from "../components/ui/CommandPalette";
import { roomTypeFullNames } from "../utils/roomTypes";
import { errorMessage } from "../utils/format";
import type {
  WSMessage,
  FileAttachment,
  GameInvitation,
  GameRole,
  GameSettings,
  ImpostorPlayView,
  CtfPlayView,
} from "../types";

export default function ChatPage() {
  const [activeGCId, setActiveGCId] = useState<number | null>(null);
  const [activeForumPostId, setActiveForumPostId] = useState<number | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  // Minigames (Phase 1): per-room active games from gameState broadcasts, plus
  // whichever game's overlay is currently open (soft leave closes it only).
  const [gamesByRoom, setGamesByRoom] = useState<
    Record<number, Record<string, GameInvitation>>
  >({});
  const [activeGame, setActiveGame] = useState<{
    gameId: string;
    roomId: number;
  } | null>(null);
  // Minigame gameplay (Phase 3): per-id in-progress play view, plus the
  // private role dealt to this viewer for the game they're in.
  const [playViews, setPlayViews] = useState<
    Record<string, ImpostorPlayView | CtfPlayView>
  >({});
  const [roles, setRoles] = useState<Record<string, GameRole>>({});
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [profileUser, setProfileUser] = useState<string | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const navigate = useNavigate();
  const { user, logout, persistWarning } = useAuth();
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
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

  // Clear transient banners when changing rooms.
  useEffect(() => {
    setWsError("");
    setActionError("");
    setActionNotice("");
  }, [activeGCId]);

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

  // Ref callback: ForumPostPage registers its own WS message handler here
  // so that ChatPage's single WS listener can forward messages to the
  // currently-open forum thread.
  const forumWSHandlerRef = useRef<(msg: WSMessage) => void>(() => {});
  const setForumWSHandler = useCallback((handler: (msg: WSMessage) => void) => {
    forumWSHandlerRef.current = handler;
  }, []);

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

      // Minigame broadcasts (Phase 1): keep the room's invitation cards and
      // any open overlay in sync. Handle before the message pipeline, which
      // ignores non-message types.
      if (
        msg.type === "gameState" &&
        msg.gameId &&
        msg.gameType &&
        Array.isArray(msg.participantIds)
      ) {
        const inv: GameInvitation = {
          type: "gameState",
          gameId: msg.gameId,
          gameType: msg.gameType,
          hostId: msg.hostId ?? "",
          groupChatId: msg.groupChatId,
          status: msg.status ?? "lobby",
          participantIds: msg.participantIds,
          inactivePlayerIds: msg.inactivePlayerIds ?? [],
        };
        setGamesByRoom((prev) => {
          const games = { ...(prev[msg.groupChatId] ?? {}) };
          games[inv.gameId] = inv;
          return { ...prev, [msg.groupChatId]: games };
        });
        if (
          pendingCreateOpenRef.current &&
          msg.groupChatId === activeGCId &&
          inv.hostId === String(user?.id ?? -1)
        ) {
          pendingCreateOpenRef.current = false;
          setActiveGame({ gameId: inv.gameId, roomId: msg.groupChatId });
        }
        return;
      }
      // The game starting is signalled by a gamePlay broadcast with status
      // "playing". Update the stored invitation so cards/overlay show it, and
      // keep the in-progress view for the gameplay panel (spec §5).
      if (msg.type === "gamePlay" && msg.gameId && msg.game && msg.phase) {
        const startedId = msg.gameId;
        const gid = startedId;
        const base = {
          type: "gamePlay" as const,
          gameId: gid,
          status: msg.status ?? "playing",
          round: msg.round ?? 1,
        };
        const play: ImpostorPlayView | CtfPlayView =
          msg.game === "complete-the-funny"
            ? {
                ...base,
                game: "complete-the-funny",
                phase: msg.phase as CtfPlayView["phase"],
                deadline: msg.deadline ?? null,
                prompts: msg.prompts ?? {},
                answered: msg.answered ?? {},
                phases: Array.isArray(msg.phases)
                  ? (msg.phases as CtfPlayView["phases"])
                  : null,
                leaderboard: msg.leaderboard ?? null,
              }
            : {
                ...base,
                game: "impostor",
                phase: msg.phase as ImpostorPlayView["phase"],
                turnPlayerId: msg.turnPlayerId ?? null,
                wordViewUntil: msg.wordViewUntil ?? null,
                hintDeadline: msg.hintDeadline ?? null,
                hints: msg.hints ?? {},
                votedOutId: msg.votedOutId ?? null,
                outcome: msg.outcome ?? null,
              };
        setPlayViews((prev) => ({ ...prev, [gid]: play }));
        setGamesByRoom((prev) => {
          for (const roomIdStr of Object.keys(prev)) {
            const roomId = Number(roomIdStr);
            const games = prev[roomId];
            if (games && games[startedId]) {
              return {
                ...prev,
                [roomId]: { ...games, [startedId]: { ...games[startedId], status: "playing" } },
              };
            }
          }
          return prev;
        });
        return;
      }
      // The private role is dealt to this viewer only (spec §5.4). It carries
      // the secret word (crewmate) or impostor hint, plus anon name.
      if (msg.type === "gameRole" && msg.gameId && msg.role) {
        const role: GameRole = {
          type: "gameRole",
          gameId: msg.gameId,
          role: msg.role,
          secretWord: msg.secretWord,
          hint: msg.hint,
          anonName: msg.anonName,
        };
        setRoles((prev) => ({ ...prev, [msg.gameId as string]: role }));
        return;
      }
      if (msg.type === "gameEnded") {
        const endedGameId = msg.gameId;
        if (endedGameId) {
          setGamesByRoom((prev) => {
            const roomGames = prev[msg.groupChatId];
            if (!roomGames || !roomGames[endedGameId]) return prev;
            const games = { ...roomGames };
            delete games[endedGameId];
            const next = { ...prev, [msg.groupChatId]: games };
            if (Object.keys(games).length === 0) delete next[msg.groupChatId];
            return next;
          });
          // Close the overlay if the ended game was open, and drop its play
          // view + role (the server deletes ended-game data, so do we).
          setActiveGame((cur) =>
            cur && cur.gameId === endedGameId ? null : cur
          );
        }
        if (endedGameId) {
          setPlayViews((prev) => {
            if (!prev[endedGameId]) return prev;
            const next = { ...prev };
            delete next[endedGameId];
            return next;
          });
          setRoles((prev) => {
            if (!prev[endedGameId]) return prev;
            const next = { ...prev };
            delete next[endedGameId];
            return next;
          });
        }
        return;
      }

      // Delegate notification logic (display-name tracking, toasts, desktop, badges).
      handleWSNotifications(msg, isPingForMe);

      handleWSMessage(msg);
      forumWSHandlerRef.current(msg);
    },
    [handleWSMessage, activeGCId, user?.id, handleWSNotifications, isPingForMe]
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

  // Game helpers (Phase 1).

  // Set when the user just created a game: open that game's overlay when its
  // first gameState arrives (spec §2.1: "lobby opens on send"). Only fires
  // once per create so later roster updates don't reopen a closed overlay.
  const pendingCreateOpenRef = useRef(false);

  /** Start a game by type id: the server joins the host + broadcasts gameState. */
  const handleCreateGame = useCallback(
    (gameType: string) => {
      if (activeGCId === null) return;
      pendingCreateOpenRef.current = true;
      send(
        JSON.stringify({ type: "gameCreate", gameType, groupChatId: activeGCId })
      );
    },
    [activeGCId, send]
  );

  /** Open a game from its invitation card: join or rejoin based on membership. */
  const handleOpenGame = useCallback(
    (gameId: string) => {
      if (activeGCId === null) return;
      const game = (gamesByRoom[activeGCId] ?? {})[gameId];
      if (!game) return;
      setActiveGame({ gameId, roomId: activeGCId });
      const isParticipant = game.participantIds.includes(String(user?.id ?? -1));
      send(
        JSON.stringify({
          type: isParticipant ? "gameRejoin" : "gameJoin",
          gameId,
        })
      );
    },
    [activeGCId, gamesByRoom, send, user?.id]
  );

  /** Host starts the game (spec §4), forwarding host-adjustable settings. */
  const handleStartGame = useCallback(
    (gameId: string, settings?: GameSettings) => {
      send(
        JSON.stringify({
          type: "gameStart",
          gameId,
          ...(settings && Object.keys(settings).length > 0 ? { settings } : {}),
        })
      );
    },
    [send]
  );

  // Gameplay actions (spec §5) — the server infers the actor from the WS
  // session, so the client only sends the frame type + game + payload.
  const handleGameHint = useCallback(
    (gameId: string, hint: string) => {
      send(JSON.stringify({ type: "gameHint", gameId, hint }));
    },
    [send]
  );
  const handleGameChoose = useCallback(
    (gameId: string, choice: "continue" | "vote") => {
      send(JSON.stringify({ type: "gameChoose", gameId, choice }));
    },
    [send]
  );
  const handleGameVote = useCallback(
    (gameId: string, votedForId: string) => {
      send(JSON.stringify({ type: "gameVote", gameId, votedForId }));
    },
    [send]
  );
  const handleGameGuess = useCallback(
    (gameId: string, guess: string) => {
      send(JSON.stringify({ type: "gameGuess", gameId, guess }));
    },
    [send]
  );

  // Complete the Funny gameplay actions (spec §6).
  const handleCtfAnswer = useCallback(
    (gameId: string, answers: string[]) => {
      send(JSON.stringify({ type: "gameAnswer", gameId, answers }));
    },
    [send]
  );
  const handleCtfVote = useCallback(
    (gameId: string, phaseIndex: number, answerId: string) => {
      send(JSON.stringify({ type: "gameVote", gameId, phaseIndex, answerId }));
    },
    [send]
  );

  /** Close the overlay — a soft leave; invitation card stays so they can rejoin. */
  const handleCloseGame = useCallback(() => setActiveGame(null), []);

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
        setActionNotice(res.message);
        console.log("[roomCommand]", res.message);
      } catch (err) {
        setActionNotice("");
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
        setActionError("");
        setActionNotice(res.message);
        console.log(`[${command}]`, res.message);
      } catch (err) {
        setActionNotice("");
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

  // One-click unmute from the muted-users panel. Awaits the server so the
  // panel can refresh its list afterwards.
  const handleUnmuteUser = useCallback(
    async (username: string) => {
      await runRoomCommand("unmute", username);
    },
    [runRoomCommand]
  );

  // One-click unban from the banned-users panel.
  const handleUnbanUser = useCallback(
    async (username: string) => {
      await runRoomCommand("unban", username);
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
        line.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
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

  // Minigame view state (Phase 1): invitation cards + the open overlay, both
  // scoped to the active room.
  const activeRoomGames =
    activeGCId !== null ? Object.values(gamesByRoom[activeGCId] ?? {}) : [];
  const activeOverlayGame: GameInvitation | null =
    activeGame && activeGame.roomId === activeGCId
      ? (gamesByRoom[activeGame.roomId] ?? {})[activeGame.gameId] ?? null
      : null;
  // Gameplay (Phase 3): the open overlay's in-progress view + this viewer's
  // private role, plus the identity the server keys them by (anon name in
  // anonymous rooms, else the row user id).
  const activePlayView: ImpostorPlayView | CtfPlayView | null =
    activeOverlayGame ? playViews[activeOverlayGame.gameId] ?? null : null;
  const activeRole: GameRole | null =
    activeOverlayGame ? roles[activeOverlayGame.gameId] ?? null : null;
  const activeMeId =
    activeRole?.anonName ?? (user?.id != null ? String(user.id) : "");

  return (
    // overflow-x: clip (not hidden): a wide child must never make the shell
    // row script-scrollable, or scrollIntoView() calls can drag the sidebar
    // out of view (the "room 0 closes the sidebar" bug).
    <div className="flex h-full overflow-x-clip">
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
              onSendMessage={handleSendMessage}
              registerWSHandler={setForumWSHandler}
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
            notice={actionNotice}
            onClearNotice={() => setActionNotice("")}
            roomId={activeGCId ?? 0}
            onUnmuteUser={handleUnmuteUser}
            onUnbanUser={handleUnbanUser}
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
            // Minigames (Phase 1)
            onCreateGame={handleCreateGame}
            games={activeRoomGames}
            activeGame={activeOverlayGame}
            onOpenGame={handleOpenGame}
            onStartGame={handleStartGame}
            onCloseGame={handleCloseGame}
            // Gameplay (Phase 3)
            activePlayView={activePlayView}
            activeRole={activeRole}
            activeMeId={activeMeId}
            onGameHint={handleGameHint}
            onGameChoose={handleGameChoose}
            onGameVote={handleGameVote}
            onGameGuess={handleGameGuess}
            onCtfAnswer={handleCtfAnswer}
            onCtfVote={handleCtfVote}
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
