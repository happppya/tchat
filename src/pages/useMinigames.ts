import { useCallback, useRef, useState } from "react";
import type {
  WSMessage,
  GameInvitation,
  GameRole,
  GameSettings,
  ImpostorPlayView,
  CtfPlayView,
} from "../types";

export interface MinigameHandle {
  /** All invitation cards in the active room (derived from gameState frames). */
  activeRoomGames: GameInvitation[];
  /** The game whose overlay is currently open, if any. */
  activeOverlayGame: GameInvitation | null;
  /** In-progress play view for the open overlay (spec §5/§6). */
  activePlayView: ImpostorPlayView | CtfPlayView | null;
  /** Private role dealt to the viewer for the open overlay. */
  activeRole: GameRole | null;
  /** True when the open game has ended (overlay stays open for result). */
  activeGameEnded: boolean;
  /** The viewer's display identity — anon name in anonymous rooms, else id. */
  activeMeId: string;
  /** Consume a game frame (gameState/gamePlay/gameRole/gameEnded). Returns
   *  true when the frame was a minigame frame and should stop propagation. */
  handleGameFrame: (msg: WSMessage) => boolean;
  handleCreateGame: (gameType: string) => void;
  handleOpenGame: (gameId: string) => void;
  handleStartGame: (gameId: string, settings?: GameSettings | undefined) => void;
  handleGameHint: (gameId: string, hint: string) => void;
  handleGameChoose: (gameId: string, choice: "continue" | "vote") => void;
  handleGameVote: (gameId: string, votedForId: string) => void;
  handleGameGuess: (gameId: string, guess: string) => void;
  handleCtfAnswer: (gameId: string, answers: string[]) => void;
  handleCtfVote: (gameId: string, phaseIndex: number, answerId: string) => void;
  handleCloseGame: () => void;
}

/**
 * Minigame client state for the active room: invitation cards, the open
 * overlay, in-progress play views, and this viewer's private roles. Owns the
 * game-frame handling (gameState/gamePlay/gameRole/gameEnded) and all the
 * gameplay actions that send frames. Extracted from ChatPage so the page
 * stays readable.
 */
export function useMinigames(
  activeGCId: number | null,
  currentUserId: number | null,
  send: (data: string) => void,
  currentUsername?: string | null
): MinigameHandle {
  // Per-room active games from gameState broadcasts, plus whichever game's
  // overlay is currently open (soft leave closes it only).
  const [gamesByRoom, setGamesByRoom] = useState<
    Record<number, Record<string, GameInvitation>>
  >({});
  const [activeGame, setActiveGame] = useState<{
    gameId: string;
    roomId: number;
  } | null>(null);
  // Per-id in-progress play view, plus the private role dealt to this viewer
  // for the game they're in.
  const [playViews, setPlayViews] = useState<
    Record<string, ImpostorPlayView | CtfPlayView>
  >({});
  const [roles, setRoles] = useState<Record<string, GameRole>>({});
  /** Games that ended but whose overlay is still showing the result. */
  const [endedGames, setEndedGames] = useState<Record<string, { outcome?: string }>>({});

  // Set when the user just created a game: open that game's overlay when its
  // first gameState arrives (spec §2.1: "lobby opens on send"). Only fires
  // once per create so later roster updates don't reopen a closed overlay.
  const pendingCreateOpenRef = useRef(false);

  const handleGameFrame = useCallback(
    (msg: WSMessage): boolean => {
      // Minigame broadcasts: keep the room's invitation cards and any open
      // overlay in sync. Handled before the message pipeline, which ignores
      // non-message types.
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
          inv.hostId === (currentUsername ?? String(currentUserId ?? -1))
        ) {
          pendingCreateOpenRef.current = false;
          setActiveGame({ gameId: inv.gameId, roomId: msg.groupChatId });
        }
        return true;
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
                scores:
                  msg.scores && typeof msg.scores === "object"
                    ? (msg.scores as Record<string, number>)
                    : undefined,
                phases: Array.isArray(msg.phases)
                  ? (msg.phases as CtfPlayView["phases"])
                  : null,
                currentMatchup:
                  typeof msg.currentMatchup === "number"
                    ? msg.currentMatchup
                    : undefined,
                voteDeadline:
                  typeof msg.voteDeadline === "number"
                    ? msg.voteDeadline
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
                hintsByRound: msg.hintsByRound ?? {},
                choices: msg.choices ?? {},
                votes: msg.votes ?? {},
                votedOutId: msg.votedOutId ?? null,
                outcome: msg.outcome ?? null,
                impostorIds: Array.isArray(msg.impostorIds)
                  ? (msg.impostorIds as string[])
                  : undefined,
                secretWord:
                  typeof msg.secretWord === "string"
                    ? msg.secretWord
                    : undefined,
              };
        setPlayViews((prev) => ({ ...prev, [gid]: play }));
        setGamesByRoom((prev) => {
          for (const roomIdStr of Object.keys(prev)) {
            const roomId = Number(roomIdStr);
            const games = prev[roomId];
            if (games && games[startedId]) {
              return {
                ...prev,
                [roomId]: {
                  ...games,
                  [startedId]: { ...games[startedId], status: "playing" },
                },
              };
            }
          }
          return prev;
        });
        return true;
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
        return true;
      }
      if (msg.type === "gameEnded") {
        const endedGameId = msg.gameId;
        if (endedGameId) {
          // Mark as ended but keep the overlay + play view open so the
          // player can see the result until they manually close it.
          setEndedGames((prev) => ({
            ...prev,
            [endedGameId]: { outcome: msg.outcome ?? undefined },
          }));
          // Remove the invitation card from the room (game is over) but
          // keep the game entry so the open overlay can still find it.
          setGamesByRoom((prev) => {
            const roomGames = prev[msg.groupChatId];
            if (!roomGames || !roomGames[endedGameId]) return prev;
            // Mark as ended — the invitation card checks activeGameEnded
            // to decide whether to render.
            return {
              ...prev,
              [msg.groupChatId]: {
                ...roomGames,
                [endedGameId]: { ...roomGames[endedGameId], status: "playing" },
              },
            };
          });
        }
        return true;
      }
      return false;
    },
    [activeGCId, currentUserId]
  );

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
      const myIdentity = currentUsername ?? String(currentUserId ?? -1);
      const isParticipant = game.participantIds.includes(myIdentity);
      send(
        JSON.stringify({
          type: isParticipant ? "gameRejoin" : "gameJoin",
          gameId,
        })
      );
    },
    [activeGCId, gamesByRoom, send, currentUserId]
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

  /** Close the overlay — clears ended-game state, drops play view/role. */
  const handleCloseGame = useCallback(() => {
    setActiveGame((cur) => {
      if (cur) {
        const gid = cur.gameId;
        setEndedGames((prev) => {
          if (!prev[gid]) return prev;
          const next = { ...prev };
          delete next[gid];
          return next;
        });
        setPlayViews((prev) => {
          if (!prev[gid]) return prev;
          const next = { ...prev };
          delete next[gid];
          return next;
        });
        setRoles((prev) => {
          if (!prev[gid]) return prev;
          const next = { ...prev };
          delete next[gid];
          return next;
        });
      }
      return null;
    });
  }, []);

  // Invitation cards + the open overlay, both scoped to the active room.
  const activeRoomGames =
    activeGCId !== null
      ? Object.values(gamesByRoom[activeGCId] ?? {}).filter(
          (g) => !endedGames[g.gameId]
        )
      : [];
  const activeOverlayGame: GameInvitation | null =
    activeGame && activeGame.roomId === activeGCId
      ? (gamesByRoom[activeGame.roomId] ?? {})[activeGame.gameId] ?? null
      : null;
  // Gameplay: the open overlay's in-progress view + this viewer's private
  // role, plus the identity the server keys them by (anon name in anonymous
  // rooms, else the row user id).
  const activePlayView: ImpostorPlayView | CtfPlayView | null =
    activeOverlayGame ? playViews[activeOverlayGame.gameId] ?? null : null;
  const activeRole: GameRole | null =
    activeOverlayGame ? roles[activeOverlayGame.gameId] ?? null : null;
  const activeGameEnded: boolean =
    activeOverlayGame ? !!endedGames[activeOverlayGame.gameId] : false;
  const activeMeId =
    activeRole?.anonName ?? currentUsername ?? (currentUserId != null ? String(currentUserId) : "");

  return {
    activeRoomGames,
    activeOverlayGame,
    activePlayView,
    activeRole,
    activeGameEnded,
    activeMeId,
    handleGameFrame,
    handleCreateGame,
    handleOpenGame,
    handleStartGame,
    handleGameHint,
    handleGameChoose,
    handleGameVote,
    handleGameGuess,
    handleCtfAnswer,
    handleCtfVote,
    handleCloseGame,
  };
}
