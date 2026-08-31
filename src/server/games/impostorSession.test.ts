import { describe, expect, it } from "vitest";
import {
  HINT_TIME_MS,
  WORD_VIEW_MS,
  createImpostorSession,
  GUESS_TIME_MS,
  DEFAULT_MAX_ROUNDS,
  submitHint,
  timeoutHintTurn,
  timeoutGuess,
  choose,
  castVote,
  submitGuess,
  type ImpostorSession,
} from "./impostorSession";
import type { WordEntry } from "./impostor";

/** Deterministic PRNG so role/word/turn picks are reproducible in tests. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POOL: WordEntry[] = [
  { word: "bird", hint: "flies" },
  { word: "ocean", hint: "salty" },
  { word: "guitar", hint: "strings" },
];

const NOW = 1_000_000;

function newSession(impostorCount = 1, guessTimeMs?: number): ImpostorSession {
  return createImpostorSession({
    playerIds: ["a", "b", "c"],
    impostorCount,
    wordPool: POOL,
    random: mulberry32(42),
    now: NOW,
    guessTimeMs,
  });
}

/** Submit valid hints for every player in turn order so the round completes. */
function playAllHints(session: ImpostorSession, now: number): void {
  for (const playerId of session.turnOrder) {
    submitHint(session, playerId, `${playerId}-hint`, now);
    now += 1000;
  }
}

describe("createImpostorSession", () => {
  it("deals roles, a shared secret word, and a fixed shuffled turn order", () => {
    const session = newSession();

    const roles = Object.values(session.roleByPlayerId);
    expect(roles.filter((r) => r === "impostor")).toHaveLength(1);
    expect(session.secretWord).toBeTruthy();
    expect(session.hint).toBeTruthy();
    expect([...session.turnOrder].sort()).toEqual(["a", "b", "c"]);
    expect(session.phase.kind).toBe("hint");
    if (session.phase.kind !== "hint") throw new Error("expected hint phase");
    expect(session.phase.turnPlayerId).toBe(session.turnOrder[0]);
    expect(session.round).toBe(1);
  });

  it("sets the 10s word view and 30s hint deadlines from now", () => {
    const session = newSession();

    expect(session.phase.kind).toBe("hint");
    if (session.phase.kind !== "hint") return;
    expect(session.phase.wordViewUntil).toBe(NOW + WORD_VIEW_MS);
    expect(session.phase.hintDeadline).toBe(NOW + HINT_TIME_MS);
  });

  it("honors per-game time overrides (for tests and host tuning)", () => {
    const session = createImpostorSession({
      playerIds: ["a", "b", "c"],
      impostorCount: 1,
      wordPool: POOL,
      random: mulberry32(1),
      now: NOW,
      hintTimeMs: 500,
      wordViewMs: 100,
    });

    expect(session.phase.kind).toBe("hint");
    if (session.phase.kind !== "hint") return;
    expect(session.phase.wordViewUntil).toBe(NOW + 100);
    expect(session.phase.hintDeadline).toBe(NOW + 500);
  });
});

describe("submitHint", () => {
  it("records a valid hint and moves to the next player", () => {
    const session = newSession();
    const first = session.turnOrder[0];
    const second = session.turnOrder[1];

    submitHint(session, first, "a hint", NOW + 100);

    expect(session.hints[first]).toBe("a hint");
    expect(session.phase.kind).toBe("hint");
    if (session.phase.kind !== "hint") return;
    expect(session.phase.turnPlayerId).toBe(second);
  });

  it("moves to the choose phase after the last player hints", () => {
    const session = newSession();
    playAllHints(session, NOW);

    expect(session.phase.kind).toBe("choose");
  });

  it("rejects a hint containing the secret word", () => {
    const session = newSession();
    const first = session.turnOrder[0];

    expect(() =>
      submitHint(session, first, `the word is ${session.secretWord}`, NOW + 100)
    ).toThrow(/cannot contain/);
  });

  it("rejects a hint over 100 characters", () => {
    const session = newSession();
    const first = session.turnOrder[0];

    expect(() => submitHint(session, first, "x".repeat(101), NOW + 100)).toThrow(
      /too long/
    );
  });

  it("rejects a hint from a player whose turn it is not", () => {
    const session = newSession();
    const notFirst = session.turnOrder[1];

    expect(() => submitHint(session, notFirst, "jump the queue", NOW + 100)).toThrow(
      /not their turn/
    );
  });
});

describe("timeoutHintTurn", () => {
  it("does nothing before the hint deadline", () => {
    const session = newSession();
    const before = { ...session.phase };

    timeoutHintTurn(session, NOW + HINT_TIME_MS - 1);

    expect(session.phase).toEqual(before);
  });

  it("skips the current player after their deadline passes", () => {
    const session = newSession();
    const first = session.turnOrder[0];
    const second = session.turnOrder[1];

    timeoutHintTurn(session, NOW + HINT_TIME_MS + 1);

    expect(session.hints[first]).toBeUndefined();
    expect(session.phase.kind).toBe("hint");
    if (session.phase.kind !== "hint") return;
    expect(session.phase.turnPlayerId).toBe(second);
  });

  it("moves to choose when the final turn times out", () => {
    const session = newSession();
    const last = session.turnOrder[session.turnOrder.length - 1];
    // Advance through every player except the last.
    for (const playerId of session.turnOrder.slice(0, -1)) {
      submitHint(session, playerId, `${playerId}-hint`, NOW + 1000);
    }
    expect(session.phase.kind).toBe("hint");
    if (session.phase.kind !== "hint") return;
    expect(session.phase.turnPlayerId).toBe(last);

    // The last turn's deadline starts when the previous hint was submitted.
    timeoutHintTurn(session, NOW + 1000 + HINT_TIME_MS + 1);

    expect(session.phase.kind).toBe("choose");
  });
});

describe("choose", () => {
  it("starts a new round with the same word when everyone continues", () => {
    const session = newSession();
    playAllHints(session, NOW);

    for (const playerId of session.playerIds) {
      choose(session, playerId, "continue", NOW + 5000);
    }

    expect(session.round).toBe(2);
    expect(session.hints).toEqual({});
    expect(session.choices).toEqual({});
    expect(session.phase.kind).toBe("hint");
    if (session.phase.kind !== "hint") return;
    expect(session.phase.turnPlayerId).toBe(session.turnOrder[0]);
  });

  it("preserves past rounds' hints in hintsByRound", () => {
    const session = newSession();
    playAllHints(session, NOW);
    const round1Hints = { ...session.hints };

    for (const playerId of session.playerIds) {
      choose(session, playerId, "continue", NOW + 5000);
    }

    expect(session.hintsByRound[1]).toEqual(round1Hints);
    expect(session.hints).toEqual({});
  });

  it("forces a vote only when a majority chooses to vote (I-1)", () => {
    const session = newSession();
    playAllHints(session, NOW);

    // 2 continue + 1 vote → majority continues, round continues.
    choose(session, session.playerIds[0], "continue", NOW + 5000);
    choose(session, session.playerIds[1], "vote", NOW + 5000);
    choose(session, session.playerIds[2], "continue", NOW + 5000);

    expect(session.phase.kind).toBe("hint");
    expect(session.round).toBe(2);
  });

  it("forces a vote when a majority chooses to vote (I-1)", () => {
    const session = newSession();
    playAllHints(session, NOW);

    // 2 vote + 1 continue → majority votes.
    choose(session, session.playerIds[0], "vote", NOW + 5000);
    choose(session, session.playerIds[1], "continue", NOW + 5000);
    choose(session, session.playerIds[2], "vote", NOW + 5000);

    expect(session.phase.kind).toBe("vote");
  });

  it("continues on a tie (I-1)", () => {
    const session = newSession();
    playAllHints(session, NOW);

    choose(session, session.playerIds[0], "vote", NOW + 5000);
    choose(session, session.playerIds[1], "continue", NOW + 5000);

    expect(session.phase.kind).toBe("choose");
  });

  it("rejects choices from non-participants", () => {
    const session = newSession();
    playAllHints(session, NOW);

    expect(() => choose(session, "z", "continue", NOW + 5000)).toThrow(
      /not a participant/
    );
  });
});

describe("maxRounds", () => {
  it("defaults to 5 rounds", () => {
    const session = newSession();

    expect(session.maxRounds).toBe(DEFAULT_MAX_ROUNDS);
    expect(DEFAULT_MAX_ROUNDS).toBe(5);
  });

  it("ends as a tie when max rounds is reached and everyone continues", () => {
    const session = createImpostorSession({
      playerIds: ["a", "b", "c"],
      impostorCount: 1,
      wordPool: POOL,
      random: mulberry32(42),
      now: NOW,
      maxRounds: 2,
    });

    // Round 1: all hint, all continue.
    playAllHints(session, NOW);
    for (const playerId of session.playerIds) {
      choose(session, playerId, "continue", NOW + 5000);
    }
    expect(session.round).toBe(2);

    // Round 2 (the max): all hint, all continue → game over (tie).
    playAllHints(session, NOW + 10000);
    for (const playerId of session.playerIds) {
      choose(session, playerId, "continue", NOW + 15000);
    }

    expect(session.phase.kind).toBe("over");
    if (session.phase.kind !== "over") return;
    expect(session.phase.outcome).toBe("tie");
  });

  it("respects a custom maxRounds override", () => {
    const session = createImpostorSession({
      playerIds: ["a", "b", "c"],
      impostorCount: 1,
      wordPool: POOL,
      random: mulberry32(42),
      now: NOW,
      maxRounds: 1,
    });

    // Round 1 (the max): all hint, all continue → game over (tie).
    playAllHints(session, NOW);
    for (const playerId of session.playerIds) {
      choose(session, playerId, "continue", NOW + 5000);
    }

    expect(session.phase.kind).toBe("over");
    if (session.phase.kind !== "over") return;
    expect(session.phase.outcome).toBe("tie");
  });

  it("still allows voting before max rounds is reached", () => {
    const session = createImpostorSession({
      playerIds: ["a", "b", "c"],
      impostorCount: 1,
      wordPool: POOL,
      random: mulberry32(42),
      now: NOW,
      maxRounds: 2,
    });

    // Round 1: all hint, then vote.
    playAllHints(session, NOW);
    for (const playerId of session.playerIds) {
      choose(session, playerId, "vote", NOW + 5000);
    }

    expect(session.phase.kind).toBe("vote");
  });
});

describe("castVote + resolution", () => {
  it("votes out the impostor and moves to the guess phase", () => {
    const session = newSession(1);
    const impostor = Object.keys(session.roleByPlayerId).find(
      (id) => session.roleByPlayerId[id] === "impostor"
    )!;
    const crewmates = session.playerIds.filter((id) => id !== impostor);
    playAllHints(session, NOW);
    for (const playerId of session.playerIds) {
      choose(session, playerId, "vote", NOW + 5000);
    }

    for (const playerId of crewmates) {
      castVote(session, playerId, impostor);
    }
    castVote(session, impostor, crewmates[0]);

    expect(session.votedOutId).toBe(impostor);
    expect(session.phase.kind).toBe("guess");
  });

  it("ends with crewmates losing when a crewmate is voted out", () => {
    const session = newSession(1);
    const impostor = Object.keys(session.roleByPlayerId).find(
      (id) => session.roleByPlayerId[id] === "impostor"
    )!;
    const crewmate = session.playerIds.find((id) => id !== impostor)!;
    playAllHints(session, NOW);
    for (const playerId of session.playerIds) {
      choose(session, playerId, "vote", NOW + 5000);
    }

    for (const playerId of session.playerIds) {
      castVote(session, playerId, crewmate);
    }

    expect(session.phase.kind).toBe("over");
    if (session.phase.kind !== "over") return;
    expect(session.phase.outcome).toBe("crewmates-lose");
  });

  it("ends on a tie screen when the top vote is shared", () => {
    const session = newSession(1);
    playAllHints(session, NOW);
    for (const playerId of session.playerIds) {
      choose(session, playerId, "vote", NOW + 5000);
    }

    castVote(session, "a", "b");
    castVote(session, "b", "c");
    castVote(session, "c", "a");

    expect(session.phase.kind).toBe("over");
    if (session.phase.kind !== "over") return;
    expect(session.phase.outcome).toBe("tie");
  });
});

describe("submitGuess", () => {
  function sessionAtGuess(guessTimeMs?: number): ImpostorSession {
    const session = newSession(1, guessTimeMs);
    const impostor = Object.keys(session.roleByPlayerId).find(
      (id) => session.roleByPlayerId[id] === "impostor"
    )!;
    const crewmates = session.playerIds.filter((id) => id !== impostor);
    playAllHints(session, NOW);
    for (const playerId of session.playerIds) {
      choose(session, playerId, "vote", NOW + 5000);
    }
    for (const playerId of crewmates) {
      castVote(session, playerId, impostor, NOW + 6000);
    }
    castVote(session, impostor, crewmates[0], NOW + 6000);
    return session;
  }

  it("draws when the impostor guesses the word correctly", () => {
    const session = sessionAtGuess();

    submitGuess(session, session.votedOutId!, session.secretWord);

    expect(session.phase.kind).toBe("over");
    if (session.phase.kind !== "over") return;
    expect(session.phase.outcome).toBe("draw");
  });

  it("crewmates win when the impostor guesses wrong", () => {
    const session = sessionAtGuess();

    submitGuess(session, session.votedOutId!, "bicycle");

    expect(session.phase.kind).toBe("over");
    if (session.phase.kind !== "over") return;
    expect(session.phase.outcome).toBe("crewmates-win");
  });

  it("rejects a guess from anyone but the voted-out impostor", () => {
    const session = sessionAtGuess();
    const other = session.playerIds.find((id) => id !== session.votedOutId)!;

    expect(() => submitGuess(session, other, session.secretWord)).toThrow(
      /only the voted-out impostor/
    );
  });

  it("caps the guess wait: the default deadline is 30s from the final vote", () => {
    const session = sessionAtGuess();
    if (session.phase.kind !== "guess") throw new Error("expected guess phase");

    expect(session.phase.playerId).toBe(session.votedOutId);
    expect(session.phase.deadline).toBe(NOW + 6000 + GUESS_TIME_MS);
  });

  it("honors a guess-time override for tests and host tuning", () => {
    const session = sessionAtGuess(150);
    if (session.phase.kind !== "guess") throw new Error("expected guess phase");

    expect(session.phase.deadline).toBe(NOW + 6000 + 150);
  });

  it("resolves crewmates-win when the guess deadline passes", () => {
    const session = sessionAtGuess(150);

    timeoutGuess(session, NOW + 6000 + 151);

    expect(session.phase.kind).toBe("over");
    if (session.phase.kind !== "over") return;
    expect(session.phase.outcome).toBe("crewmates-win");
  });

  it("does nothing before the guess deadline", () => {
    const session = sessionAtGuess(150);

    timeoutGuess(session, NOW + 6000 + 149);

    expect(session.phase.kind).toBe("guess");
  });
});
