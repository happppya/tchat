import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  MAX_ANSWER_LENGTH,
  RAN_OUT_OF_TIME,
  createCtfSession,
  validateSettings,
  submitAnswers,
  timeoutAnswers,
  castVote,
  timeoutVote,
  buildMatchups,
  type CtfSession,
} from "./completeTheFunny";

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROMPTS = [
  "Weirdest hill to die on",
  "Bad excuse for late homework",
  "Worst superpower",
  "Most useless invention",
  "Best name for a pet rock",
  "Worst thing to say at a funeral",
];

const NOW = 5_000_000;

function newSession(overrides?: {
  playerIds?: string[];
  promptsPerPlayer?: number;
  rounds?: number;
  answerTimeLimitMs?: number;
  voteTimeMs?: number;
}): CtfSession {
  return createCtfSession({
    gameId: "game-1",
    playerIds: overrides?.playerIds ?? ["a", "b", "c"],
    settings: validateSettings({
      promptsPerPlayer: overrides?.promptsPerPlayer ?? 2,
      rounds: overrides?.rounds ?? 1,
      answerTimeLimitMs: overrides?.answerTimeLimitMs ?? 60_000,
      voteTimeMs: overrides?.voteTimeMs ?? 30_000,
    }),
    promptPool: PROMPTS,
    random: mulberry32(7),
    now: NOW,
  });
}

function answerAll(session: CtfSession, now: number): void {
  for (const playerId of session.playerIds) {
    const answers = session.answersByPlayer[playerId]
      ? session.answersByPlayer[playerId].map((a) => a.prompt)
      : [];
    submitAnswers(
      session,
      playerId,
      answers.map((prompt, i) => `${playerId} answer ${i}`),
      now
    );
  }
}

/** Vote every matchup unanimously for the first answer. */
function voteAllUnanimously(session: CtfSession): void {
  const phase = session.phase;
  if (phase.kind !== "voting") return;
  for (let i = phase.current; i < phase.phases.length; i++) {
    const m = phase.phases[i];
    const eligible = session.playerIds.filter(
      (id) => !m.answers.some((a: { playerId: string }) => a.playerId === id)
    );
    const target = m.answers[0].id;
    for (const voter of eligible) {
      castVote(session, voter, i, target);
    }
  }
}

describe("validateSettings", () => {
  it("applies defaults and accepts the full allowed range", () => {
    expect(validateSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(
      validateSettings({ promptsPerPlayer: 10, rounds: 5, answerTimeLimitMs: 30_000, voteTimeMs: 15_000 })
    ).toEqual({ promptsPerPlayer: 10, rounds: 5, answerTimeLimitMs: 30_000, voteTimeMs: 15_000 });
  });

  it("rejects prompts-per-player outside 2–10", () => {
    expect(() => validateSettings({ promptsPerPlayer: 1 })).toThrow(/2 and 10/);
    expect(() => validateSettings({ promptsPerPlayer: 11 })).toThrow(/2 and 10/);
  });

  it("rejects non-positive rounds and time limits", () => {
    expect(() => validateSettings({ rounds: 0 })).toThrow(/at least 1/);
    expect(() => validateSettings({ answerTimeLimitMs: 0 })).toThrow(/greater than 0/);
    expect(() => validateSettings({ voteTimeMs: 0 })).toThrow(/greater than 0/);
  });
});

describe("createCtfSession", () => {
  it("gives every player the same P prompts drawn from the pool", () => {
    const session = newSession();

    expect(session.playerIds).toEqual(["a", "b", "c"]);
    const promptsOf = (id: string) =>
      session.answersByPlayer[id].map((a) => a.prompt);
    expect(promptsOf("a")).toEqual(promptsOf("b"));
    expect(promptsOf("b")).toEqual(promptsOf("c"));
    expect(promptsOf("a")).toHaveLength(2);
    for (const prompt of promptsOf("a")) {
      expect(PROMPTS).toContain(prompt);
    }
    expect(session.phase.kind).toBe("answering");
    expect(session.round).toBe(1);
    expect(session.scores).toEqual({});
  });

  it("sets the answering deadline from now and the time limit", () => {
    const session = newSession({ answerTimeLimitMs: 45_000 });

    expect(session.phase.kind).toBe("answering");
    if (session.phase.kind !== "answering") return;
    expect(session.phase.deadline).toBe(NOW + 45_000);
  });
});

describe("submitAnswers", () => {
  it("stores answers and moves to voting once everyone has answered", () => {
    const session = newSession();
    answerAll(session, NOW + 1000);

    expect(session.phase.kind).toBe("voting");
    if (session.phase.kind !== "voting") return;
    // CTF-9: matchups are per-prompt. 3 players → maxGroup=2, so each
    // prompt's 3 answers split into [2,1] → 1 matchup of 2 per prompt.
    // 2 prompts → ≥2 matchups, each with ≤2 answers from unique players.
    expect(session.phase.phases.length).toBeGreaterThanOrEqual(2);
    for (const m of session.phase.phases) {
      expect(m.answers.length).toBeLessThanOrEqual(2);
      expect(m.answers.length).toBeGreaterThanOrEqual(2);
      const prompts = new Set(m.answers.map((a) => a.prompt));
      expect(prompts.size).toBe(1);
      const players = new Set(m.answers.map((a) => a.playerId));
      expect(players.size).toBe(m.answers.length);
    }
    expect(session.phase.current).toBe(0);
  });

  it("rejects answers over 400 characters", () => {
    const session = newSession();
    const first = session.playerIds[0];

    expect(() =>
      submitAnswers(session, first, ["x".repeat(MAX_ANSWER_LENGTH + 1)], NOW + 1000)
    ).toThrow(/400/);
  });

  it("rejects answers from non-participants", () => {
    const session = newSession();

    expect(() => submitAnswers(session, "z", ["hi"], NOW + 1000)).toThrow(
      /not a participant/
    );
  });

  it("fills missing answers with the timeout default", () => {
    const session = newSession();
    const [a, b] = session.playerIds;
    submitAnswers(session, a, ["a0", "a1"], NOW + 1000);
    submitAnswers(session, b, ["b0"], NOW + 1000); // one answer missing

    timeoutAnswers(session, b, NOW + 60_000 + 1);

    const bAnswers = session.answersByPlayer[b].map((x) => x.text);
    expect(bAnswers).toEqual(["b0", RAN_OUT_OF_TIME]);
  });
});

describe("buildMatchups (CTF-9)", () => {
  it("groups answers by prompt — one matchup per prompt chunk, never mixing", () => {
    const session = newSession({ playerIds: ["a", "b", "c", "d"] });
    answerAll(session, NOW + 1000);

    const matchups = buildMatchups(session.answersByPlayer);
    // 2 prompts → 2 matchup chunks (4 players split into groups of 3,
    // leaving ≥1 eligible voter per chunk).
    expect(matchups.length).toBeGreaterThanOrEqual(2);
    for (const m of matchups) {
      // Each matchup has 2–3 answers from unique players.
      expect(m.answers.length).toBeGreaterThanOrEqual(2);
      expect(m.answers.length).toBeLessThanOrEqual(3);
      // All answers in a matchup share the same prompt.
      const prompts = new Set(m.answers.map((a) => a.prompt));
      expect(prompts.size).toBe(1);
      // Each answer is from a unique player.
      const players = new Set(m.answers.map((a) => a.playerId));
      expect(players.size).toBe(m.answers.length);
    }
  });
});

describe("voting + scoring (CTF-2 synchronized)", () => {
  it("only accepts votes for the current matchup", () => {
    // 5 players: each prompt splits into [3,2] → ≥2 eligible voters.
    const session = newSession({ playerIds: ["a", "b", "c", "d", "e"] });
    answerAll(session, NOW + 1000);
    if (session.phase.kind !== "voting") throw new Error("expected voting");
    expect(session.phase.current).toBe(0);

    // Voting on matchup 0 works.
    const phase0 = session.phase.phases[0];
    const voter0 = session.playerIds.find(
      (id) => !phase0.answers.some((a) => a.playerId === id)
    )!;
    castVote(session, voter0, 0, phase0.answers[0].id);

    // Voting on matchup 1 (not current) is rejected.
    const phase1 = session.phase.phases[1];
    const voter1 = session.playerIds.find(
      (id) => !phase1.answers.some((a) => a.playerId === id)
    )!;
    expect(() => castVote(session, voter1, 1, phase1.answers[0].id)).toThrow(
      /not being voted on now/
    );
  });

  it("blocks authors from voting on their own matchup", () => {
    const session = newSession();
    answerAll(session, NOW + 1000);
    if (session.phase.kind !== "voting") throw new Error("expected voting");

    const phase = session.phase.phases[0];
    const author = phase.answers[0].playerId;

    expect(() => castVote(session, author, 0, phase.answers[0].id)).toThrow(
      /their own answer/
    );
  });

  it("advances current to the next matchup when all eligible voters vote", () => {
    const session = newSession({ playerIds: ["a", "b", "c", "d"] });
    answerAll(session, NOW + 1000);
    if (session.phase.kind !== "voting") throw new Error("expected voting");

    const matchup = session.phase.phases[0];
    const eligible = session.playerIds.filter(
      (id) => !matchup.answers.some((a) => a.playerId === id)
    );
    const target = matchup.answers[0].id;
    // Vote with all but the last eligible voter — current stays.
    for (const voter of eligible.slice(0, -1)) {
      castVote(session, voter, 0, target);
    }
    expect(session.phase.current).toBe(0);

    // Last vote advances current to 1.
    castVote(session, eligible[eligible.length - 1], 0, target);
    expect(session.phase.current).toBe(1);
  });

  it("splits the pool pro-rata and awards a +500 unanimous bonus", () => {
    // 5 players: each prompt splits into [3,2] → 4 matchups of 3 or 2.
    const session = newSession({ playerIds: ["a", "b", "c", "d", "e"] });
    answerAll(session, NOW + 1000);
    if (session.phase.kind !== "voting") throw new Error("expected voting");
    const phases = session.phase.phases;

    const eligibleOf = (m: (typeof phases)[0]) =>
      session.playerIds.filter((id) => !m.answers.some((a) => a.playerId === id));

    // Matchup 0: split votes 2-1 (no unanimous bonus).
    const m0 = phases[0];
    const [a0, b0] = m0.answers;
    const elig0 = eligibleOf(m0);
    // m0 has 3 answers → 2 eligible voters (5-3=2).
    castVote(session, elig0[0], 0, a0.id);
    castVote(session, elig0[1], 0, b0.id);
    expect(session.phase.current).toBe(1);

    // Matchup 1: unanimous (all eligible vote for the same answer).
    const m1 = phases[1];
    const target1 = m1.answers[0].id;
    for (const voter of eligibleOf(m1)) {
      castVote(session, voter, 1, target1);
    }

    // Remaining matchups: vote them all through unanimously.
    for (let i = session.phase.current; i < phases.length; i++) {
      const m = phases[i];
      const elig = eligibleOf(m);
      const target = m.answers[0].id;
      for (const voter of elig) {
        castVote(session, voter, i, target);
      }
    }

    // Matchup 0: pool=1000, 2 votes split 1-1 → 500 each to a and b.
    // Matchup 1+: unanimous → 1000 + 500 bonus each.
    expect(session.scores.a).toBeGreaterThanOrEqual(500);
    expect(session.scores.b).toBeGreaterThanOrEqual(500);
  });

  it("resolves the round and starts a new one when all matchups are done", () => {
    const session = newSession({ playerIds: ["a", "b", "c", "d"], rounds: 2 });
    answerAll(session, NOW + 1000);
    voteAllUnanimously(session);

    expect(session.round).toBe(2);
    expect(session.phase.kind).toBe("answering");
  });

  it("ends on 'over' with a leaderboard after the last round", () => {
    const session = newSession({ playerIds: ["a", "b", "c", "d"], rounds: 1 });
    answerAll(session, NOW + 1000);
    voteAllUnanimously(session);

    expect(session.phase.kind).toBe("over");
    if (session.phase.kind !== "over") throw new Error("expected over");
    expect(Object.keys(session.phase.leaderboard).length).toBeGreaterThan(0);
  });

  it("applies the +200 per-round pool multiplier", () => {
    const session = newSession({
      playerIds: ["a", "b", "c", "d"],
      rounds: 2,
    });
    answerAll(session, NOW + 1000);
    voteAllUnanimously(session);

    expect(session.round).toBe(2);
    expect(session.phase.kind).toBe("answering");
    answerAll(session, NOW + 1000);
    voteAllUnanimously(session);

    expect(session.phase.kind).toBe("over");
    const finalPhase = session.phase;
    if (finalPhase.kind !== "over") throw new Error("expected over");
    const total = Object.values(finalPhase.leaderboard).reduce(
      (a, b) => a + b,
      0
    );
    // 4 players × 2 prompts, maxGroup=2 → 4 matchups of 2 per round.
    // Each unanimous: pool + 500 bonus. Round 1: 1000+500=1500 × 4 = 6000.
    // Round 2: 1200+500=1700 × 4 = 6800. Total = 12800.
    expect(total).toBe(12800);
  });

  it("rejects votes for answers not in the matchup", () => {
    const session = newSession({ playerIds: ["a", "b", "c", "d"] });
    answerAll(session, NOW + 1000);
    if (session.phase.kind !== "voting") throw new Error("expected voting");
    const phase = session.phase;

    const otherMatchup = phase.phases[1];
    const voter = session.playerIds.find(
      (id) =>
        !phase.phases[0].answers.some(
          (a: { playerId: string }) => a.playerId === id
        )
    )!;

    expect(() => castVote(session, voter, 0, otherMatchup.answers[0].id)).toThrow(
      /not in this matchup/
    );
  });
});

describe("timeoutVote (CTF-2)", () => {
  it("advances the current matchup when the deadline passes", () => {
    const session = newSession({ voteTimeMs: 150 });
    answerAll(session, NOW + 1000);
    if (session.phase.kind !== "voting") throw new Error("expected voting");
    expect(session.phase.current).toBe(0);
    expect(session.phase.phases[0].voteDeadline).toBe(NOW + 1000 + 150);

    // Before the deadline: no advance.
    timeoutVote(session, NOW + 1000 + 149);
    expect(session.phase.current).toBe(0);

    // After the deadline: advance to matchup 1.
    timeoutVote(session, NOW + 1000 + 151);
    expect(session.phase.current).toBe(1);
  });

  it("resolves the round when the last matchup's deadline passes", () => {
    const session = newSession({ rounds: 1, voteTimeMs: 150 });
    answerAll(session, NOW + 1000);
    if (session.phase.kind !== "voting") throw new Error("expected voting");

    // Advance to the last matchup.
    timeoutVote(session, NOW + 1000 + 151);
    expect(session.phase.current).toBe(1);

    // Last matchup deadline passes → round resolves.
    const lastDeadline = session.phase.phases[1].voteDeadline;
    timeoutVote(session, lastDeadline + 1);

    expect(session.phase.kind).toBe("over");
  });
});
