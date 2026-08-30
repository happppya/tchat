import { describe, expect, it } from "vitest";
import { GAME_TYPES, getGameType, isKnownGameType } from "./gameTypes";

describe("game type registry", () => {
  it("lists both planned games with display metadata", () => {
    expect(GAME_TYPES.map((g) => g.id)).toEqual([
      "impostor",
      "complete-the-funny",
    ]);
    for (const game of GAME_TYPES) {
      expect(game.displayName.length).toBeGreaterThan(0);
      expect(game.icon.length).toBeGreaterThan(0);
      expect(game.description.length).toBeGreaterThan(0);
    }
  });

  it("looks up a game type by id", () => {
    expect(getGameType("impostor")?.displayName).toBe("Impostor");
    expect(getGameType("complete-the-funny")).toBeDefined();
  });

  it("returns undefined for unknown game types", () => {
    expect(getGameType("fortnite")).toBeUndefined();
  });

  it("recognizes only registered game types", () => {
    expect(isKnownGameType("impostor")).toBe(true);
    expect(isKnownGameType("complete-the-funny")).toBe(true);
    expect(isKnownGameType("nope")).toBe(false);
  });
});
