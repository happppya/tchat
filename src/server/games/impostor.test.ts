import { describe, expect, it } from "vitest";
import {
  assignRoles,
  checkHint,
  isGuessCorrect,
  resolveGame,
  resolveVote,
  type WordEntry,
} from "./impostor";

/** Deterministic PRNG so role/word picks are reproducible in tests. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("checkHint", () => {
  it("rejects hints longer than 100 characters", () => {
    expect(checkHint("a".repeat(101), "bird")).toEqual({
      ok: false,
      reason: "too-long",
    });
  });

  it("rejects hints containing the secret word", () => {
    expect(checkHint("the word is bird", "bird")).toEqual({
      ok: false,
      reason: "contains-word",
    });
  });

  it("rejects hints containing the secret word case-insensitively", () => {
    expect(checkHint("I saw a BIRD", "bird")).toEqual({
      ok: false,
      reason: "contains-word",
    });
  });
});

describe("isGuessCorrect", () => {
  it("accepts a guess containing the secret word as a substring", () => {
    expect(isGuessCorrect("hummingbird", "bird")).toBe(true);
  });

  it("accepts the secret word case-insensitively", () => {
    expect(isGuessCorrect("Bird", "bird")).toBe(true);
  });

  it("rejects a guess that does not contain the secret word", () => {
    expect(isGuessCorrect("bicycle", "bird")).toBe(false);
  });
});

describe("resolveVote", () => {
  it("votes out the player with the most votes", () => {
    expect(resolveVote({ a: "x", b: "x", c: "y" })).toEqual({
      kind: "voted-out",
      votedOutPlayerId: "x",
    });
  });

  it("returns a tie when the top votes are shared", () => {
    expect(resolveVote({ a: "x", b: "x", c: "y", d: "y" })).toEqual({
      kind: "tie",
      tiedPlayerIds: ["x", "y"],
    });
  });

  it("returns an empty tie when nobody voted", () => {
    expect(resolveVote({})).toEqual({ kind: "tie", tiedPlayerIds: [] });
  });
});

describe("resolveGame", () => {
  it("ends with crewmates losing when a crewmate is voted out", () => {
    expect(
      resolveGame({ votedOutIsImpostor: false, guess: null, secretWord: "bird" })
    ).toBe("crewmates-lose");
  });

  it("ends with crewmates winning when the impostor guesses wrong", () => {
    expect(
      resolveGame({ votedOutIsImpostor: true, guess: "bicycle", secretWord: "bird" })
    ).toBe("crewmates-win");
  });

  it("ends in a draw when the impostor guesses the word correctly", () => {
    expect(
      resolveGame({ votedOutIsImpostor: true, guess: "hummingbird", secretWord: "bird" })
    ).toBe("draw");
  });

  it("throws when a voted-out impostor has no guess", () => {
    expect(() =>
      resolveGame({ votedOutIsImpostor: true, guess: null, secretWord: "bird" })
    ).toThrow();
  });
});

describe("assignRoles", () => {
  const pool: WordEntry[] = [
    { word: "bird", hint: "flies" },
    { word: "ocean", hint: "salty" },
    { word: "guitar", hint: "strings" },
  ];

  it("marks exactly the requested number of players as impostors", () => {
    const players = ["a", "b", "c", "d", "e"];
    const assignment = assignRoles(players, 2, pool, mulberry32(42));

    const roles = Object.values(assignment.roleByPlayerId);
    expect(roles.filter((r) => r === "impostor")).toHaveLength(2);
    expect(roles.filter((r) => r === "crewmate")).toHaveLength(3);
    for (const id of players) {
      expect(assignment.roleByPlayerId[id]).toBeDefined();
    }
  });

  it("picks the secret word and its matching hint from the pool", () => {
    const assignment = assignRoles(["a", "b", "c"], 1, pool, mulberry32(7));

    const entry = pool.find((e) => e.word === assignment.secretWord);
    expect(entry).toBeDefined();
    expect(assignment.hint).toBe(entry!.hint);
  });

  it("is deterministic for the same random seed", () => {
    const players = ["a", "b", "c", "d"];
    const first = assignRoles(players, 1, pool, mulberry32(99));
    const second = assignRoles(players, 1, pool, mulberry32(99));

    expect(second).toEqual(first);
  });

  it("throws when the impostor count is not a positive integer", () => {
    expect(() => assignRoles(["a", "b", "c"], 0, pool, mulberry32(1))).toThrow(
      /impostorCount/
    );
  });

  it("throws when every player would be an impostor", () => {
    expect(() =>
      assignRoles(["a", "b", "c"], 3, pool, mulberry32(1))
    ).toThrow(/impostorCount/);
  });

  it("throws when the word pool is empty", () => {
    expect(() => assignRoles(["a", "b"], 1, [], mulberry32(1))).toThrow(
      /word pool/
    );
  });
});
