import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import http from "http";
import type { AddressInfo } from "net";

import { openDatabase, type DB } from "./db";

/**
 * Rate limiting is configured from env at module load (mirroring constants.ts),
 * so each test sets its limits, resets the module cache, and rebuilds a fresh
 * app — otherwise counters and config would leak between tests.
 */

let db: DB;

beforeEach(async () => {
  // Limits are read from env at import time; start every test from a clean
  // module registry so config from other files/tests can't leak in.
  vi.resetModules();
  if (!db) db = await openDatabase(":memory:");
});

afterAll(async () => {
  await db.close();
});

afterEach(() => {
  delete process.env.RATE_LIMIT_AUTH_MAX;
  delete process.env.RATE_LIMIT_UPLOAD_MAX;
  delete process.env.RATE_LIMIT_GIF_MAX;
  delete process.env.RATE_LIMIT_WINDOW_MS;
  vi.resetModules();
});

async function buildApp(): Promise<{
  server: http.Server;
  url: string;
}> {
  // Dynamic imports so every module re-reads env after resetModules().
  const authModule = await import("./auth.js");
  const routesModule = await import("../routes.js");
  authModule.initSessionStore(db);

  const app: Express = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/api", routesModule.createRouter({ db, broadcast: () => {}, sendToUser: () => {} }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}/api` };
}

async function login(url: string): Promise<Response> {
  return fetch(`${url}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "nobody", password: "wrong" }),
  });
}

describe("rate limiting", () => {
  it("returns 429 on /login once the burst allowance is spent", async () => {
    process.env.RATE_LIMIT_AUTH_MAX = "3";
    process.env.RATE_LIMIT_WINDOW_MS = "60000";
    const { server, url } = await buildApp();

    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) {
        statuses.push((await login(url)).status);
      }
      expect(statuses).toEqual([401, 401, 401, 429, 429]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("counts signup attempts against the same bucket as login", async () => {
    process.env.RATE_LIMIT_AUTH_MAX = "2";
    process.env.RATE_LIMIT_WINDOW_MS = "60000";
    const { server, url } = await buildApp();

    try {
      expect((await login(url)).status).toBe(401);
      const signup = await fetch(`${url}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "someone", password: "longenough1" }),
      });
      expect(signup.status).toBe(201);
      // Bucket is exhausted → the next login attempt is blocked.
      expect((await login(url)).status).toBe(429);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("gives uploads their own bucket", async () => {
    process.env.RATE_LIMIT_UPLOAD_MAX = "2";
    process.env.RATE_LIMIT_AUTH_MAX = "50"; // auth must stay open
    process.env.RATE_LIMIT_WINDOW_MS = "60000";

    const authModule = await import("./auth.js");
    const routesModule = await import("../routes.js");
    const { initSessionStore, createSession } = authModule;
    initSessionStore(db);
    await db.run(
      "INSERT INTO users (username, password_hash) VALUES ('uploader', 'x')"
    );
    const user = (await db.get(
      "SELECT id, username FROM users WHERE username = 'uploader'"
    )) as { id: number; username: string };
    const token = await createSession(user);

    // Build a fresh app directly (env already set).
    const app: Express = express();
    app.use(express.json({ limit: "5mb" }));
    app.use("/api", routesModule.createRouter({ db, broadcast: () => {}, sendToUser: () => {} }));
    const httpServer = http.createServer(app);
    await new Promise<void>((resolve) =>
      httpServer.listen(0, "127.0.0.1", resolve)
    );
    const { port } = httpServer.address() as AddressInfo;

    try {
      const upload = () =>
        fetch(`http://127.0.0.1:${port}/api/upload`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `sid=${token}`,
          },
          body: JSON.stringify({
            fileName: "a.png",
            dataUrl:
              "data:image/png;base64," +
              Buffer.from("png").toString("base64"),
          }),
        });

      expect((await upload()).status).toBe(201);
      expect((await upload()).status).toBe(201);
      expect((await upload()).status).toBe(429);
      // The auth bucket was untouched.
      expect((await login(`http://127.0.0.1:${port}/api`)).status).toBe(401);
    } finally {
      await new Promise<void>((resolve) =>
        httpServer.close(() => resolve())
      );
    }
  });
});
