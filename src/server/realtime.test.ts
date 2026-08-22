import { afterAll, beforeEach, describe, expect, it } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import { WebSocket, WebSocketServer } from "ws";

import { openDatabase, type DB } from "./db";
import { createRealtime, attachMessageHandler } from "./realtime";
import { MAX_WS_FRAME_BYTES } from "./constants";
import type { Session } from "./auth";

/**
 * Integration-style tests for the WebSocket layer. A real ws server is booted
 * per test (mirroring server.ts's upgrade flow) against an in-memory SQLite
 * database; sessions are injected exactly like the HTTP upgrade handler does.
 */

const ALICE: Session = { userId: 1, username: "alice", isAdmin: false, expires: Date.now() + 60_000 };
const BOB: Session = { userId: 2, username: "bob", isAdmin: false, expires: Date.now() + 60_000 };

let db: DB;
let wss: WebSocketServer;
let httpServer: http.Server;
let baseUrl: string;
const pendingSessions: Array<Session | null> = [];

beforeEach(async () => {
  if (!db) db = await openDatabase(":memory:");
  // Fresh state per test.
  await db.exec(
    "DELETE FROM messages; DELETE FROM group_chats; DELETE FROM room_members;"
  );

  const realtime = createRealtime({ db });
  wss = realtime.wss;
  attachMessageHandler({ wss, db, broadcast: realtime.broadcast });

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
function nextFrame(ws: WebSocket, ms = 2000): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for frame")), ms);
    ws.once("message", (data) => {
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
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
