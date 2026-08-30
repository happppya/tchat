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
  type CtfPhase,
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
}): CtfSession {
  return createCtfSession({
    gameId: "game-1",
    playerIds: overrides?.playerIds ?? ["a", "b", "c"],
    settings: validateSettings({
      promptsPerPlayer: overrides?.promptsPerPlayer ?? 2,
      rounds: overrides?.rounds ?? 1,
      answerTimeLimitMs: overrides?.answerTimeLimitMs ?? 60_000,
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

describe("validateSettings", () => {
  it("applies defaults and accepts the full allowed range", () => {
    expect(validateSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(
      validateSettings({ promptsPerPlayer: 10, rounds: 5, answerTimeLimitMs: 30_000 })
    ).toEqual({ promptsPerPlayer: 10, rounds: 5, answerTimeLimitMs: 30_000 });
  });

  it("rejects prompts-per-player outside 2–10", () => {
    expect(() => validateSettings({ promptsPerPlayer: 1 })).toThrow(/2 and 10/);
    expect(() => validateSettings({ promptsPerPlayer: 11 })).toThrow(/2 and 10/);
  });

  it("rejects non-positive rounds and time limits", () => {
    expect(() => validateSettings({ rounds: 0 })).toThrow(/at least 1/);
    expect(() => validateSettings({ answerTimeLimitMs: 0 })).toThrow(/greater than 0/);
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
    // 3 players × 2 prompts = 6 answers → one 4-phase + one 2-phase.
    const sizes = session.phase.phases.map((p) => p.answers.length);
    expect(sizes).toEqual([4, 2]);
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

describe("voting + scoring", () => {
  it("lets each player vote once per phase where they are not an author", () => {
    const session = newSession({ playerIds: ["a", "b", "c", "d"] }); // 4×2=8 → [4,4]
    answerAll(session, NOW + 1000);
    if (session.phase.kind !== "voting") throw new Error("expected voting");

    // Phase 0 is [a0,a1,b0,b1] (player-major chunking), so a and b are
    // authors and c,d are the eligible voters.
    const phase = session.phase.phases[0];
    const eligible = session.playerIds.filter(
      (id) => !phase.answers.some((x) => x.playerId === id)
    );
    expect(eligible).toEqual(["c", "d"]);

    const target = phase.answers[0].id;
    for (const voter of eligible) {
      castVote(session, voter, 0, target);
    }
    expect(session.phase.phases[0].votes).toEqual(
      Object.fromEntries(eligible.map((v) => [v, target]))
    );
  });

  it("blocks authors from voting on their own phase", () => {
    const session = newSession();
    answerAll(session, NOW + 1000);
    if (session.phase.kind !== "voting") throw new Error("expected voting");

    const phase = session.phase.phases[0];
    const author = phase.answers[0].playerId;

    expect(() => castVote(session, author, 0, phase.answers[0].id)).toThrow(
      /their own answer/
    );
  });

  it("splits the 1000-point pool pro-rata and awards a +500 unanimous bonus", () => {
    // 6 players × 2 prompts = 12 answers → three 4-answer phases.
    const session = newSession({ playerIds: ["a", "b", "c", "d", "e", "f"] });
    answerAll(session, NOW + 1000);
    if (session.phase.kind !== "voting") throw new Error("expected voting");
    const phases = session.phase.phases;
    expect(phases.map((p) => p.answers.length)).toEqual([4, 4, 4]);

    const eligibleOf = (phase: { answers: { playerId: string }[] }) =>
      session.playerIds.filter((id) => !phase.answers.some((x) => x.playerId === id));

    // Phase 0 ([a0,a1,b0,b1]): c,d → a0 (2 votes), e → b0 (1), f → a1 (1).
    const phase0 = phases[0];
    const [a0, a1, b0] = phase0.answers;
    castVote(session, "c", 0, a0.id);
    castVote(session, "d", 0, a0.id);
    castVote(session, "e", 0, b0.id);
    castVote(session, "f", 0, a1.id);

    // Phases 1 and 2: unanimous votes.
    for (const [idx, phase] of [1, 2].map((i) => [i, phases[i]] as const)) {
      const target = phase.answers[0].id;
      for (const voter of eligibleOf(phase)) {
        castVote(session, voter, idx, target);
      }
    }

    // Round 1 pool = 1000/phase. a0: 2/4 → 500, a1: 1/4 → 250, b0: 1/4 → 250.
    // Phase 1 + 2 unanimous: 1000 + 500 bonus each.
    const scores = session.scores;
    expect(scores.a).toBe(750);
    expect(scores.b).toBe(250);
    expect(scores.c).toBe(1500);
    expect(scores.e).toBe(1500);
    expect(Object.values(scores).reduce((x, y) => x + y, 0)).toBe(4000);
  });

  it("applies the +200 per-round pool multiplier", () => {
    const session = newSession({
      playerIds: ["a", "b", "c", "d"],
      rounds: 2,
    });
    answerAll(session, NOW + 1000);

    // Round 1: vote every phase unanimously for one answer each.
    const voteAllPhases = () => {
      const phase = session.phase;
      if (phase.kind !== "voting") return;
      for (const [idx, matchup] of phase.phases.entries()) {
        const eligible = session.playerIds.filter(
          (id) => !matchup.answers.some((x) => x.playerId === id)
        );
        const target = matchup.answers[0].id;
        for (const voter of eligible) {
          castVote(session, voter, idx, target);
        }
      }
    };
    voteAllPhases();

    // Round 2 started: pool per phase is now 1200.
    expect(session.round).toBe(2);
    expect(session.phase.kind).toBe("answering");
    answerAll(session, NOW + 1000);
    voteAllPhases();

    expect(session.phase.kind).toBe("over");
    const finalPhase = session.phase;
    if (finalPhase.kind !== "over") throw new Error("expected over");
    const total = Object.values(finalPhase.leaderboard).reduce(
      (a, b) => a + b,
      0
    );
    // Round 1: 1000×2 unanimous = 2000 + 1000 bonus = 3000.
    // Round 2: 1200×2 unanimous = 2400 + 1000 bonus = 3400.
    expect(total).toBe(6400);
  });

  it("rejects votes for answers not in the phase", () => {
    const session = newSession();
    answerAll(session, NOW + 1000);
    const votingPhase = session.phase;
    if (votingPhase.kind !== "voting") throw new Error("expected voting");

    const otherPhase = votingPhase.phases[1];
    const voter = session.playerIds.find(
      (id) =>
        !votingPhase.phases[0].answers.some(
          (x: { playerId: string }) => x.playerId === id
        )
    )!;

    expect(() => castVote(session, voter, 0, otherPhase.answers[0].id)).toThrow(
      /in this phase/
    );
  });
});
