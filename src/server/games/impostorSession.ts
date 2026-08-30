/** Pure Impostor game state machine (spec §5): roles, turn order, hint/vote/
 *  guess phases, and resolution. Timers are enforced by callers via now-based
 *  deadlines. No I/O — deterministic and unit-testable. */
import {
  assignRoles,
  checkHint,


  isGuessCorrect,
  resolveVote,
  type WordEntry,
} from "./impostor";

/** Per-hint answer timer (spec §5.2). */
export const HINT_TIME_MS = 30_000;
/** How long a player can view their word/hint at the start of their turn. */
export const WORD_VIEW_MS = 10_000;
/**
 * How long the voted-out impostor has to guess (server-enforced). If they
 * disconnect or stall, the game resolves as crewmates-win instead of hanging.
 * The spec doesn't pin this; 30s matches the app's other turn timers.
 */
export const GUESS_TIME_MS = 30_000;

export type ImpostorPhase =
  | {
      kind: "hint";
      turnPlayerId: string;
      wordViewUntil: number;
      hintDeadline: number;
    }
  | { kind: "choose" }
  | { kind: "vote" }
  | { kind: "guess"; playerId: string; deadline: number }
  | { kind: "over"; outcome: "crewmates-lose" | "crewmates-win" | "draw" | "tie" };

/**
 * In-progress Impostor game (spec §5). Pure state machine — timers are
 * enforced by callers invoking `timeoutHintTurn(now)` when a turn's deadline
 * passes, and by the `now`-based deadlines stored in each hint phase.
 */
export interface ImpostorSession {
  playerIds: string[];
  secretWord: string;
  hint: string;
  roleByPlayerId: Record<string, "impostor" | "crewmate">;
  turnOrder: string[];
  phase: ImpostorPhase;
  round: number;
  hints: Record<string, string>;
  choices: Record<string, "continue" | "vote">;
  votes: Record<string, string>;
  votedOutId: string | null;
  /** Server-enforced guess deadline offset (default GUESS_TIME_MS). */
  guessTimeMs: number;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createImpostorSession(input: {
  playerIds: string[];
  impostorCount: number;
  wordPool: WordEntry[];
  random: () => number;
  now: number;
  /** Override the 30s hint timer (tests / host tuning). */
  hintTimeMs?: number;
  /** Override the 10s word view (tests / host tuning). */
  wordViewMs?: number;
  /** Override the 30s guess timer (tests / host tuning). */
  guessTimeMs?: number;
}): ImpostorSession {
  const { playerIds, impostorCount, wordPool, random, now } = input;
  const hintTimeMs = input.hintTimeMs ?? HINT_TIME_MS;
  const wordViewMs = input.wordViewMs ?? WORD_VIEW_MS;
  const guessTimeMs = input.guessTimeMs ?? GUESS_TIME_MS;
  const assignment = assignRoles(playerIds, impostorCount, wordPool, random);
  const turnOrder = shuffle(playerIds, random);
  return {
    playerIds,
    secretWord: assignment.secretWord,
    hint: assignment.hint,
    roleByPlayerId: assignment.roleByPlayerId,
    turnOrder,
    phase: {
      kind: "hint",
      turnPlayerId: turnOrder[0],
      wordViewUntil: now + wordViewMs,
      hintDeadline: now + hintTimeMs,
    },
    round: 1,
    hints: {},
    choices: {},
    votes: {},
    votedOutId: null,
    guessTimeMs,
  };
}

function requireParticipant(session: ImpostorSession, playerId: string): void {
  if (!session.playerIds.includes(playerId)) {
    throw new Error("player is not a participant of this game");
  }
}

/** Advance past the current hint turn; the round ends after the last player. */
function advanceHintTurn(session: ImpostorSession, now: number): void {
  if (session.phase.kind !== "hint") return;
  const index = session.turnOrder.indexOf(session.phase.turnPlayerId);
  if (index === session.turnOrder.length - 1) {
    session.phase = { kind: "choose" };
    return;
  }
  session.phase = {
    kind: "hint",
    turnPlayerId: session.turnOrder[index + 1],
    wordViewUntil: now + WORD_VIEW_MS,
    hintDeadline: now + HINT_TIME_MS,
  };
}

export function submitHint(
  session: ImpostorSession,
  playerId: string,
  hint: string,
  now: number
): void {
  if (session.phase.kind !== "hint") {
    throw new Error("not the hint phase");
  }
  if (session.phase.turnPlayerId !== playerId) {
    throw new Error("it is not their turn");
  }
  const check = checkHint(hint, session.secretWord);
  if (!check.ok) {
    throw new Error(
      check.reason === "too-long"
        ? "Hint is too long (max 100 characters)"
        : "Hint cannot contain the secret word"
    );
  }
  session.hints[playerId] = hint;
  advanceHintTurn(session, now);
}

export function timeoutHintTurn(session: ImpostorSession, now: number): void {
  if (session.phase.kind !== "hint") return;
  if (now < session.phase.hintDeadline) return;
  advanceHintTurn(session, now);
}

export function choose(
  session: ImpostorSession,
  playerId: string,
  choice: "continue" | "vote",
  now: number
): void {
  if (session.phase.kind !== "choose") {
    throw new Error("not the choose phase");
  }
  requireParticipant(session, playerId);
  session.choices[playerId] = choice;
  const allChose = session.playerIds.every(
    (id) => session.choices[id] !== undefined
  );
  if (!allChose) return;
  const voteWanted = session.playerIds.some(
    (id) => session.choices[id] === "vote"
  );
  if (voteWanted) {
    session.phase = { kind: "vote" };
    return;
  }
  // Everyone continued: another round of hints, same secret word.
  session.round += 1;
  session.hints = {};
  session.choices = {};
  session.phase = {
    kind: "hint",
    turnPlayerId: session.turnOrder[0],
    wordViewUntil: now + WORD_VIEW_MS,
    hintDeadline: now + HINT_TIME_MS,
  };
}

export function castVote(
  session: ImpostorSession,
  playerId: string,
  votedForId: string,
  now: number = Date.now()
): void {
  if (session.phase.kind !== "vote") {
    throw new Error("not the voting phase");
  }
  requireParticipant(session, playerId);
  requireParticipant(session, votedForId);
  session.votes[playerId] = votedForId;
  const allVoted = session.playerIds.every(
    (id) => session.votes[id] !== undefined
  );
  if (!allVoted) return;
  const result = resolveVote(session.votes);
  if (result.kind === "tie") {
    session.phase = { kind: "over", outcome: "tie" };
    return;
  }
  session.votedOutId = result.votedOutPlayerId;
  if (session.roleByPlayerId[result.votedOutPlayerId] === "crewmate") {
    session.phase = { kind: "over", outcome: "crewmates-lose" };
    return;
  }
  session.phase = {
    kind: "guess",
    playerId: result.votedOutPlayerId,
    deadline: now + session.guessTimeMs,
  };
}

/**
 * Server-enforced guess deadline: if the voted-out impostor doesn't guess in
 * time (e.g. they disconnected), resolve as crewmates-win rather than hanging.
 */
export function timeoutGuess(
  session: ImpostorSession,
  now: number
): void {
  if (session.phase.kind !== "guess") return;
  if (now < session.phase.deadline) return;
  session.phase = { kind: "over", outcome: "crewmates-win" };
}

export function submitGuess(
  session: ImpostorSession,
  playerId: string,
  guess: string
): void {
  if (session.phase.kind !== "guess") {
    throw new Error("not the guess phase");
  }
  if (playerId !== session.phase.playerId) {
    throw new Error("only the voted-out impostor may guess");
  }
  session.phase = {
    kind: "over",
    outcome: isGuessCorrect(guess, session.secretWord)
      ? "draw"
      : "crewmates-win",
  };
}
