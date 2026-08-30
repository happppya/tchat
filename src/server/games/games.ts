/**
 * Minigame lifecycle manager (spec §8 Phase 0). Pure in-memory state — no DB,
 * no WebSocket — so the Lobby → Playing → Ended lifecycle and the confirmed
 * join/rejoin/soft-leave/hard-leave rules are unit-testable on their own.
 *
 * Lifecycle decisions encoded here:
 * - A player can be a participant in only **one game at a time**.
 * - Closing the game window is a **soft leave**: the player stays a
 *   participant (inactivePlayerIds) and can resume by rejoining.
 * - Leaving the room / closing the tab is a **hard leave**: the player is
 *   removed from the game entirely and cannot rejoin.
 * - Once a game starts, no new players may join (prevents the Impostor secret
 *   word leaking to late joiners); only current participants may rejoin.
 * - **Ended games have their data deleted** ("ended" = absent from the
 *   registry) to save server resources.
 *
 * Per-game settings are game-type-specific and live with the game modules
 * (e.g. src/server/impostor.ts), not here.
 */
export type GameStatus = "lobby" | "playing";

export interface Game {
  gameId: string;
  gameType: string;
  hostId: string;
  /** Room the invitation lives in; broadcasts and membership checks scope to it. */
  groupChatId: number;
  status: GameStatus;
  participantIds: string[];
  inactivePlayerIds: string[];
}

export class GameManager {
  private games = new Map<string, Game>();
  private nextId = 1;

  createGame(input: {
    gameType: string;
    hostId: string;
    groupChatId: number;
  }): Game {
    if (this.isInGame(input.hostId)) {
      throw new Error("player is already in a game");
    }
    const game: Game = {
      gameId: `game-${this.nextId++}`,
      gameType: input.gameType,
      hostId: input.hostId,
      groupChatId: input.groupChatId,
      status: "lobby",
      participantIds: [input.hostId],
      inactivePlayerIds: [],
    };
    this.games.set(game.gameId, game);
    return game;
  }

  getGame(gameId: string): Game | undefined {
    return this.games.get(gameId);
  }

  startGame(hostId: string, gameId: string): Game {
    const game = this.requireGame(gameId);
    if (hostId !== game.hostId) {
      throw new Error("only the host can start the game");
    }
    if (game.status === "playing") {
      throw new Error("game is already in progress");
    }
    game.status = "playing";
    return game;
  }

  joinGame(playerId: string, gameId: string): Game {
    const game = this.requireGame(gameId);
    if (this.isParticipant(game, playerId)) {
      throw new Error("player is already a participant of this game");
    }
    if (this.isInGame(playerId)) {
      throw new Error("player is already in a game");
    }
    if (game.status === "playing") {
      throw new Error("cannot join a game already in progress");
    }
    game.participantIds.push(playerId);
    return game;
  }

  softLeaveGame(playerId: string, gameId: string): Game {
    const game = this.requireGame(gameId);
    if (!this.isParticipant(game, playerId)) {
      throw new Error("player is not a participant of this game");
    }
    if (!game.inactivePlayerIds.includes(playerId)) {
      game.inactivePlayerIds.push(playerId);
    }
    return game;
  }

  /**
   * Leaving the room or closing the tab (spec §3.1): removes the player from
   * the game entirely — unlike softLeaveGame, they cannot rejoin.
   */
  hardLeaveGame(playerId: string, gameId: string): Game {
    const game = this.requireGame(gameId);
    if (!this.isParticipant(game, playerId)) {
      throw new Error("player is not a participant of this game");
    }
    game.participantIds = game.participantIds.filter((id) => id !== playerId);
    game.inactivePlayerIds = game.inactivePlayerIds.filter(
      (id) => id !== playerId
    );
    return game;
  }

  /**
   * Reopens the game window (spec §3.1): re-activates a soft-leaver. During
   * play only current participants qualify — new players are blocked entirely
   * and hard-leavers have been removed, so "was in the game at start" is
   * enforced by participant membership.
   */
  rejoinGame(playerId: string, gameId: string): Game {
    const game = this.requireGame(gameId);
    if (!this.isParticipant(game, playerId)) {
      throw new Error("player is not a participant of this game");
    }
    game.inactivePlayerIds = game.inactivePlayerIds.filter(
      (id) => id !== playerId
    );
    return game;
  }

  /**
   * Ends the game and **deletes its data** (spec §3.1 decision): ended games
   * cost no server resources, and clicking their invitation shows a plain
   * "game over" (the game id is simply gone from the registry).
   */
  endGame(gameId: string): void {
    this.games.delete(gameId);
  }

  /**
   * Ends every game in a room (used when the room is deleted) and returns the
   * ended game ids so callers can also drop sessions/timers keyed by game id.
   * Players are freed immediately — the one-game-at-a-time slot does not
   * outlive the room they were playing in.
   */
  endGamesInRoom(groupChatId: number): string[] {
    const ended: string[] = [];
    for (const [gameId, game] of this.games) {
      if (game.groupChatId === groupChatId) {
        this.games.delete(gameId);
        ended.push(gameId);
      }
    }
    return ended;
  }

  /**
   * The one game the player is a participant of, if any. A player can only be
   * in one game at a time, so this is at most one — used when a socket closes
   * to hard-leave whatever game the player was in.
   */
  gameOf(playerId: string): Game | undefined {
    for (const game of this.games.values()) {
      if (this.isParticipant(game, playerId)) {
        return game;
      }
    }
    return undefined;
  }

  private requireGame(gameId: string): Game {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error("game not found or has ended");
    }
    return game;
  }

  private isParticipant(game: Game, playerId: string): boolean {
    return game.participantIds.includes(playerId);
  }

  private isInGame(playerId: string): boolean {
    for (const game of this.games.values()) {
      if (this.isParticipant(game, playerId)) {
        return true;
      }
    }
    return false;
  }
}
