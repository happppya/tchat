/** A message from the database */
export interface Message {
  id: number;
  group_chat_id: number;
  display_name: string | null;
  /** Real username (for moderation in anonymous rooms). */
  username?: string | null;
  message_text: string | null;
  gif_url: string | null;
  sent_at: string;
  /** Authenticated author id, used to authorize edit/delete. Null for legacy rows. */
  user_id?: number | null;
  /** Timestamp of the most recent edit, if any. */
  edited_at?: string | null;
  /** Speaker tag: null for normal users, "sys" for system messages. */
  speaker?: string | null;
  /** Denormalized author avatar URL captured when the message was sent. */
  avatar_url?: string | null;
  /** Uploaded attachment (served URL + display metadata), when present. */
  file_url?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  /** Message being replied to (denormalized at reply time). */
  reply_to_id?: number | null;
  reply_quote?: string | null;
  reply_author?: string | null;
  /** Emoji reactions attached to this message. */
  reactions?: Reaction[];
  /** forum_post_id links this message to a forum thread. Null for regular chat. */
  forum_post_id?: number | null;
  /** Whether this message has been pinned by an owner, mod, or admin. */
  pinned?: number | null;
}

/** Aggregate emoji reaction on a message. */
export interface Reaction {
  emoji: string;
  count: number;
  /** Whether the current viewer has reacted with this emoji. */
  me: boolean;
}

/** A message the user is currently composing a reply to. */
export interface ReplyTarget {
  id: number;
  quote: string;
  author: string;
}

/** A group chat */
export interface GroupChat {
  id: number;
  name: string;
  /** User id of the room's creator, when known. Null for legacy rooms. */
  owner_user_id?: number | null;
  is_hidden?: number | null;
  password_hash?: string | null;
  is_readonly?: number | null;
  is_anonymous?: number | null;
  is_transparent?: number | null;
  is_public?: number | null;
  is_forum?: number | null;
}

/** Saved group chat in local storage */
export interface SavedGC {
  id: number;
  name: string;
}

/** A local group that contains rooms (my rooms tab). */
export interface LocalGroup {
  id: string;
  name: string;
  roomIds: number[];
}

/** A board group from the server (board tab). */
export interface BoardGroup {
  id: number;
  name: string;
  roomIds: number[];
  position: number;
}

/** Minigame lifecycle (Phase 0/1): lobby → playing; end deletes the game. */
export type GameStatus = "lobby" | "playing";

export interface GameInvitation {
  type: "gameState";
  gameId: string;
  gameType: "impostor" | "complete-the-funny";
  /** Host user id (anon name in anonymous rooms). */
  hostId: string;
  groupChatId: number;
  status: GameStatus;
  /** Participant identifiers — anon names in anonymous rooms. */
  participantIds: string[];
  inactivePlayerIds: string[];
}

export interface GameEnded {
  type: "gameEnded";
  gameId: string;
  groupChatId: number;
  outcome?: string;
}

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

/** GIPHY image variants */
export interface GiphyImage {
  url: string;
  width: string;
  height: string;
}

/** A single GIPHY result */
export interface GiphyResult {
  id: string;
  title: string;
  images: {
    fixed_width_small: GiphyImage;
    original: GiphyImage;
  };
}

/** GIPHY search API response */
export interface GiphyResponse {
  data: GiphyResult[];
}

/** API error response */
export interface ApiError {
  error: string;
}

/** Authenticated user returned by /api/signup, /api/login, /api/me */
export interface AuthUser {
  id: number;
  username: string;
  isAdmin?: boolean;
  bio?: string | null;
  picture_url?: string | null;
}

/** Public profile returned by /api/profile/:username */
export interface UserProfile {
  username: string;
  bio: string | null;
  picture_url: string | null;
  isAdmin?: boolean;
  isRoomOwner?: boolean;
}

/** Impostor gameplay frame — the private role dealt to one player. */
export interface GameRole {
  type: "gameRole";
  gameId: string;
  role: "impostor" | "crewmate";
  /** Secret word given to crewmates. Never broadcast. */
  secretWord?: string;
  /** Secret hint given to impostors. Never broadcast. */
  hint?: string;
  /** The recipient's own anon name in anonymous rooms. */
  anonName?: string;
}

/** Impostor phases surfaced by the public play view. */
export type ImpostorPlayPhase =
  | "hint"
  | "choose"
  | "vote"
  | "guess"
  | "over";

/** Public Impostor play view broadcast to the room (spec §5). */
export interface ImpostorPlayView {
  type: "gamePlay";
  gameId: string;
  game: "impostor";
  status: GameStatus;
  round: number;
  phase: ImpostorPlayPhase;
  /** Whose turn to give a hint (anon name / id), when in the hint phase. */
  turnPlayerId: string | null;
  wordViewUntil?: number | null;
  hintDeadline?: number | null;
  /** Hints keyed by the giver's display identity. */
  hints: Record<string, string>;
  votedOutId: string | null;
  outcome: string | null;
}

/** Host-adjustable game settings (spec §4/§6.1), sent on gameStart. */
export interface GameSettings {
  /** Impostor: number of impostors (default 1). */
  impostorCount?: number;
  /** Impostor: per-hint timer ms (default 30000). */
  hintTimeMs?: number;
  /** Impostor: word-view window ms (default 10000). */
  wordViewMs?: number;
  /** Impostor: guess deadline ms (default 30000). */
  guessTimeMs?: number;
  /** Complete the Funny: prompts per player, 2–10 (default 4). */
  promptsPerPlayer?: number;
  /** Complete the Funny: number of rounds (default 3). */
  rounds?: number;
  /** Complete the Funny: answer time limit ms (default 60000). */
  answerTimeLimitMs?: number;
}

/** Complete the Funny phases surfaced by the public play view. */
export type CtfPlayPhase = "answering" | "voting" | "over";

/** A voting matchup's answer as seen in the public play view. */
export interface CtfViewAnswer {
  id: string;
  playerId: string;
  text: string;
}

/** A voting matchup in the public play view. */
export interface CtfViewMatchup {
  prompt: string;
  answers: CtfViewAnswer[];
}

/** Public Complete the Funny play view broadcast to the room (spec §6). */
export interface CtfPlayView {
  type: "gamePlay";
  gameId: string;
  game: "complete-the-funny";
  status: GameStatus;
  round: number;
  phase: CtfPlayPhase;
  /** Answering-phase deadline (ms epoch), when answering. */
  deadline: number | null;
  /** Each player's prompts for the current round, by display identity. */
  prompts: Record<string, string[]>;
  /** How many prompts each player has filled this round, by display identity. */
  answered: Record<string, number>;
  /** Voting matchups, when voting. */
  phases: CtfViewMatchup[] | null;
  /** Final scores, when over. */
  leaderboard: Record<string, number> | null;
}

/** A file attachment attached to an outgoing message. */
export interface FileAttachment {
  url: string;
  name: string;
  type: string;
}/** Selected GIF state */
export interface SelectedGif {
  id: string;
  url: string;
}

/** A forum post / thread. */
export interface ForumPost {
  id: number;
  group_chat_id: number;
  title: string;
  content: string;
  author_id: number;
  display_name: string;
  created_at: string;
  updated_at: string;
  reply_count?: number;
}
