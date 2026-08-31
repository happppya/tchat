/**
 * Complete the Funny engine (spec §6). Pure state machine: settings are
 * validated, prompts are dealt per round, answers are capped at 400 chars
 * with the timeout default injected, and voting is synchronized — everyone
 * votes on the same matchup at the same time, advancing when all eligible
 * voters have voted or the per-matchup voting deadline passes.
 *
 * Scoring (spec §6.4): each matchup has a 1000-point pool (1000 + 200 ×
 * (round−1)), split pro-rata by votes, with a +500 unanimous bonus when one
 * answer gets every vote.
 *
 * Matchups (CTF-9): built per prompt — each matchup shows one answer from
 * each unique player who answered that prompt. Different prompts are never
 * mixed into the same matchup.
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
/** Default per-matchup voting time limit (CTF-2). */
export const VOTE_TIME_MS = 30_000;

export interface CtfSettings {
  /** Prompts per player per round (P), 2–10, default 4. */
  promptsPerPlayer: number;
  /** Number of rounds, default 3. */
  rounds: number;
  /** Per-round answer time limit, default 60 s. */
  answerTimeLimitMs: number;
  /** Per-matchup voting time limit, default 30 s (CTF-2). */
  voteTimeMs: number;
}

export const DEFAULT_SETTINGS: CtfSettings = {
  promptsPerPlayer: 4,
  rounds: 3,
  answerTimeLimitMs: 60_000,
  voteTimeMs: VOTE_TIME_MS,
};

/**
 * Build per-prompt matchups (CTF-9): for each prompt, split its answers into
 * groups of at most ceil(playerCount/2), so at least half the players
 * remain eligible voters. Different prompts are never mixed into the same
 * matchup, and a single matchup never contains two answers from the same
 * player.
 */
export function buildMatchups(
  answersByPlayer: Record<string, CtfAnswer[]>
): CtfMatchup[] {
  // Collect answers grouped by prompt text, preserving player order.
  const byPrompt = new Map<string, CtfAnswer[]>();
  for (const playerId of Object.keys(answersByPlayer)) {
    for (const answer of answersByPlayer[playerId]) {
      if (answer.text === "") continue; // skip unanswered (shouldn't happen post-timeout)
      const list = byPrompt.get(answer.prompt) ?? [];
      list.push(answer);
      byPrompt.set(answer.prompt, list);
    }
  }
  // Max group size: ceil(playerCount / 2) so at least half the players
  // remain eligible voters (they aren't authors of every matchup). With
  // 3 players → groups of 2 (1 eligible voter); 4 → groups of 2; 6 → 3.
  const playerCount = Object.keys(answersByPlayer).length;
  const maxGroup = Math.max(2, Math.ceil(playerCount / 2));
  const matchups: CtfMatchup[] = [];
  for (const [prompt, answers] of byPrompt) {
    if (answers.length < 2) continue; // need ≥2 answers to vote on
    for (let i = 0; i < answers.length; i += maxGroup) {
      const chunk = answers.slice(i, i + maxGroup);
      if (chunk.length < 2) continue;
      matchups.push({ prompt, answers: chunk, votes: {}, voteDeadline: 0 });
    }
  }
  if (matchups.length === 0) {
    throw new Error("need at least 2 answers to vote on");
  }
  return matchups;
}

export function validateSettings(settings: Partial<CtfSettings>): CtfSettings {
  const promptsPerPlayer =
    settings.promptsPerPlayer ?? DEFAULT_SETTINGS.promptsPerPlayer;
  const rounds = settings.rounds ?? DEFAULT_SETTINGS.rounds;
  const answerTimeLimitMs =
    settings.answerTimeLimitMs ?? DEFAULT_SETTINGS.answerTimeLimitMs;
  const voteTimeMs = settings.voteTimeMs ?? DEFAULT_SETTINGS.voteTimeMs;
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
  if (!Number.isFinite(voteTimeMs) || voteTimeMs <= 0) {
    throw new Error("voteTimeMs must be greater than 0");
  }
  return { promptsPerPlayer, rounds, answerTimeLimitMs, voteTimeMs };
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
  /** Per-matchup voting deadline (CTF-2), set when voting begins on it. */
  voteDeadline: number;
}

export type CtfPhase =
  | { kind: "answering"; round: number; deadline: number }
  | {
      kind: "voting";
      round: number;
      phases: CtfMatchup[];
      /** Which matchup everyone is voting on now (CTF-2 synchronized). */
      current: number;
    }
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

function startVoting(session: CtfSession, now: number): void {
  const phases = buildMatchups(session.answersByPlayer);
  // Set the deadline only for the first matchup — subsequent matchups
  // get their deadline when they become current (advanceCurrentMatchup).
  // Setting all upfront would mean later matchups' deadlines expire while
  // players are still voting on earlier ones.
  if (phases.length > 0) {
    phases[0].voteDeadline = now + session.settings.voteTimeMs;
  }
  session.phase = {
    kind: "voting",
    round: session.round,
    phases,
    current: 0,
  };
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
    startVoting(session, _now);
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
    startVoting(session, now);
  }
}

function eligibleVoters(session: CtfSession, matchup: CtfMatchup): string[] {
  return session.playerIds.filter(
    (id) => !matchup.answers.some((a) => a.playerId === id)
  );
}

/** True once every eligible voter has voted on the current matchup. */
function currentMatchupResolved(session: CtfSession): boolean {
  if (session.phase.kind !== "voting") return false;
  const matchup = session.phase.phases[session.phase.current];
  if (!matchup) return false;
  const eligible = eligibleVoters(session, matchup);
  return eligible.every((id) => matchup.votes[id] !== undefined);
}

/**
 * Advance past the current matchup to the next one (CTF-2 synchronized).
 * Scoring happens at round-end (resolveRound) so this just moves the index.
 * Returns the kind of the new phase ("voting" if more matchups, "over"/
 * "answering" if the round resolved).
 */
function advanceCurrentMatchup(session: CtfSession, now: number): void {
  if (session.phase.kind !== "voting") return;
  const next = session.phase.current + 1;
  if (next < session.phase.phases.length) {
    // More matchups to vote on — advance the shared index and set a
    // fresh deadline for the new current matchup.
    session.phase.current = next;
    session.phase.phases[next].voteDeadline = now + session.settings.voteTimeMs;
    return;
  }
  // All matchups resolved — score the round.
  resolveRound(session);
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
    // Unanimous: a single answer received every vote in the matchup.
    if (counts.size === 1 && votes.length === eligibleVoters(session, matchup).length) {
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

/**
 * Server-enforced per-matchup voting timeout (CTF-2): when the current
 * matchup's deadline passes, advance to the next matchup even if not
 * everyone voted (stragglers' votes are simply not counted).
 */
export function timeoutVote(session: CtfSession, now: number): void {
  if (session.phase.kind !== "voting") return;
  const matchup = session.phase.phases[session.phase.current];
  if (!matchup || now < matchup.voteDeadline) return;
  advanceCurrentMatchup(session, now);
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
  // CTF-2: votes only count for the current shared matchup. Reject stale
  // votes for other matchups so a late/slow client can't vote ahead.
  if (phaseIndex !== session.phase.current) {
    throw new Error("that matchup is not being voted on now");
  }
  const matchup = session.phase.phases[phaseIndex];
  if (!matchup) {
    throw new Error("unknown voting matchup");
  }
  requireParticipant(session, playerId);
  if (!matchup.answers.some((a) => a.id === answerId)) {
    throw new Error("answer is not in this matchup");
  }
  if (matchup.answers.some((a) => a.playerId === playerId)) {
    throw new Error("players cannot vote on their own answer");
  }
  matchup.votes[playerId] = answerId;
  if (currentMatchupResolved(session)) {
    advanceCurrentMatchup(session, Date.now());
  }
}
