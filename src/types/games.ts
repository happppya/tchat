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
export type ImpostorPlayPhase = "hint" | "choose" | "vote" | "guess" | "over";

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
