import { afterAll, beforeEach, describe, expect, it } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { WebSocket, WebSocketServer } from "ws";

import { openDatabase, type DB } from "./db";
import { createRealtime, attachMessageHandler } from "./realtime";
import { MAX_MESSAGE_LENGTH, MAX_WS_FRAME_BYTES } from "./constants";
import type { Session } from "./auth";

/**
 * Integration-style tests for the WebSocket layer. A real ws server is booted
 * per test (mirroring server.ts's upgrade flow) against an in-memory SQLite
 * database; sessions are injected exactly like the HTTP upgrade handler does.
 */

const ALICE: Session = { userId: 1, username: "alice", isAdmin: false, expires: Date.now() + 60_000 };
const BOB: Session = { userId: 2, username: "bob", isAdmin: false, expires: Date.now() + 60_000 };
const CAROL: Session = { userId: 3, username: "carol", isAdmin: false, expires: Date.now() + 60_000 };

let db: DB;
let wss: WebSocketServer;
let httpServer: http.Server;
let baseUrl: string;
let gameCleanup: { endGamesInRoom: (groupChatId: number) => void };
const pendingSessions: Array<Session | null> = [];

beforeEach(async () => {
  if (!db) db = await openDatabase(":memory:");
  // Fresh state per test.
  await db.exec(
    "DELETE FROM messages; DELETE FROM group_chats; DELETE FROM room_members;"
  );

  const realtime = createRealtime({ db });
  wss = realtime.wss;
  gameCleanup = attachMessageHandler({
    wss,
    db,
    broadcast: realtime.broadcast,
    sendToUser: realtime.sendToUser,
  });

  pendingSessions.length = 0;
  httpServer = http.createServer();
  httpServer.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as typeof ws & { session?: Session }).session =
        pendingSessions.shift() ?? undefined;
      wss.emit("connection", ws, req);
    });
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `ws://127.0.0.1:${port}/ws`;
});

afterAll(async () => {
  await db.close();
});

function connect(session: Session | null): Promise<WebSocket> {
  pendingSessions.push(session);
  const ws = new WebSocket(baseUrl);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

/** Next JSON frame from a socket, with a timeout so hangs fail fast. */
// Frames arriving on a socket are buffered and handed out FIFO, one per
// pending nextFrame. A naive `ws.once` per call would let the first frame
// resolve every pending promise on the socket (all listeners fire on every
// message), so a socket with two pending waiters (e.g. role + play frames)
// would hand the same frame to both and drop the real second frame.
const frameQueues = new WeakMap<
  WebSocket,
  { frames: Record<string, any>[]; waiters: ((f: Record<string, any>) => void)[] }
>();

function nextFrame(ws: WebSocket, ms = 2000): Promise<Record<string, any>> {
  let entry = frameQueues.get(ws);
  if (!entry) {
    entry = { frames: [], waiters: [] };
    frameQueues.set(ws, entry);
    ws.on("message", (data) => {
      const frame = JSON.parse(data.toString());
      const waiter = entry!.waiters.shift();
      if (waiter) waiter(frame);
      else entry!.frames.push(frame);
    });
  }
  return new Promise((resolve, reject) => {
    const buffered = entry!.frames.shift();
    if (buffered) {
      resolve(buffered);
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    const waiter = (frame: Record<string, any>) => {
      if (timer) clearTimeout(timer);
      resolve(frame);
    };
    timer = setTimeout(() => {
      const idx = entry!.waiters.indexOf(waiter);
      if (idx >= 0) entry!.waiters.splice(idx, 1);
      reject(new Error("timed out waiting for frame"));
    }, ms);
    entry!.waiters.push(waiter);
  });
}

/**
 * Create a lobby game in room 555 (alice hosts, bob joins). Returns live
 * sockets plus the gameId; both players' join broadcasts are consumed.
 */
async function lobbyWithAliceAndBob(): Promise<{
  alice: WebSocket;
  bob: WebSocket;
  gameId: string;
}> {
  const alice = await connect(ALICE);
  alice.send(
    JSON.stringify({ type: "gameCreate", gameType: "impostor", groupChatId: 555 })
  );
  const created = await nextFrame(alice);

  await db.run("INSERT INTO room_members (user_id, room_id) VALUES (2, 555)");
  const bob = await connect(BOB);
  const atBob = nextFrame(bob);
  const atAlice = nextFrame(alice);
  bob.send(JSON.stringify({ type: "gameJoin", gameId: created.gameId }));
  await atBob;
  await atAlice;

  return { alice, bob, gameId: created.gameId };
}

/**
 * Start an impostor game (host-only) and consume each player's private role
 * frame plus the gamePlay broadcast, returning all of them.
 */
async function startGameFor(
  alice: WebSocket,
  bob: WebSocket,
  gameId: string,
  settings?: Record<string, unknown>
): Promise<{
  roleAlice: Record<string, any>;
  roleBob: Record<string, any>;
  playAlice: Record<string, any>;
  playBob: Record<string, any>;
}> {
  const roleAlice = nextFrame(alice);
  const roleBob = nextFrame(bob);
  const playAlice = nextFrame(alice);
  const playBob = nextFrame(bob);
  alice.send(JSON.stringify({ type: "gameStart", gameId, settings }));
  return {
    roleAlice: await roleAlice,
    roleBob: await roleBob,
    playAlice: await playAlice,
    playBob: await playBob,
  };
}

function expectClose(ws: WebSocket, ms = 2000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket never closed")), ms);
    ws.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

describe("gif url validation", () => {
  beforeEach(async () => {
    await db.run(
      "INSERT INTO group_chats (id, name) VALUES (666, 'Gif Room')"
    );
    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (1, 666)");
  });

  it("rejects GIF urls pointing outside the GIPHY CDN", async () => {
    const alice = await connect(ALICE);
    alice.send(
      JSON.stringify({
        type: "message",
        groupChatId: 666,
        gifUrl: "https://evil.example/track.gif",
        messageText: "",
      })
    );
    const errFrame = await nextFrame(alice);
    expect(errFrame.type).toBe("error");

    // Nothing may be persisted — the "gif" would leak every viewer's IP.
    const row = await db.get(
      "SELECT COUNT(*) AS count FROM messages WHERE group_chat_id = 666"
    );
    expect(row.count).toBe(0);
  });

  it("accepts GIPHY CDN gif urls over https", async () => {
    const alice = await connect(ALICE);
    alice.send(
      JSON.stringify({
        type: "message",
        groupChatId: 666,
        gifUrl: "https://media.giphy.com/media/abc123/giphy.gif",
        messageText: "",
      })
    );
    const echo = await nextFrame(alice);
    expect(echo.type).toBe("message");
    expect(echo.gifUrl).toBe("https://media.giphy.com/media/abc123/giphy.gif");
  });
});

describe("broadcast scoping + send authorization", () => {
  // Room 555 exists; only alice is a member.
  beforeEach(async () => {
    await db.run(
      "INSERT INTO group_chats (id, name) VALUES (555, 'Members Only')"
    );
    await db.run(
      "INSERT INTO room_members (user_id, room_id) VALUES (1, 555)"
    );
  });

  it("delivers room messages only to that room's members", async () => {
    const alice = await connect(ALICE);
    const bob = await connect(BOB);

    let bobFrames: Record<string, any>[] = [];
    bob.on("message", (data) => bobFrames.push(JSON.parse(data.toString())));

    alice.send(
      JSON.stringify({ type: "message", groupChatId: 555, messageText: "hi members" })
    );
    const echo = await nextFrame(alice);
    expect(echo.type).toBe("message");
    expect(echo.id).toBeGreaterThan(0);

    // Give any misdirected delivery a beat to arrive.
    await new Promise((r) => setTimeout(r, 150));
    expect(bobFrames).toHaveLength(0);
  });

  it("refuses to store messages from non-members", async () => {
    const bob = await connect(BOB);
    bob.send(
      JSON.stringify({ type: "message", groupChatId: 555, messageText: "let me in" })
    );
    const errFrame = await nextFrame(bob);
    expect(errFrame.type).toBe("error");

    const row = await db.get(
      "SELECT COUNT(*) AS count FROM messages WHERE group_chat_id = 555"
    );
    expect(row.count).toBe(0);
  });

  it("rejects messages over MAX_MESSAGE_LENGTH with an error frame", async () => {
    const alice = await connect(ALICE);
    alice.send(
      JSON.stringify({
        type: "message",
        groupChatId: 555,
        messageText: "x".repeat(MAX_MESSAGE_LENGTH + 1),
      })
    );
    const errFrame = await nextFrame(alice);
    expect(errFrame.type).toBe("error");
    expect(errFrame.messageText).toContain("250");

    const row = await db.get(
      "SELECT COUNT(*) AS count FROM messages WHERE group_chat_id = 555"
    );
    expect(row.count).toBe(0);
  });

  it("accepts a message at exactly MAX_MESSAGE_LENGTH", async () => {
    const alice = await connect(ALICE);
    alice.send(
      JSON.stringify({
        type: "message",
        groupChatId: 555,
        messageText: "y".repeat(MAX_MESSAGE_LENGTH),
      })
    );
    const echo = await nextFrame(alice);
    expect(echo.type).toBe("message");
    expect(echo.messageText).toHaveLength(250);
  });

  it("still delivers to every member of the room", async () => {
    const alice = await connect(ALICE);
    const bob = await connect(BOB);
    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (2, 555)");

    alice.send(
      JSON.stringify({ type: "message", groupChatId: 555, messageText: "hello both" })
    );

    const fromAlice = await nextFrame(alice);
    expect(fromAlice.messageText).toBe("hello both");
    const atBob = await nextFrame(bob);
    expect(atBob.messageText).toBe("hello both");
    expect(atBob.id).toBe(fromAlice.id);
  });
});

describe("game protocol", () => {
  beforeEach(async () => {
    await db.run("INSERT INTO group_chats (id, name) VALUES (555, 'Game Room')");
    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (1, 555)");
  });

  it("broadcasts a lobby gameState to the room when a member creates a game", async () => {
    const alice = await connect(ALICE);
    const bob = await connect(BOB);
    let bobFrames: Record<string, any>[] = [];
    bob.on("message", (data) => bobFrames.push(JSON.parse(data.toString())));

    alice.send(
      JSON.stringify({
        type: "gameCreate",
        gameType: "impostor",
        groupChatId: 555,
      })
    );
    const state = await nextFrame(alice);

    expect(state.type).toBe("gameState");
    expect(state.gameId).toBeTruthy();
    expect(state.gameType).toBe("impostor");
    expect(state.hostId).toBe("1");
    expect(state.groupChatId).toBe(555);
    expect(state.status).toBe("lobby");
    expect(state.participantIds).toEqual(["1"]);
    expect(state.inactivePlayerIds).toEqual([]);

    // Non-members of the room must not see the invitation.
    await new Promise((r) => setTimeout(r, 150));
    expect(bobFrames).toHaveLength(0);
  });

  it("rejects game creation from non-members", async () => {
    const bob = await connect(BOB);
    bob.send(
      JSON.stringify({
        type: "gameCreate",
        gameType: "impostor",
        groupChatId: 555,
      })
    );
    const errFrame = await nextFrame(bob);
    expect(errFrame.type).toBe("error");
    expect(errFrame.messageText).toContain("Join this room");
  });

  it("adds a member who joins the game and broadcasts the new roster", async () => {
    const alice = await connect(ALICE);
    alice.send(
      JSON.stringify({
        type: "gameCreate",
        gameType: "impostor",
        groupChatId: 555,
      })
    );
    const created = await nextFrame(alice);

    // Bob connects after the invitation so his first frame is the join update
    // (no create-broadcast delivery race).
    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (2, 555)");
    const bob = await connect(BOB);
    // Attach both listeners before sending, or the first recipient's copy of
    // the broadcast can arrive (and be lost) while we await the other's.
    const atBob = nextFrame(bob);
    const atAlice = nextFrame(alice);
    bob.send(JSON.stringify({ type: "gameJoin", gameId: created.gameId }));

    const bobState = await atBob;
    expect(bobState.type).toBe("gameState");
    expect(bobState.participantIds).toEqual(["1", "2"]);
    const aliceState = await atAlice;
    expect(aliceState.type).toBe("gameState");
    expect(aliceState.participantIds).toEqual(["1", "2"]);
  });

  it("rejects joins from non-members of the game's room", async () => {
    const alice = await connect(ALICE);
    const bob = await connect(BOB);

    alice.send(
      JSON.stringify({
        type: "gameCreate",
        gameType: "impostor",
        groupChatId: 555,
      })
    );
    const created = await nextFrame(alice);
    bob.send(JSON.stringify({ type: "gameJoin", gameId: created.gameId }));

    const errFrame = await nextFrame(bob);
    expect(errFrame.type).toBe("error");
    expect(errFrame.messageText).toContain("Join this room");
  });

  it("rejects joins for a game that does not exist", async () => {
    const bob = await connect(BOB);

    bob.send(JSON.stringify({ type: "gameJoin", gameId: "game-999" }));

    const errFrame = await nextFrame(bob);
    expect(errFrame.type).toBe("error");
    expect(errFrame.messageText).toContain("not found or has ended");
  });

  it("lets the host start the game and broadcasts the playing state", async () => {
    const alice = await connect(ALICE);
    alice.send(
      JSON.stringify({ type: "gameCreate", gameType: "impostor", groupChatId: 555 })
    );
    const created = await nextFrame(alice);

    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (2, 555)");
    const bob = await connect(BOB);
    const atBobJoin = nextFrame(bob);
    const atAliceJoin = nextFrame(alice);
    bob.send(JSON.stringify({ type: "gameJoin", gameId: created.gameId }));
    await atBobJoin;
    await atAliceJoin;

    // Start deals private roles, then broadcasts the playing state.
    const { roleBob, roleAlice } = await startGameFor(alice, bob, created.gameId);
    expect(roleAlice.type).toBe("gameRole");
    expect(roleBob.type).toBe("gameRole");
  });

  it("rejects starting the game from a non-host", async () => {
    const alice = await connect(ALICE);
    alice.send(
      JSON.stringify({ type: "gameCreate", gameType: "impostor", groupChatId: 555 })
    );
    const created = await nextFrame(alice);

    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (2, 555)");
    const bob = await connect(BOB);
    const atBobJoin = nextFrame(bob);
    const atAliceJoin = nextFrame(alice);
    bob.send(JSON.stringify({ type: "gameJoin", gameId: created.gameId }));
    await atBobJoin;
    await atAliceJoin;

    bob.send(JSON.stringify({ type: "gameStart", gameId: created.gameId }));
    const errFrame = await nextFrame(bob);
    expect(errFrame.type).toBe("error");
    expect(errFrame.messageText).toContain("only the host");
  });

  it("blocks new players from joining after the game has started", async () => {
    const alice = await connect(ALICE);
    alice.send(
      JSON.stringify({ type: "gameCreate", gameType: "impostor", groupChatId: 555 })
    );
    const created = await nextFrame(alice);

    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (2, 555)");
    const bob = await connect(BOB);
    const atBobJoin = nextFrame(bob);
    const atAliceJoin = nextFrame(alice);
    bob.send(JSON.stringify({ type: "gameJoin", gameId: created.gameId }));
    await atBobJoin;
    await atAliceJoin;

    await startGameFor(alice, bob, created.gameId);

    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (3, 555)");
    const carol = await connect(CAROL);
    carol.send(JSON.stringify({ type: "gameJoin", gameId: created.gameId }));

    const errFrame = await nextFrame(carol);
    expect(errFrame.type).toBe("error");
    expect(errFrame.messageText).toContain("already in progress");
  });

  it("soft-leaves a player and broadcasts the inactive roster", async () => {
    const { alice, bob, gameId } = await lobbyWithAliceAndBob();

    const atBob = nextFrame(bob);
    const atAlice = nextFrame(alice);
    bob.send(JSON.stringify({ type: "gameSoftLeave", gameId }));

    const bobState = await atBob;
    expect(bobState.type).toBe("gameState");
    expect(bobState.participantIds).toEqual(["1", "2"]);
    expect(bobState.inactivePlayerIds).toEqual(["2"]);
    const aliceState = await atAlice;
    expect(aliceState.inactivePlayerIds).toEqual(["2"]);
  });

  it("rejoins a soft-leaver mid-play and re-activates them", async () => {
    const { alice, bob, gameId } = await lobbyWithAliceAndBob();
    await startGameFor(alice, bob, gameId);

    const softBob = nextFrame(bob);
    const softAlice = nextFrame(alice);
    bob.send(JSON.stringify({ type: "gameSoftLeave", gameId }));
    await softBob;
    await softAlice;

    const rejoinBob = nextFrame(bob);
    const rejoinAlice = nextFrame(alice);
    bob.send(JSON.stringify({ type: "gameRejoin", gameId }));

    const bobState = await rejoinBob;
    expect(bobState.status).toBe("playing");
    expect(bobState.inactivePlayerIds).toEqual([]);
    const aliceState = await rejoinAlice;
    expect(aliceState.inactivePlayerIds).toEqual([]);
  });

  it("hard-leaves a player mid-play and removes them from the roster", async () => {
    const { alice, bob, gameId } = await lobbyWithAliceAndBob();
    await startGameFor(alice, bob, gameId);

    const atBob = nextFrame(bob);
    const atAlice = nextFrame(alice);
    bob.send(JSON.stringify({ type: "gameHardLeave", gameId }));

    const bobState = await atBob;
    expect(bobState.status).toBe("playing");
    expect(bobState.participantIds).toEqual(["1"]);
    const aliceState = await atAlice;
    expect(aliceState.participantIds).toEqual(["1"]);
  });

  it("prevents a hard-leaver from rejoining", async () => {
    const { alice, bob, gameId } = await lobbyWithAliceAndBob();
    await startGameFor(alice, bob, gameId);

    const atBob = nextFrame(bob);
    const atAlice = nextFrame(alice);
    bob.send(JSON.stringify({ type: "gameHardLeave", gameId }));
    await atBob;
    await atAlice;

    bob.send(JSON.stringify({ type: "gameRejoin", gameId }));
    const errFrame = await nextFrame(bob);
    expect(errFrame.type).toBe("error");
    expect(errFrame.messageText).toContain("not a participant");
  });

  it("lets the host end the game and broadcasts gameEnded to the room", async () => {
    const { alice, bob, gameId } = await lobbyWithAliceAndBob();

    const atBob = nextFrame(bob);
    const atAlice = nextFrame(alice);
    alice.send(JSON.stringify({ type: "gameEnd", gameId }));

    const bobEnd = await atBob;
    expect(bobEnd.type).toBe("gameEnded");
    expect(bobEnd.gameId).toBe(gameId);
    const aliceEnd = await atAlice;
    expect(aliceEnd.type).toBe("gameEnded");
    expect(aliceEnd.groupChatId).toBe(555);
  });

  it("rejects ending the game from a non-host", async () => {
    const { alice, bob, gameId } = await lobbyWithAliceAndBob();

    bob.send(JSON.stringify({ type: "gameEnd", gameId }));
    const errFrame = await nextFrame(bob);
    expect(errFrame.type).toBe("error");
    expect(errFrame.messageText).toContain("only the host");
  });

  it("rejects game actions after the game has ended (data deleted)", async () => {
    const { alice, bob, gameId } = await lobbyWithAliceAndBob();

    const atBob = nextFrame(bob);
    const atAlice = nextFrame(alice);
    alice.send(JSON.stringify({ type: "gameEnd", gameId }));
    await atBob;
    await atAlice;

    bob.send(JSON.stringify({ type: "gameRejoin", gameId }));
    const errFrame = await nextFrame(bob);
    expect(errFrame.type).toBe("error");
    expect(errFrame.messageText).toContain("not found or has ended");
  });

  it("blocks creating a second game while already in one (one game at a time)", async () => {
    const { alice } = await lobbyWithAliceAndBob();

    alice.send(
      JSON.stringify({ type: "gameCreate", gameType: "complete-the-funny", groupChatId: 555 })
    );
    const errFrame = await nextFrame(alice);
    expect(errFrame.type).toBe("error");
    expect(errFrame.messageText).toContain("already in a game");
  });

  it("rejects unknown game types when creating a game", async () => {
    const alice = await connect(ALICE);

    alice.send(
      JSON.stringify({ type: "gameCreate", gameType: "fortnite", groupChatId: 555 })
    );
    const errFrame = await nextFrame(alice);
    expect(errFrame.type).toBe("error");
    expect(errFrame.messageText).toContain("unknown game type");
  });

  it("never leaks real user ids in anonymous rooms (anon names instead)", async () => {
    // Anonymous room 666; both players are members.
    await db.run("INSERT INTO group_chats (id, name, is_anonymous) VALUES (666, 'Anon Room', 1)");
    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (1, 666)");
    const alice = await connect(ALICE);
    alice.send(
      JSON.stringify({ type: "gameCreate", gameType: "impostor", groupChatId: 666 })
    );
    const created = await nextFrame(alice);
    const gameId = created.gameId;

    // Lobby gameState: participant/host are Guest_ names, never "1".
    expect(created.type).toBe("gameState");
    expect(created.participantIds).toHaveLength(1);
    expect(created.participantIds[0]).toMatch(/^Guest_/);
    expect(created.hostId).toMatch(/^Guest_/);
    expect(JSON.stringify(created)).not.toContain('"1"');

    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (2, 666)");
    const bob = await connect(BOB);
    const joinWaiters: { [k: string]: Promise<Record<string, any>>[] } = {
      "1": [nextFrame(alice)],
      "2": [nextFrame(bob)],
    };
    bob.send(JSON.stringify({ type: "gameJoin", gameId }));
    for (const waiters of Object.values(joinWaiters)) {
      for (const frame of waiters) {
        expect((await frame).type).toBe("gameState");
      }
    }

    // Start: the private role frame tells each player their own anon name so
    // they can find themselves among the anonymized participant lists.
    const roleAlice = nextFrame(alice);
    const roleBob = nextFrame(bob);
    const playAlice = nextFrame(alice);
    const playBob = nextFrame(bob);
    alice.send(JSON.stringify({ type: "gameStart", gameId }));
    const aliceRole = await roleAlice;
    const bobRole = await roleBob;
    const alicePlay = await playAlice;
    await playBob;
    expect(aliceRole.type).toBe("gameRole");
    expect(aliceRole.anonName).toMatch(/^Guest_/);
    expect(bobRole.anonName).toMatch(/^Guest_/);

    // The play view's turn player is an anon name and no real id appears.
    expect(alicePlay.type).toBe("gamePlay");
    expect(alicePlay.turnPlayerId).toMatch(/^Guest_/);
    const anonView = JSON.stringify({ ...alicePlay, anonNames: [aliceRole.anonName, bobRole.anonName] });
    expect(anonView).not.toMatch(/"(1|2)"/);
  });

  it("deals private roles on start without leaking the word to the room", async () => {
    const { alice, bob, gameId } = await lobbyWithAliceAndBob();
    const { roleAlice, roleBob } = await startGameFor(alice, bob, gameId);

    // Each player receives exactly one of secretWord / hint, privately.
    for (const role of [roleAlice, roleBob]) {
      expect(role.type).toBe("gameRole");
      expect(role.gameId).toBe(gameId);
      expect(["crewmate", "impostor"]).toContain(role.role);
      const hasWord = role.secretWord !== undefined;
      const hasHint = role.hint !== undefined;
      expect(hasWord).not.toBe(hasHint);
    }
  });

  it("advances turns on hints and rejects off-turn submissions", async () => {
    const { alice, bob, gameId } = await lobbyWithAliceAndBob();
    const { playAlice } = await startGameFor(alice, bob, gameId);

    // Alice is the host, so her socket is player "1"; bob is "2".
    const sockets: Record<string, WebSocket> = { "1": alice, "2": bob };
    const play = playAlice;
    expect(play.type).toBe("gamePlay");
    const turn = play.turnPlayerId;

    // Off-turn hint is rejected.
    const offTurn = turn === "1" ? bob : alice;
    offTurn.send(
      JSON.stringify({ type: "gameHint", gameId, hint: "jumping the queue" })
    );
    const errFrame = await nextFrame(offTurn);
    expect(errFrame.type).toBe("error");
    expect(errFrame.messageText).toContain("not their turn");

    // On-turn hint advances the turn.
    const onTurn = sockets[turn];
    onTurn.send(
      JSON.stringify({ type: "gameHint", gameId, hint: "a valid hint" })
    );
    const nextPlay = await nextFrame(alice);
    expect(nextPlay.type).toBe("gamePlay");
    expect(nextPlay.hints[turn]).toBe("a valid hint");
    expect(nextPlay.turnPlayerId).not.toBe(turn);
  });

  it("runs a full impostor game to resolution and auto-ends it", async () => {
    // Three players so the final vote can produce a majority.
    const alice = await connect(ALICE);
    alice.send(
      JSON.stringify({ type: "gameCreate", gameType: "impostor", groupChatId: 555 })
    );
    const created = await nextFrame(alice);
    const gameId = created.gameId;
    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (2, 555)");
    const bob = await connect(BOB);
    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (3, 555)");
    const carol = await connect(CAROL);
    const sockets: Record<string, WebSocket> = { "1": alice, "2": bob, "3": carol };
    // Bob and carol join the lobby. Every member receives a gameState per
    // join (both bob and carol are already room members), so each player's
    // socket sees a deterministic frame *count* of 2 even though delivery
    // order across the two async broadcasts is not.
    const joinWaiters: Record<string, Promise<Record<string, any>>[]> = {
      "1": [nextFrame(alice), nextFrame(alice)],
      "2": [nextFrame(bob), nextFrame(bob)],
      "3": [nextFrame(carol), nextFrame(carol)],
    };
    bob.send(JSON.stringify({ type: "gameJoin", gameId }));
    carol.send(JSON.stringify({ type: "gameJoin", gameId }));
    for (const waiters of Object.values(joinWaiters)) {
      for (const frame of waiters) {
        expect((await frame).type).toBe("gameState");
      }
    }

    // Start the game: private role frames, then the gamePlay broadcast.
    const roleAlice = nextFrame(alice);
    const roleBob = nextFrame(bob);
    const roleCarol = nextFrame(carol);
    const playAlice = nextFrame(alice);
    const playBob = nextFrame(bob);
    const playCarol = nextFrame(carol);
    alice.send(JSON.stringify({ type: "gameStart", gameId }));
    const roles = {
      "1": await roleAlice,
      "2": await roleBob,
      "3": await roleCarol,
    };
    const firstPlay = await playAlice;
    await playBob;
    await playCarol;
    expect(Object.values(roles).filter((r) => r.role === "impostor")).toHaveLength(1);

    // All three submit hints in turn order.
    let play = firstPlay;
    for (let i = 0; i < 3; i++) {
      const turn = play.turnPlayerId;
      sockets[turn].send(
        JSON.stringify({ type: "gameHint", gameId, hint: `hint from ${turn}` })
      );
      play = await nextFrame(alice);
    }
    expect(play.phase).toBe("choose");

    // Everyone chooses to vote.
    for (const ws of [alice, bob, carol]) {
      ws.send(JSON.stringify({ type: "gameChoose", gameId, choice: "vote" }));
      play = await nextFrame(alice);
    }
    expect(play.phase).toBe("vote");

    // Alice and carol vote for bob ("2"); bob votes alice. Bob is voted out.
    alice.send(JSON.stringify({ type: "gameVote", gameId, votedForId: "2" }));
    bob.send(JSON.stringify({ type: "gameVote", gameId, votedForId: "1" }));
    carol.send(JSON.stringify({ type: "gameVote", gameId, votedForId: "2" }));

    // If bob is the impostor, he gets a guess chance; otherwise the game ends
    // immediately. Either way a gameEnded frame with an outcome arrives.
    if (roles["2"].role === "impostor") {
      const guessPlay = await nextFrame(alice);
      expect(guessPlay.type).toBe("gamePlay");
      expect(guessPlay.phase).toBe("guess");
      bob.send(
        JSON.stringify({ type: "gameGuess", gameId, guess: "definitely not it" })
      );
    }
    const ended = await nextFrame(alice);
    expect(ended.type).toBe("gameEnded");
    expect(["crewmates-win", "crewmates-lose"]).toContain(ended.outcome);

    // The game is gone: play actions now fail.
    alice.send(JSON.stringify({ type: "gameHint", gameId, hint: "too late" }));
    const errFrame = await nextFrame(alice);
    expect(errFrame.type).toBe("error");
    expect(errFrame.messageText).toContain("not found or has ended");
  });

  it("auto-resolves when the voted-out impostor never guesses", async () => {
    // Three players, short guess deadline so the timeout fires quickly.
    const alice = await connect(ALICE);
    alice.send(
      JSON.stringify({ type: "gameCreate", gameType: "impostor", groupChatId: 555 })
    );
    const created = await nextFrame(alice);
    const gameId = created.gameId;
    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (2, 555)");
    const bob = await connect(BOB);
    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (3, 555)");
    const carol = await connect(CAROL);
    const sockets: Record<string, WebSocket> = { "1": alice, "2": bob, "3": carol };
    const joinWaiters: Record<string, Promise<Record<string, any>>[]> = {
      "1": [nextFrame(alice), nextFrame(alice)],
      "2": [nextFrame(bob), nextFrame(bob)],
      "3": [nextFrame(carol), nextFrame(carol)],
    };
    bob.send(JSON.stringify({ type: "gameJoin", gameId }));
    carol.send(JSON.stringify({ type: "gameJoin", gameId }));
    for (const waiters of Object.values(joinWaiters)) {
      for (const frame of waiters) {
        expect((await frame).type).toBe("gameState");
      }
    }

    const roleAlice = nextFrame(alice);
    const roleBob = nextFrame(bob);
    const roleCarol = nextFrame(carol);
    const playAlice = nextFrame(alice);
    const playBob = nextFrame(bob);
    const playCarol = nextFrame(carol);
    alice.send(
      JSON.stringify({ type: "gameStart", gameId, settings: { guessTimeMs: 150 } })
    );
    const roles: Record<string, Record<string, any>> = {
      "1": await roleAlice,
      "2": await roleBob,
      "3": await roleCarol,
    };
    const impostor = Object.keys(roles).find((id) => roles[id].role === "impostor")!;
    let play = await playAlice;
    await playBob;
    await playCarol;

    // All three hint in turn order, then everyone votes.
    for (let i = 0; i < 3; i++) {
      const turn = play.turnPlayerId;
      sockets[turn].send(JSON.stringify({ type: "gameHint", gameId, hint: `h ${turn}` }));
      play = await nextFrame(alice);
    }
    for (const ws of [alice, bob, carol]) {
      ws.send(JSON.stringify({ type: "gameChoose", gameId, choice: "vote" }));
      play = await nextFrame(alice);
    }
    expect(play.phase).toBe("vote");

    // Everyone votes for the impostor, so they're voted out → guess phase.
    const guessPlay = nextFrame(alice);
    alice.send(JSON.stringify({ type: "gameVote", gameId, votedForId: impostor }));
    bob.send(JSON.stringify({ type: "gameVote", gameId, votedForId: impostor }));
    carol.send(JSON.stringify({ type: "gameVote", gameId, votedForId: impostor }));
    const guessFrame = await guessPlay;
    expect(guessFrame.type).toBe("gamePlay");
    expect(guessFrame.phase).toBe("guess");

    // Nobody guesses; the 150ms deadline passes and the game ends crewmates-win.
    const ended = await nextFrame(alice, 3000);
    expect(ended.type).toBe("gameEnded");
    expect(ended.outcome).toBe("crewmates-win");
  });

  it("ends on a tie screen when the final vote is a three-way tie", async () => {
    // Three players, everyone votes for someone else → 1-1-1 tie.
    const alice = await connect(ALICE);
    alice.send(
      JSON.stringify({ type: "gameCreate", gameType: "impostor", groupChatId: 555 })
    );
    const created = await nextFrame(alice);
    const gameId = created.gameId;
    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (2, 555)");
    const bob = await connect(BOB);
    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (3, 555)");
    const carol = await connect(CAROL);
    const sockets: Record<string, WebSocket> = { "1": alice, "2": bob, "3": carol };
    const joinWaiters: Record<string, Promise<Record<string, any>>[]> = {
      "1": [nextFrame(alice), nextFrame(alice)],
      "2": [nextFrame(bob), nextFrame(bob)],
      "3": [nextFrame(carol), nextFrame(carol)],
    };
    bob.send(JSON.stringify({ type: "gameJoin", gameId }));
    carol.send(JSON.stringify({ type: "gameJoin", gameId }));
    for (const waiters of Object.values(joinWaiters)) {
      for (const frame of waiters) {
        expect((await frame).type).toBe("gameState");
      }
    }

    const roleAlice = nextFrame(alice);
    const roleBob = nextFrame(bob);
    const roleCarol = nextFrame(carol);
    const playAlice = nextFrame(alice);
    const playBob = nextFrame(bob);
    const playCarol = nextFrame(carol);
    alice.send(JSON.stringify({ type: "gameStart", gameId }));
    await roleAlice;
    await roleBob;
    await roleCarol;
    let play = await playAlice;
    await playBob;
    await playCarol;

    for (let i = 0; i < 3; i++) {
      const turn = play.turnPlayerId;
      sockets[turn].send(JSON.stringify({ type: "gameHint", gameId, hint: `h ${turn}` }));
      play = await nextFrame(alice);
    }
    for (const ws of [alice, bob, carol]) {
      ws.send(JSON.stringify({ type: "gameChoose", gameId, choice: "vote" }));
      play = await nextFrame(alice);
    }
    expect(play.phase).toBe("vote");

    // Rotate votes so the top is a 1-1-1 tie.
    alice.send(JSON.stringify({ type: "gameVote", gameId, votedForId: "2" }));
    bob.send(JSON.stringify({ type: "gameVote", gameId, votedForId: "3" }));
    carol.send(JSON.stringify({ type: "gameVote", gameId, votedForId: "1" }));

    const ended = await nextFrame(alice);
    expect(ended.type).toBe("gameEnded");
    expect(ended.outcome).toBe("tie");
  });

  it("blocks soft-leavers from playing until they rejoin", async () => {
    const { alice, bob, gameId } = await lobbyWithAliceAndBob();
    await startGameFor(alice, bob, gameId);

    const atBob = nextFrame(bob);
    const atAlice = nextFrame(alice);
    bob.send(JSON.stringify({ type: "gameSoftLeave", gameId }));
    await atBob;
    await atAlice;

    bob.send(JSON.stringify({ type: "gameHint", gameId, hint: "sneaky" }));
    const errFrame = await nextFrame(bob);
    expect(errFrame.type).toBe("error");
    expect(errFrame.messageText).toContain("rejoin");
  });

  it("advances the turn when the hint timer expires", async () => {
    const { alice, bob, gameId } = await lobbyWithAliceAndBob();
    const { playAlice } = await startGameFor(alice, bob, gameId, { hintTimeMs: 150 });
    const firstTurn = playAlice.turnPlayerId;

    // Nobody submits; the 150ms hint deadline passes and the server skips.
    const timedOut = await nextFrame(alice, 3000);
    expect(timedOut.type).toBe("gamePlay");
    expect(timedOut.phase).toBe("hint");
    expect(timedOut.turnPlayerId).not.toBe(firstTurn);
  });

  it("runs Complete the Funny answering and voting over the wire", async () => {
    const alice = await connect(ALICE);
    alice.send(
      JSON.stringify({
        type: "gameCreate",
        gameType: "complete-the-funny",
        groupChatId: 555,
      })
    );
    const created = await nextFrame(alice);
    const gameId = created.gameId;
    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (2, 555)");
    const bob = await connect(BOB);
    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (3, 555)");
    const carol = await connect(CAROL);
    const sockets: Record<string, WebSocket> = { "1": alice, "2": bob, "3": carol };
    // Same frame-count discipline as the impostor game: every room member
    // sees both join broadcasts, so each socket gets exactly 2 gameState
    // frames regardless of async delivery order.
    const joinWaiters: Record<string, Promise<Record<string, any>>[]> = {
      "1": [nextFrame(alice), nextFrame(alice)],
      "2": [nextFrame(bob), nextFrame(bob)],
      "3": [nextFrame(carol), nextFrame(carol)],
    };
    bob.send(JSON.stringify({ type: "gameJoin", gameId }));
    carol.send(JSON.stringify({ type: "gameJoin", gameId }));
    for (const waiters of Object.values(joinWaiters)) {
      for (const frame of waiters) {
        expect((await frame).type).toBe("gameState");
      }
    }

    alice.send(
      JSON.stringify({
        type: "gameStart",
        gameId,
        settings: { promptsPerPlayer: 2, rounds: 1 },
      })
    );
    const play = await nextFrame(alice);
    expect(play.type).toBe("gamePlay");
    expect(play.game).toBe("complete-the-funny");
    expect(play.phase).toBe("answering");
    expect(play.prompts["1"]).toHaveLength(2);
    expect(play.prompts["2"]).toEqual(play.prompts["1"]);

    // Everyone answers their two prompts; the last answer flips to voting.
    for (const ws of [alice, bob, carol]) {
      ws.send(
        JSON.stringify({ type: "gameAnswer", gameId, answers: ["funny a", "funny b"] })
      );
    }
    // Each answer broadcasts a gamePlay; the last one flips to voting. The
    // async broadcasts can interleave, but there are exactly three, so read
    // all three and pick out the voting one regardless of order.
    const afterAnswers: Record<string, any>[] = [];
    for (let i = 0; i < 3; i++) {
      afterAnswers.push(await nextFrame(alice));
    }
    expect(afterAnswers.every((f) => f.type === "gamePlay")).toBe(true);
    const voting = afterAnswers.find((f) => f.phase === "voting");
    expect(voting).toBeDefined();
    if (!voting) throw new Error("expected a voting frame");
    expect(voting.phases.map((p: any) => p.answers.length)).toEqual([4, 2]);

    // Vote both phases; the last vote resolves the round → gameEnded.
    const phase0 = voting.phases[0];
    const eligible0 = ["1", "2", "3"].filter(
      (id) => !phase0.answers.some((a: any) => a.playerId === id)
    );
    const target0 = phase0.answers[0].id;
    for (const voter of eligible0) {
      sockets[voter].send(
        JSON.stringify({ type: "gameVote", gameId, phaseIndex: 0, answerId: target0 })
      );
    }
    const phase1 = voting.phases[1];
    const eligible1 = ["1", "2", "3"].filter(
      (id) => !phase1.answers.some((a: any) => a.playerId === id)
    );
    const target1 = phase1.answers[0].id;
    for (const voter of eligible1) {
      sockets[voter].send(
        JSON.stringify({ type: "gameVote", gameId, phaseIndex: 1, answerId: target1 })
      );
    }

    const ended = await nextFrame(alice);
    expect(ended.type).toBe("gameEnded");
  });

  it("ends every game in a room when the room is deleted", async () => {
    const { alice, bob, gameId } = await lobbyWithAliceAndBob();
    await startGameFor(alice, bob, gameId);

    gameCleanup.endGamesInRoom(555);

    // The game data is gone: further actions are rejected.
    alice.send(JSON.stringify({ type: "gameHint", gameId, hint: "still here?" }));
    const errFrame = await nextFrame(alice);
    expect(errFrame.type).toBe("error");
    expect(errFrame.messageText).toContain("not found or has ended");
  });

  it("clears in-play timers when a room's games are ended", async () => {
    const { alice, bob, gameId } = await lobbyWithAliceAndBob();
    await startGameFor(alice, bob, gameId, { hintTimeMs: 150 });

    gameCleanup.endGamesInRoom(555);

    // The 150ms hint timer was cleared: no play frame ever arrives.
    await expect(nextFrame(alice, 600)).rejects.toThrow(
      "timed out waiting for frame"
    );
  });

  it("removes a player from the game when their socket closes (tab close)", async () => {
    const { alice, bob, gameId } = await lobbyWithAliceAndBob();
    await startGameFor(alice, bob, gameId);

    const atAlice = nextFrame(alice);
    bob.close();
    const state = await atAlice;
    expect(state.type).toBe("gameState");
    expect(state.participantIds).toEqual(["1"]);
    expect(state.inactivePlayerIds).toEqual([]);
  });

  it("frees the one-game slot when a player's socket closes", async () => {
    const { alice, bob, gameId } = await lobbyWithAliceAndBob();
    await startGameFor(alice, bob, gameId);

    const atAlice = nextFrame(alice);
    bob.close();
    await atAlice;

    // Bob's user can create a new game right away (slot freed).
    await db.run("INSERT INTO group_chats (id, name) VALUES (666, 'Other Room')");
    await db.run("INSERT INTO room_members (user_id, room_id) VALUES (2, 666)");
    const bob2 = await connect(BOB);
    bob2.send(
      JSON.stringify({ type: "gameCreate", gameType: "impostor", groupChatId: 666 })
    );
    const created = await nextFrame(bob2);
    expect(created.type).toBe("gameState");
    expect(created.gameId).not.toBe(gameId);
  });

  it("removes a player from a lobby game when their socket closes", async () => {
    const { alice, bob, gameId } = await lobbyWithAliceAndBob();

    const atAlice = nextFrame(alice);
    bob.close();
    const state = await atAlice;
    expect(state.type).toBe("gameState");
    expect(state.participantIds).toEqual(["1"]);
  });
});

describe("websocket robustness", () => {
  it("replies with an error frame instead of crashing on malformed JSON", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on("unhandledRejection", onUnhandled);

    try {
      const alice = await connect(ALICE);

      alice.send("this is not json");
      const errFrame = await nextFrame(alice);
      expect(errFrame.type).toBe("error");

      // The same socket must still work afterwards.
      alice.send(JSON.stringify({ type: "ping" }));
      const pong = await nextFrame(alice);
      expect(pong.type).toBe("pong");

      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("closes sockets that send frames over the payload cap with 1009", async () => {
    // ws surfaces the oversize condition by emitting 'error' on the socket;
    // without a listener that becomes a process-killing uncaught exception.
    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => uncaught.push(err);
    process.on("uncaughtException", onUncaught);

    try {
      const alice = await connect(ALICE);
      alice.send(Buffer.alloc(MAX_WS_FRAME_BYTES + 1)); // one byte over the cap
      const code = await expectClose(alice);
      expect(code).toBe(1009);

      // Give any async fallout a beat, then require none of it escaped.
      await new Promise((r) => setTimeout(r, 50));
      expect(uncaught).toHaveLength(0);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
  });
});
