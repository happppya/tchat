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
  app.use("/api", createRouter({ db, broadcast: () => {} }));

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
      "INSERT INTO group_chats (id, name, is_public) VALUES (424242, 'Secret', 0)"
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
