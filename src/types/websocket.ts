import type { Reaction } from "./chat";
import type { GameStatus } from "./games";

/** Incoming WebSocket message */
export interface WSMessage {
  type:
    | "message"
    | "editMessage"
    | "deleteMessage"
    | "deleteRoom"
    | "renameRoom"
    | "kicked"
    | "banned"
    | "messageReactions"
    | "pinMessage"
    | "unpinMessage"
    | "error"
    | "pong"
    | "gameState"
    | "gameRole"
    | "gamePlay"
    | "gameEnded";
  message?: string;
  groupChatId: number;
  /** Real DB id echoed back on send and on edit/delete events. */
  id?: number;
  /** Author user id echoed back on send. */
  userId?: number;
  /** Target message id for editMessage/deleteMessage events. */
  messageId?: number;
  /** New body for editMessage events. */
  messageText?: string;
  /** Edit timestamp for editMessage events. */
  editedAt?: string;
  /** Reply metadata echoed back on a sent message. */
  replyToId?: number | null;
  replyQuote?: string | null;
  replyAuthor?: string | null;
  /** Reaction aggregate for messageReactions events. */
  reactions?: Reaction[];
  displayNameText?: string;
  /** New room name for renameRoom events. */
  name?: string;
  /** Real username (not display name) — for admin mod actions in anon rooms. */
  username?: string;
  /** Speaker tag: null for normal users, "sys" for system messages. */
  speaker?: string | null;
  gifUrl?: string | null;
  timestamp?: string;
  avatarUrl?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  /** forum post id for scoping messages to a thread. */
  forumPostId?: number | null;
  /** gameEnded's game id. */
  gameId?: string;
  /** gameState fields — broadcast top-level (minigame invitations). */
  gameType?: "impostor" | "complete-the-funny";
  hostId?: string;
  status?: GameStatus;
  participantIds?: string[];
  inactivePlayerIds?: string[];
  /** gameRole fields — dealt privately to one player. */
  role?: "impostor" | "crewmate";
  secretWord?: string;
  hint?: string;
  anonName?: string;
  /** gamePlay fields — public in-progress snapshot. */
  game?: "impostor" | "complete-the-funny";
  round?: number;
  phase?: string;
  turnPlayerId?: string | null;
  wordViewUntil?: number | null;
  hintDeadline?: number | null;
  hints?: Record<string, string>;
  votedOutId?: string | null;
  outcome?: string | null;
  /** Complete the Funny play-view fields. */
  deadline?: number | null;
  prompts?: Record<string, string[]>;
  answered?: Record<string, number>;
  phases?: unknown;
  leaderboard?: Record<string, number> | null;
}
