import { describe, expect, it } from "vitest";
import { GameManager } from "./games";

describe("createGame", () => {
  it("creates a lobby game with the creator as host and participant", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });

    expect(game.status).toBe("lobby");
    expect(game.gameType).toBe("impostor");
    expect(game.hostId).toBe("u1");
    expect(game.groupChatId).toBe(555);
    expect(game.participantIds).toEqual(["u1"]);
    expect(game.inactivePlayerIds).toEqual([]);
  });

  it("throws when the creator is already in another game", () => {
    const manager = new GameManager();
    manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });

    expect(() =>
      manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 })
    ).toThrow(/already in a game/);
  });
});

describe("startGame", () => {
  it("moves the game from lobby to playing when the host starts it", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });

    const updated = manager.startGame("u1", game.gameId);

    expect(updated.status).toBe("playing");
  });

  it("throws when a non-host tries to start the game", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });

    expect(() => manager.startGame("u2", game.gameId)).toThrow(/only the host/);
  });

  it("throws when the game is already in progress", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.startGame("u1", game.gameId);

    expect(() => manager.startGame("u1", game.gameId)).toThrow(
      /already in progress/
    );
  });

  it("throws when the game does not exist or has ended", () => {
    const manager = new GameManager();

    expect(() => manager.startGame("u1", "game-999")).toThrow(
      /not found or has ended/
    );
  });
});

describe("joinGame", () => {
  it("adds a new player to a lobby game", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });

    const updated = manager.joinGame("u2", game.gameId);

    expect(updated.participantIds).toEqual(["u1", "u2"]);
  });

  it("blocks new players from joining a game already in progress", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.joinGame("u2", game.gameId);
    manager.startGame("u1", game.gameId);

    expect(() => manager.joinGame("u3", game.gameId)).toThrow(
      /already in progress/
    );
  });

  it("throws when the player is already a participant (rejoin instead)", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });

    expect(() => manager.joinGame("u1", game.gameId)).toThrow(
      /already a participant/
    );
  });

  it("throws when the player is already in a different game", () => {
    const manager = new GameManager();
    const first = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    const second = manager.createGame({ gameType: "impostor", hostId: "u2", groupChatId: 555 });

    expect(() => manager.joinGame("u1", second.gameId)).toThrow(
      /already in a game/
    );
  });

  it("throws when the game does not exist or has ended", () => {
    const manager = new GameManager();

    expect(() => manager.joinGame("u1", "game-999")).toThrow(
      /not found or has ended/
    );
  });
});

describe("softLeaveGame", () => {
  it("keeps the player a participant but marks them inactive", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.joinGame("u2", game.gameId);

    const updated = manager.softLeaveGame("u2", game.gameId);

    expect(updated.participantIds).toEqual(["u1", "u2"]);
    expect(updated.inactivePlayerIds).toEqual(["u2"]);
  });

  it("keeps the player in the game during play (resumable later)", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.joinGame("u2", game.gameId);
    manager.startGame("u1", game.gameId);

    const updated = manager.softLeaveGame("u2", game.gameId);

    expect(updated.status).toBe("playing");
    expect(updated.participantIds).toEqual(["u1", "u2"]);
    expect(updated.inactivePlayerIds).toEqual(["u2"]);
  });

  it("does not free the one-game-at-a-time slot (still a participant)", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.joinGame("u2", game.gameId);
    manager.softLeaveGame("u2", game.gameId);
    const other = manager.createGame({ gameType: "impostor", hostId: "u3", groupChatId: 555 });

    expect(() => manager.joinGame("u2", other.gameId)).toThrow(
      /already in a game/
    );
  });

  it("throws when the player is not a participant", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });

    expect(() => manager.softLeaveGame("u9", game.gameId)).toThrow(
      /not a participant/
    );
  });
});

describe("rejoinGame", () => {
  it("re-activates a soft-leaver in a lobby game", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.joinGame("u2", game.gameId);
    manager.softLeaveGame("u2", game.gameId);

    const updated = manager.rejoinGame("u2", game.gameId);

    expect(updated.inactivePlayerIds).toEqual([]);
  });

  it("lets an original participant resume a game in progress", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.joinGame("u2", game.gameId);
    manager.startGame("u1", game.gameId);
    manager.softLeaveGame("u2", game.gameId);

    const updated = manager.rejoinGame("u2", game.gameId);

    expect(updated.status).toBe("playing");
    expect(updated.inactivePlayerIds).toEqual([]);
  });

  it("blocks a player who was never in the game from rejoining mid-play", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.joinGame("u2", game.gameId);
    manager.startGame("u1", game.gameId);

    expect(() => manager.rejoinGame("u9", game.gameId)).toThrow(
      /not a participant/
    );
  });

  it("throws when the game does not exist or has ended", () => {
    const manager = new GameManager();

    expect(() => manager.rejoinGame("u1", "game-999")).toThrow(
      /not found or has ended/
    );
  });
});

describe("hardLeaveGame", () => {
  it("removes the player from the game entirely", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.joinGame("u2", game.gameId);
    manager.softLeaveGame("u2", game.gameId);

    const updated = manager.hardLeaveGame("u2", game.gameId);

    expect(updated.participantIds).toEqual(["u1"]);
    expect(updated.inactivePlayerIds).toEqual([]);
  });

  it("prevents a hard-leaver from rejoining mid-play (removed, not soft-left)", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.joinGame("u2", game.gameId);
    manager.startGame("u1", game.gameId);
    manager.hardLeaveGame("u2", game.gameId);

    expect(() => manager.rejoinGame("u2", game.gameId)).toThrow(
      /not a participant/
    );
  });

  it("frees the player to join another game afterwards", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.joinGame("u2", game.gameId);
    manager.hardLeaveGame("u2", game.gameId);
    const other = manager.createGame({ gameType: "impostor", hostId: "u3", groupChatId: 555 });

    const updated = manager.joinGame("u2", other.gameId);

    expect(updated.participantIds).toEqual(["u3", "u2"]);
  });

  it("throws when the player is not a participant", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });

    expect(() => manager.hardLeaveGame("u9", game.gameId)).toThrow(
      /not a participant/
    );
  });
});

describe("endGame", () => {
  it("deletes the game data when the game ends", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });

    manager.endGame(game.gameId);

    expect(manager.getGame(game.gameId)).toBeUndefined();
  });

  it("rejects joins after the game has ended (data deleted)", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.joinGame("u2", game.gameId);
    manager.endGame(game.gameId);

    expect(() => manager.joinGame("u3", game.gameId)).toThrow(
      /not found or has ended/
    );
  });

  it("rejects rejoins after the game has ended", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.joinGame("u2", game.gameId);
    manager.endGame(game.gameId);

    expect(() => manager.rejoinGame("u2", game.gameId)).toThrow(
      /not found or has ended/
    );
  });

  it("frees all participants to join other games", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.joinGame("u2", game.gameId);
    manager.endGame(game.gameId);

    const other = manager.createGame({ gameType: "impostor", hostId: "u3", groupChatId: 555 });
    expect(manager.joinGame("u2", other.gameId).participantIds).toEqual([
      "u3",
      "u2",
    ]);
  });
});

describe("endGamesInRoom", () => {
  it("deletes every game hosted in a room and returns their ids", () => {
    const manager = new GameManager();
    const g1 = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    const g2 = manager.createGame({ gameType: "impostor", hostId: "u2", groupChatId: 555 });

    const ended = manager.endGamesInRoom(555);

    expect(ended).toEqual([g1.gameId, g2.gameId]);
    expect(manager.getGame(g1.gameId)).toBeUndefined();
    expect(manager.getGame(g2.gameId)).toBeUndefined();
  });

  it("leaves games in other rooms untouched", () => {
    const manager = new GameManager();
    const kept = manager.createGame({ gameType: "impostor", hostId: "u3", groupChatId: 666 });
    manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });

    manager.endGamesInRoom(555);

    expect(manager.getGame(kept.gameId)).toBeDefined();
  });

  it("frees players of deleted rooms so they can create or join elsewhere", () => {
    const manager = new GameManager();
    manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.endGamesInRoom(555);

    const other = manager.createGame({ gameType: "impostor", hostId: "u2", groupChatId: 777 });
    expect(manager.joinGame("u1", other.gameId).participantIds).toEqual([
      "u2",
      "u1",
    ]);
  });

  it("returns an empty list when the room has no games", () => {
    const manager = new GameManager();
    expect(manager.endGamesInRoom(999)).toEqual([]);
  });
});

describe("gameOf", () => {
  it("returns the single game a player is in (one game at a time)", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.joinGame("u2", game.gameId);

    expect(manager.gameOf("u1")?.gameId).toBe(game.gameId);
    expect(manager.gameOf("u2")?.gameId).toBe(game.gameId);
  });

  it("returns undefined for a player in no game", () => {
    const manager = new GameManager();
    expect(manager.gameOf("u9")).toBeUndefined();
  });

  it("returns undefined once the player's game is deleted", () => {
    const manager = new GameManager();
    const game = manager.createGame({ gameType: "impostor", hostId: "u1", groupChatId: 555 });
    manager.endGame(game.gameId);
    expect(manager.gameOf("u1")).toBeUndefined();
  });
});
