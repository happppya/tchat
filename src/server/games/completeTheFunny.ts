/**
 * Complete the Funny engine (spec §6). Pure state machine: settings are
 * validated, prompts are dealt per round, answers are capped at 400 chars with
 * the timeout default injected, and voting phases are sized by `planMatchups`.
 *
 * Scoring (spec §6.4): each phase has a 1000-point pool (1000 + 200 × (round−1)),
 * split pro-rata by votes, with a +500 unanimous bonus when one answer gets
 * every vote. Tie votes split the pool evenly (resolved decision, see
 * note/minigame-requirements.md §6.6).
 *
 * Note on matchups (spec §6.5): answers are chunked in player order into the
 * planned phase sizes, so a phase may mix prompts or contain two answers from
 * one player. The strict invariant is a whole-number phase count; "unique
 * prompt per phase" is a product nicety for a later pass.
 */

/** Maximum characters allowed in an answer (spec §6.2). */
export const MAX_ANSWER_LENGTH = 400;
/** Default text injected when a player runs out of time (spec §6.2). */
export const RAN_OUT_OF_TIME = "I RAN OUT OF TIME";
/** Base points pool per voting phase (spec §6.4). */
export const BASE_PHASE_POOL = 1000;
/** Extra pool per round after the first (spec §6.4). */
export const POOL_INCREMENT_PER_ROUND = 200;
/** Unanimous-bonus points (spec §6.4). */
export const UNANIMOUS_BONUS = 500;

export interface CtfSettings {
  /** Prompts per player per round (P), 2–10, default 4. */
  promptsPerPlayer: number;
  /** Number of rounds, default 3. */
  rounds: number;
  /** Per-round answer time limit, default 60 s. */
  answerTimeLimitMs: number;
}

export const DEFAULT_SETTINGS: CtfSettings = {
  promptsPerPlayer: 4,
  rounds: 3,
  answerTimeLimitMs: 60_000,
};

/**
 * Split the round's N×P answers into voting matchups of at most 4 (spec §6.5):
 * every phase has 2–4 answers, the phase count stays a whole number, and no
 * answer is left out. Remainder handling: 4k+3 → one 3-phase, 4k+2 → one
 * 2-phase, 4k+1 → one 3-phase + one 2-phase in place of a 4-phase.
 */
export function planMatchups(
  playerCount: number,
  promptsPerPlayer: number
): number[] {
  const total = playerCount * promptsPerPlayer;
  if (total < 2) {
    throw new Error("need at least 2 answers to vote on");
  }
  const fours = Math.floor(total / 4);
  const remainder = total % 4;
  if (remainder === 0) return Array(fours).fill(4);
  if (remainder === 3) return [...Array(fours).fill(4), 3];
  if (remainder === 2) return [...Array(fours).fill(4), 2];
  // remainder 1: 4k+1 = 4(k−1) + 3 + 2.
  return [...Array(fours - 1).fill(4), 3, 2];
}

export function validateSettings(settings: Partial<CtfSettings>): CtfSettings {
  const promptsPerPlayer =
    settings.promptsPerPlayer ?? DEFAULT_SETTINGS.promptsPerPlayer;
  const rounds = settings.rounds ?? DEFAULT_SETTINGS.rounds;
  const answerTimeLimitMs =
    settings.answerTimeLimitMs ?? DEFAULT_SETTINGS.answerTimeLimitMs;
  if (
    !Number.isInteger(promptsPerPlayer) ||
    promptsPerPlayer < 2 ||
    promptsPerPlayer > 10
  ) {
    throw new Error("promptsPerPlayer must be an integer between 2 and 10");
  }
  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new Error("rounds must be at least 1");
  }
  if (!Number.isFinite(answerTimeLimitMs) || answerTimeLimitMs <= 0) {
    throw new Error("answerTimeLimitMs must be greater than 0");
  }
  return { promptsPerPlayer, rounds, answerTimeLimitMs };
}

export interface CtfAnswer {
  id: string;
  playerId: string;
  prompt: string;
  text: string;
}

export interface CtfMatchup {
  prompt: string;
  answers: CtfAnswer[];
  votes: Record<string, string>;
}

export type CtfPhase =
  | { kind: "answering"; round: number; deadline: number }
  | { kind: "voting"; round: number; phases: CtfMatchup[] }
  | { kind: "over"; leaderboard: Record<string, number> };

export interface CtfSession {
  gameId: string;
  playerIds: string[];
  settings: CtfSettings;
  phase: CtfPhase;
  round: number;
  answersByPlayer: Record<string, CtfAnswer[]>;
  scores: Record<string, number>;
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createCtfSession(input: {
  gameId: string;
  playerIds: string[];
  settings: CtfSettings;
  promptPool: string[];
  random: () => number;
  now: number;
}): CtfSession {
  const { gameId, playerIds, settings, promptPool, random, now } = input;
  // Every player answers the same P prompts (spec §6.2), drawn at random.
  const prompts = shuffle([...promptPool], random).slice(
    0,
    settings.promptsPerPlayer
  );
  const answersByPlayer: Record<string, CtfAnswer[]> = {};
  for (const playerId of playerIds) {
    answersByPlayer[playerId] = prompts.map((prompt, i) => ({
      id: `${playerId}:${i}`,
      playerId,
      prompt,
      text: "",
    }));
  }
  return {
    gameId,
    playerIds,
    settings,
    phase: {
      kind: "answering",
      round: 1,
      deadline: now + settings.answerTimeLimitMs,
    },
    round: 1,
    answersByPlayer,
    scores: {},
  };
}

function requireParticipant(session: CtfSession, playerId: string): void {
  if (!session.playerIds.includes(playerId)) {
    throw new Error("player is not a participant of this game");
  }
}

function allAnswered(session: CtfSession): boolean {
  return session.playerIds.every((id) =>
    session.answersByPlayer[id].every((a) => a.text !== "")
  );
}

function startVoting(session: CtfSession): void {
  const sizes = planMatchups(
    session.playerIds.length,
    session.settings.promptsPerPlayer
  );
  const all: CtfAnswer[] = [];
  for (const playerId of session.playerIds) {
    all.push(...session.answersByPlayer[playerId]);
  }
  const phases: CtfMatchup[] = [];
  let offset = 0;
  for (const size of sizes) {
    const chunk = all.slice(offset, offset + size);
    offset += size;
    phases.push({ prompt: chunk[0].prompt, answers: chunk, votes: {} });
  }
  session.phase = { kind: "voting", round: session.round, phases };
}

export function submitAnswers(
  session: CtfSession,
  playerId: string,
  answers: string[],
  _now: number
): void {
  if (session.phase.kind !== "answering") {
    throw new Error("not the answering phase");
  }
  requireParticipant(session, playerId);
  const slots = session.answersByPlayer[playerId];
  for (let i = 0; i < slots.length; i++) {
    const text = answers[i] ?? "";
    if (text.length > MAX_ANSWER_LENGTH) {
      throw new Error(`Answer is too long (max ${MAX_ANSWER_LENGTH} characters)`);
    }
    slots[i].text = text;
  }
  if (allAnswered(session)) {
    startVoting(session);
  }
}

export function timeoutAnswers(
  session: CtfSession,
  playerId: string,
  now: number
): void {
  if (session.phase.kind !== "answering") return;
  if (now < session.phase.deadline) return;
  for (const answer of session.answersByPlayer[playerId] ?? []) {
    if (answer.text === "") answer.text = RAN_OUT_OF_TIME;
  }
  if (allAnswered(session)) {
    startVoting(session);
  }
}

function eligibleVoters(session: CtfSession, matchup: CtfMatchup): string[] {
  return session.playerIds.filter(
    (id) => !matchup.answers.some((a) => a.playerId === id)
  );
}

function allPhasesResolved(session: CtfSession): boolean {
  if (session.phase.kind !== "voting") return false;
  for (const matchup of session.phase.phases) {
    const eligible = eligibleVoters(session, matchup);
    if (!eligible.every((id) => matchup.votes[id] !== undefined)) {
      return false;
    }
  }
  return true;
}

function resolveRound(session: CtfSession): void {
  if (session.phase.kind !== "voting") return;
  const round = session.round;
  const pool = BASE_PHASE_POOL + POOL_INCREMENT_PER_ROUND * (round - 1);
  for (const matchup of session.phase.phases) {
    const votes = Object.values(matchup.votes);
    if (votes.length === 0) continue;
    const counts = new Map<string, number>();
    for (const answerId of votes) {
      counts.set(answerId, (counts.get(answerId) ?? 0) + 1);
    }
    for (const [answerId, count] of counts) {
      const answer = matchup.answers.find((a) => a.id === answerId)!;
      const points = Math.round((pool * count) / votes.length);
      session.scores[answer.playerId] =
        (session.scores[answer.playerId] ?? 0) + points;
    }
    // Unanimous: a single answer received every vote in the phase.
    if (counts.size === 1) {
      const answer = matchup.answers.find(
        (a) => a.id === counts.keys().next().value
      )!;
      session.scores[answer.playerId] =
        (session.scores[answer.playerId] ?? 0) + UNANIMOUS_BONUS;
    }
  }
  if (round < session.settings.rounds) {
    session.round = round + 1;
    const prompts = session.answersByPlayer[session.playerIds[0]].map(
      (a) => a.prompt
    );
    for (const playerId of session.playerIds) {
      session.answersByPlayer[playerId] = prompts.map((prompt, i) => ({
        id: `${playerId}:${i}`,
        playerId,
        prompt,
        text: "",
      }));
    }
    session.phase = {
      kind: "answering",
      round: session.round,
      deadline: Date.now() + session.settings.answerTimeLimitMs,
    };
  } else {
    session.phase = { kind: "over", leaderboard: { ...session.scores } };
  }
}

export function castVote(
  session: CtfSession,
  playerId: string,
  phaseIndex: number,
  answerId: string
): void {
  if (session.phase.kind !== "voting") {
    throw new Error("not the voting phase");
  }
  const matchup = session.phase.phases[phaseIndex];
  if (!matchup) {
    throw new Error("unknown voting phase");
  }
  requireParticipant(session, playerId);
  if (!matchup.answers.some((a) => a.id === answerId)) {
    throw new Error("answer is not in this phase");
  }
  if (matchup.answers.some((a) => a.playerId === playerId)) {
    throw new Error("players cannot vote on their own answer");
  }
  matchup.votes[playerId] = answerId;
  if (allPhasesResolved(session)) {
    resolveRound(session);
  }
}
