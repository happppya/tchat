/** Maximum characters allowed in an Impostor hint (spec §5.2). */
export const MAX_HINT_LENGTH = 100;

export type HintCheck =
  | { ok: true }
  | { ok: false; reason: "too-long" | "contains-word" };

/** Case-insensitive substring containment, shared by hint and guess checks. */
function containsWord(text: string, word: string): boolean {
  return text.toLowerCase().includes(word.toLowerCase());
}

/**
 * Validates a submitted hint against the spec constraints (spec §5.2):
 * max 100 characters and never containing the secret word.
 */
export function checkHint(hint: string, secretWord: string): HintCheck {
  if (hint.length > MAX_HINT_LENGTH) {
    return { ok: false, reason: "too-long" };
  }
  if (containsWord(hint, secretWord)) {
    return { ok: false, reason: "contains-word" };
  }
  return { ok: true };
}

/**
 * A guess counts as correct if it contains the secret word, case-insensitively
 * (spec §5.4): "hummingbird" is a correct guess for "bird".
 */
export function isGuessCorrect(guess: string, secretWord: string): boolean {
  return containsWord(guess, secretWord);
}

export type VoteResult =
  | { kind: "voted-out"; votedOutPlayerId: string }
  | { kind: "tie"; tiedPlayerIds: string[] };

/**
 * Resolves the final vote (spec §5.3 + decision #1): the player with the most
 * votes is voted out; a tie for the most votes ends the game on a tie screen.
 * `votes` maps voter player id → voted-for player id.
 */
export function resolveVote(votes: Record<string, string>): VoteResult {
  const counts = new Map<string, number>();
  for (const votedFor of Object.values(votes)) {
    counts.set(votedFor, (counts.get(votedFor) ?? 0) + 1);
  }
  const top = Math.max(0, ...counts.values());
  const tiedPlayerIds = [...counts.entries()]
    .filter(([, count]) => count === top)
    .map(([playerId]) => playerId)
    .sort();
  if (tiedPlayerIds.length === 1) {
    return { kind: "voted-out", votedOutPlayerId: tiedPlayerIds[0] };
  }
  return { kind: "tie", tiedPlayerIds };
}

export interface WordEntry {
  word: string;
  hint: string;
}

export interface ImpostorAssignment {
  secretWord: string;
  hint: string;
  roleByPlayerId: Record<string, "impostor" | "crewmate">;
}

export type GameOutcome = "crewmates-lose" | "crewmates-win" | "draw";

/**
 * Resolves the game after a player is voted out (spec §5.4). Only a voted-out
 * impostor gets to guess the word; crewmates never guess.
 */
export function resolveGame(args: {
  votedOutIsImpostor: boolean;
  /** The voted-out impostor's guess; null for crewmates (who never guess). */
  guess: string | null;
  secretWord: string;
}): GameOutcome {
  if (!args.votedOutIsImpostor) {
    return "crewmates-lose";
  }
  if (args.guess === null) {
    throw new Error("a voted-out impostor must submit a guess");
  }
  return isGuessCorrect(args.guess, args.secretWord) ? "draw" : "crewmates-win";
}

/**
 * Assigns roles and picks the secret word for a new game (spec §5.1): all
 * crewmates share the word, impostors only get the hint. `random` is injected
 * for determinism in tests (callers pass `Math.random`). Requires at least one
 * crewmate (impostorCount must be a positive integer below the player count).
 */
export function assignRoles(
  playerIds: string[],
  impostorCount: number,
  wordPool: WordEntry[],
  random: () => number
): ImpostorAssignment {
  if (!Number.isInteger(impostorCount) || impostorCount < 1) {
    throw new Error("impostorCount must be a positive integer");
  }
  if (impostorCount >= playerIds.length) {
    throw new Error("impostorCount must be less than the number of players");
  }
  if (wordPool.length === 0) {
    throw new Error("word pool must not be empty");
  }

  const entry = wordPool[Math.floor(random() * wordPool.length)];

  // Partial Fisher–Yates: the first impostorCount slots become the impostors.
  const shuffled = [...playerIds];
  for (let i = 0; i < impostorCount; i++) {
    const j = i + Math.floor(random() * (shuffled.length - i));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const impostors = new Set(shuffled.slice(0, impostorCount));

  const roleByPlayerId: Record<string, "impostor" | "crewmate"> = {};
  for (const playerId of playerIds) {
    roleByPlayerId[playerId] = impostors.has(playerId) ? "impostor" : "crewmate";
  }

  return { secretWord: entry.word, hint: entry.hint, roleByPlayerId };
}
