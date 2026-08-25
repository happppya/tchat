import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import http from "http";
import fs from "fs";
import type { AddressInfo } from "net";

import { openDatabase, type DB } from "./db";
import { createRouter } from "./routes";
import { initSessionStore, createSession } from "./auth";
import { PROJECT_ROOT } from "./constants";

/**
 * Route-level integration tests: a real Express app over an in-memory SQLite
 * database, driven with fetch. Sessions are seeded directly into the session
 * store so tests don't pay the scrypt cost.
 */

let db: DB;
let app: Express;
let httpServer: http.Server;
let base: string;
const cookies: Record<string, string> = {};

async function request(
  method: string,
  path: string,
  body?: unknown,
  as?: string
): Promise<Response> {
  const headers: Record<string, string> = {};
  const who = as ?? "alice";
  if (cookies[who]) headers.Cookie = `sid=${cookies[who]}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function dataUrl(mime: string, content: string): string {
  return `data:${mime};base64,${Buffer.from(content).toString("base64")}`;
}

beforeAll(async () => {
  // Production creates this in server.ts; the router writes into it.
  fs.mkdirSync(PROJECT_ROOT + "/uploads", { recursive: true });

  db = await openDatabase(":memory:");
  initSessionStore(db);

  await db.run(
    "INSERT INTO users (username, password_hash) VALUES ('alice', 'x'), ('bob', 'y')"
  );
  const alice = (await db.get(
    "SELECT id, username FROM users WHERE username = 'alice'"
  )) as { id: number; username: string };
  const bob = (await db.get(
    "SELECT id, username FROM users WHERE username = 'bob'"
  )) as { id: number; username: string };
  cookies.alice = await createSession(alice);
  cookies.bob = await createSession(bob);

  app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/api", createRouter({ db, broadcast: () => {}, sendToUser: () => {} }));

  httpServer = http.createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await db.close();
});

describe("room membership enforcement", () => {
  // Room 424242 exists; alice is a member, bob is not.
  beforeAll(async () => {
    await db.run(
      "INSERT INTO group_chats (id, name) VALUES (424242, 'Secret')"
    );
    await db.run(
      "INSERT INTO room_members (user_id, room_id) VALUES ((SELECT id FROM users WHERE username = 'alice'), 424242)"
    );
    await db.run(
      `INSERT INTO messages (id, group_chat_id, display_name, message_text, sent_at, user_id)
       VALUES (9001, 424242, 'alice', 'hello secret room', ?, (SELECT id FROM users WHERE username = 'alice'))`,
      [new Date().toISOString().replace("T", " ").substring(0, 19)]
    );
  });

  it("serves room info to members", async () => {
    const res = await request("GET", "/getGCInfo?groupChatId=424242");
    expect(res.status).toBe(200);
  });

  it("hides room info from non-members", async () => {
    const res = await request("GET", "/getGCInfo?groupChatId=424242", undefined, "bob");
    expect(res.status).toBe(403);
  });

  it("serves message history to members", async () => {
    const res = await request("GET", "/getMessages?groupChatId=424242");
    expect(res.status).toBe(200);
    const msgs = (await res.json()) as Array<{ id: number }>;
    expect(msgs.some((m) => m.id === 9001)).toBe(true);
  });

  it("refuses message history to non-members", async () => {
    const res = await request(
      "GET",
      "/getMessages?groupChatId=424242",
      undefined,
      "bob"
    );
    expect(res.status).toBe(403);
  });

  it("lets members react to messages in their rooms", async () => {
    const res = await request("POST", "/reactToMessage", {
      messageId: 9001,
      emoji: "👍",
    });
    expect(res.status).toBe(200);
  });

  it("refuses reactions from non-members", async () => {
    const res = await request(
      "POST",
      "/reactToMessage",
      { messageId: 9001, emoji: "😈" },
      "bob"
    );
    expect(res.status).toBe(403);
    // And the reaction must not have been recorded.
    const row = await db.get(
      "SELECT 1 AS present FROM message_reactions WHERE message_id = 9001 AND emoji = '😈'"
    );
    expect(row).toBeUndefined();
  });

  it("rejects arbitrary text as a reaction", async () => {
    const res = await request("POST", "/reactToMessage", {
      messageId: 9001,
      emoji: "<script>alert(1)</script>",
    });
    expect(res.status).toBe(400);
    const row = await db.get(
      "SELECT 1 AS present FROM message_reactions WHERE message_id = 9001 AND emoji = '<script>alert(1)</script>'"
    );
    expect(row).toBeUndefined();
  });

  it("rejects plain words and control characters as reactions", async () => {
    for (const emoji of ["hello", "👍\n👍", "  ", "a"]) {
      const res = await request("POST", "/reactToMessage", {
        messageId: 9001,
        emoji,
      });
      expect(res.status).toBe(400);
    }
  });

  it("rejects non-string emoji payloads", async () => {
    const res = await request("POST", "/reactToMessage", {
      messageId: 9001,
      emoji: { type: "not-an-emoji" },
    });
    expect(res.status).toBe(400);
  });

  it("accepts genuine emoji, including skin tones and variation selectors", async () => {
    for (const emoji of ["🎉", "👍🏽", "❤️", "👨‍👩‍👧"]) {
      const res = await request("POST", "/reactToMessage", {
        messageId: 9001,
        emoji,
      });
      expect(res.status).toBe(200);
    }
  });
});

describe("upload MIME allowlist", () => {
  it("accepts an allowlisted image upload", async () => {
    const res = await request("POST", "/upload", {
      fileName: "pic.png",
      dataUrl: dataUrl("image/png", "fake png bytes"),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { url: string };
    expect(body.url).toMatch(/^\/uploads\/[a-f0-9]+\.png$/);
  });

  it("rejects image/svg+xml uploads with 415", async () => {
    const res = await request("POST", "/upload", {
      fileName: "evil.svg",
      dataUrl: dataUrl(
        "image/svg+xml",
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
      ),
    });
    // SVG is executable script when served same-origin — it must never land
    // in the uploads directory.
    expect(res.status).toBe(415);
  });

  it("rejects text/html uploads with 415", async () => {
    const res = await request("POST", "/upload", {
      fileName: "page.html",
      dataUrl: dataUrl("text/html", "<script>alert(1)</script>"),
    });
    expect(res.status).toBe(415);
  });

  it("rejects unknown binary types with 415", async () => {
    const res = await request("POST", "/upload", {
      fileName: "thing.bin",
      dataUrl: dataUrl("application/octet-stream", "\x00\x01\x02"),
    });
    expect(res.status).toBe(415);
  });
});

describe("operator admin promotion (secret-gated)", () => {
  const SECRET = "test-secret-xyz-123";

  it("rejects when no secret is configured", async () => {
    delete process.env.ADMIN_SECRET;
    const res = await fetch(`${base}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "bob" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects a wrong secret", async () => {
    process.env.ADMIN_SECRET = SECRET;
    const res = await fetch(`${base}/promote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-secret": "wrong-secret",
      },
      body: JSON.stringify({ username: "bob" }),
    });
    expect(res.status).toBe(403);
  });

  it("promotes a user with the correct secret", async () => {
    process.env.ADMIN_SECRET = SECRET;
    const res = await fetch(`${base}/promote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-secret": SECRET,
      },
      body: JSON.stringify({ username: "bob" }),
    });
    expect(res.status).toBe(200);
    const row = await db.get(
      "SELECT is_admin FROM users WHERE username = 'bob'"
    );
    expect(row?.is_admin).toBe(1);
  });

  it("demotes when isAdmin is false", async () => {
    process.env.ADMIN_SECRET = SECRET;
    const res = await fetch(`${base}/promote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-secret": SECRET,
      },
      body: JSON.stringify({ username: "bob", isAdmin: false }),
    });
    expect(res.status).toBe(200);
    const row = await db.get(
      "SELECT is_admin FROM users WHERE username = 'bob'"
    );
    expect(row?.is_admin).toBe(0);
  });

  it("404s for unknown users", async () => {
    process.env.ADMIN_SECRET = SECRET;
    const res = await fetch(`${base}/promote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-secret": SECRET,
      },
      body: JSON.stringify({ username: "nobody_here" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("upload abuse limits", () => {
  it("rejects files over the 2 MB cap with 413", async () => {
    const big = "x".repeat(2 * 1024 * 1024 + 1);
    const res = await request("POST", "/upload", {
      fileName: "big.png",
      dataUrl: dataUrl("image/png", big),
    });
    expect(res.status).toBe(413);
  });

  it("rejects empty payloads with 400", async () => {
    const res = await request("POST", "/upload", {
      fileName: "empty.png",
      dataUrl: "data:image/png;base64,",
    });
    expect(res.status).toBe(400);
  });

  it("rejects non-base64 payloads with 400", async () => {
    const res = await request("POST", "/upload", {
      fileName: "junk.png",
      dataUrl: "data:image/png,not-base64!!",
    });
    expect(res.status).toBe(400);
  });

  it("rejects bodies that are not data URLs at all", async () => {
    const res = await request("POST", "/upload", {
      fileName: "nope.png",
      dataUrl: "https://example.com/file.png",
    });
    expect(res.status).toBe(400);
  });
});

describe("moderation commands — mute", () => {
  const roomId = 777777;

  const bobMuted = async () =>
    db.get(
      "SELECT 1 AS present FROM room_mutes WHERE room_id = ? AND user_id = (SELECT id FROM users WHERE username = 'bob')",
      [roomId]
    );

  beforeAll(async () => {
    await db.run("INSERT INTO group_chats (id, name) VALUES (?, 'Mod room')", [
      roomId,
    ]);
    await db.run(
      "INSERT INTO room_members (user_id, room_id) SELECT id, ? FROM users WHERE username IN ('alice', 'bob')",
      [roomId]
    );
    // alice is a site admin for these tests.
    await db.run("UPDATE users SET is_admin = 1 WHERE username = 'alice'");
  });

  afterAll(async () => {
    await db.run("UPDATE users SET is_admin = 0 WHERE username = 'alice'");
    await db.run("DELETE FROM room_mutes");
    await db.run("DELETE FROM room_members WHERE room_id = ?", [roomId]);
    await db.run("DELETE FROM group_chats WHERE id = ?", [roomId]);
  });

  it("mutes a user in a normal room", async () => {
    const res = await request("POST", "/roomCommand", {
      groupChatId: roomId,
      command: "mute",
      targetUsername: "bob",
    });
    expect(res.status).toBe(200);
    expect(await bobMuted()).toBeTruthy();
  });

  it("mute is idempotent — muting again keeps the user muted", async () => {
    const res = await request("POST", "/roomCommand", {
      groupChatId: roomId,
      command: "mute",
      targetUsername: "bob",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Muted bob");
    expect(await bobMuted()).toBeTruthy();
  });

  it("unmute removes the mute", async () => {
    const res = await request("POST", "/roomCommand", {
      groupChatId: roomId,
      command: "unmute",
      targetUsername: "bob",
    });
    expect(res.status).toBe(200);
    expect(await bobMuted()).toBeUndefined();
  });

  it("site admins can mute in Room 0 (the lobby)", async () => {
    const res = await request("POST", "/roomCommand", {
      groupChatId: 0,
      command: "mute",
      targetUsername: "bob",
    });
    expect(res.status).toBe(200);
    const row = await db.get(
      "SELECT 1 AS present FROM room_mutes WHERE room_id = 0 AND user_id = (SELECT id FROM users WHERE username = 'bob')"
    );
    expect(row).toBeTruthy();
    await db.run("DELETE FROM room_mutes WHERE room_id = 0");
  });

  it("non-admins cannot moderate Room 0", async () => {
    const res = await request(
      "POST",
      "/roomCommand",
      { groupChatId: 0, command: "mute", targetUsername: "alice" },
      "bob"
    );
    expect(res.status).toBe(403);
  });
});

describe("room user status endpoint", () => {
  const roomId = 777778;

  const getStatus = (as = "alice") =>
    request(
      "GET",
      `/roomUserStatus?groupChatId=${roomId}&username=bob`,
      undefined,
      as
    );

  beforeAll(async () => {
    await db.run("INSERT INTO group_chats (id, name) VALUES (?, 'Status room')", [
      roomId,
    ]);
    await db.run(
      "INSERT INTO room_members (user_id, room_id) SELECT id, ? FROM users WHERE username IN ('alice', 'bob')",
      [roomId]
    );
    await db.run("UPDATE users SET is_admin = 1 WHERE username = 'alice'");
  });

  afterAll(async () => {
    await db.run("UPDATE users SET is_admin = 0 WHERE username = 'alice'");
    await db.run("DELETE FROM room_moderators WHERE room_id = ?", [roomId]);
    await db.run("DELETE FROM room_mutes WHERE room_id = ?", [roomId]);
    await db.run("DELETE FROM room_members WHERE room_id = ?", [roomId]);
    await db.run("DELETE FROM group_chats WHERE id = ?", [roomId]);
  });

  it("returns muted=false and isMod=false for a plain member", async () => {
    const res = await getStatus();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      username: "bob",
      muted: false,
      isMod: false,
    });
  });

  it("reflects a mute", async () => {
    await request("POST", "/roomCommand", {
      groupChatId: roomId,
      command: "mute",
      targetUsername: "bob",
    });
    const res = await getStatus();
    const body = (await res.json()) as { muted: boolean };
    expect(body.muted).toBe(true);
    await request("POST", "/roomCommand", {
      groupChatId: roomId,
      command: "unmute",
      targetUsername: "bob",
    });
  });

  it("reflects moderator status", async () => {
    await request("POST", "/roomCommand", {
      groupChatId: roomId,
      command: "mod",
      targetUsername: "bob",
    });
    const res = await getStatus();
    const body = (await res.json()) as { isMod: boolean };
    expect(body.isMod).toBe(true);
    await request("POST", "/roomCommand", {
      groupChatId: roomId,
      command: "demod",
      targetUsername: "bob",
    });
  });

  it("is gated to room staff", async () => {
    const res = await getStatus("bob");
    expect(res.status).toBe(403);
  });

  it("404s for unknown users", async () => {
    const res = await request(
      "GET",
      `/roomUserStatus?groupChatId=${roomId}&username=ghost`
    );
    expect(res.status).toBe(404);
  });
});

describe("room mutes endpoint", () => {
  const roomId = 777779;

  const listMutes = (as = "alice") =>
    request("GET", `/roomMutes?groupChatId=${roomId}`, undefined, as);

  beforeAll(async () => {
    await db.run("INSERT INTO group_chats (id, name) VALUES (?, 'Mutes room')", [
      roomId,
    ]);
    await db.run(
      "INSERT INTO room_members (user_id, room_id) SELECT id, ? FROM users WHERE username IN ('alice', 'bob')",
      [roomId]
    );
    await db.run("UPDATE users SET is_admin = 1 WHERE username = 'alice'");
  });

  afterAll(async () => {
    await db.run("UPDATE users SET is_admin = 0 WHERE username = 'alice'");
    await db.run("DELETE FROM room_mutes WHERE room_id = ?", [roomId]);
    await db.run("DELETE FROM room_members WHERE room_id = ?", [roomId]);
    await db.run("DELETE FROM group_chats WHERE id = ?", [roomId]);
  });

  it("returns an empty list when nobody is muted", async () => {
    const res = await listMutes();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mutes: unknown[] };
    expect(body.mutes).toEqual([]);
  });

  it("lists muted users after a mute, then clears after unmute", async () => {
    await request("POST", "/roomCommand", {
      groupChatId: roomId,
      command: "mute",
      targetUsername: "bob",
    });

    const res = await listMutes();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mutes: Array<{ username: string }>;
    };
    expect(body.mutes).toHaveLength(1);
    expect(body.mutes[0].username).toBe("bob");

    await request("POST", "/roomCommand", {
      groupChatId: roomId,
      command: "unmute",
      targetUsername: "bob",
    });
    const after = (await (await listMutes()).json()) as { mutes: unknown[] };
    expect(after.mutes).toEqual([]);
  });

  it("is gated to room staff", async () => {
    const res = await listMutes("bob");
    expect(res.status).toBe(403);
  });
});

describe("room bans endpoint", () => {
  const roomId = 777780;

  const listBans = (as = "alice") =>
    request("GET", `/roomBans?groupChatId=${roomId}`, undefined, as);

  beforeAll(async () => {
    await db.run("INSERT INTO group_chats (id, name) VALUES (?, 'Bans room')", [
      roomId,
    ]);
    await db.run(
      "INSERT INTO room_members (user_id, room_id) SELECT id, ? FROM users WHERE username IN ('alice', 'bob')",
      [roomId]
    );
    await db.run("UPDATE users SET is_admin = 1 WHERE username = 'alice'");
  });

  afterAll(async () => {
    await db.run("UPDATE users SET is_admin = 0 WHERE username = 'alice'");
    await db.run("DELETE FROM room_bans WHERE room_id = ?", [roomId]);
    await db.run("DELETE FROM room_members WHERE room_id = ?", [roomId]);
    await db.run("DELETE FROM group_chats WHERE id = ?", [roomId]);
  });

  it("returns an empty list when nobody is banned", async () => {
    const res = await listBans();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bans: unknown[] };
    expect(body.bans).toEqual([]);
  });

  it("lists banned users after a ban, then clears after unban", async () => {
    await request("POST", "/roomCommand", {
      groupChatId: roomId,
      command: "ban",
      targetUsername: "bob",
    });

    const res = await listBans();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      bans: Array<{ username: string }>;
    };
    expect(body.bans).toHaveLength(1);
    expect(body.bans[0].username).toBe("bob");

    await request("POST", "/roomCommand", {
      groupChatId: roomId,
      command: "unban",
      targetUsername: "bob",
    });
    const after = (await (await listBans()).json()) as { bans: unknown[] };
    expect(after.bans).toEqual([]);
  });

  it("is gated to room staff", async () => {
    const res = await listBans("bob");
    expect(res.status).toBe(403);
  });
});
