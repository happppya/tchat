import { describe, expect, it } from "vitest";

import { createGracefulShutdown } from "./shutdown";

/**
 * The shutdown sequence must stop the janitor timer, close the HTTP + WS
 * listeners (forcing through stubborn clients), close the database last, and
 * exit cleanly — exactly once even when both signals fire.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("graceful shutdown", () => {
  it("closes transports before the database, then exits 0", async () => {
    const order: string[] = [];
    let ticks = 0;
    const cleanupTimer = setInterval(() => ticks++, 1);

    const shutdown = createGracefulShutdown({
      server: {
        close: (cb) => {
          order.push("server");
          cb?.();
        },
      },
      wss: {
        clients: new Set(),
        close: (cb) => {
          order.push("wss");
          cb?.();
        },
      },
      db: {
        close: async () => {
          order.push("db");
        },
      },
      cleanupTimer,
      exit: () => order.push("exit"),
    });

    await shutdown("SIGINT");

    expect(order.indexOf("server")).toBeGreaterThanOrEqual(0);
    // Both transports must be closed before the DB is torn down.
    expect(order.indexOf("db")).toBeGreaterThan(order.indexOf("server"));
    expect(order.indexOf("db")).toBeGreaterThan(order.indexOf("wss"));
    expect(order[order.length - 1]).toBe("exit");

    // The janitor interval stopped ticking.
    const ticksAtShutdown = ticks;
    await sleep(30);
    expect(ticks).toBe(ticksAtShutdown);
  });

  it("terminates connected websocket clients", async () => {
    const terminated: string[] = [];
    const shutdown = createGracefulShutdown({
      server: { close: (cb) => cb?.() },
      wss: {
        clients: new Set([{ terminate: () => terminated.push("client") }]),
        close: (cb) => cb?.(),
      },
      exit: () => {},
    });

    await shutdown();
    expect(terminated).toEqual(["client"]);
  });

  it("is idempotent when SIGINT and SIGTERM arrive together", async () => {
    let dbCloses = 0;
    let exits = 0;
    const shutdown = createGracefulShutdown({
      server: { close: (cb) => cb?.() },
      db: {
        close: async () => {
          dbCloses++;
        },
      },
      exit: () => {
        exits++;
      },
    });

    await Promise.all([shutdown(), shutdown(), shutdown()]);
    expect(dbCloses).toBe(1);
    expect(exits).toBe(1);
  });

  it("forces shutdown when a transport refuses to close", async () => {
    const order: string[] = [];
    const exitCodes: number[] = [];
    const shutdown = createGracefulShutdown({
      // This server's close callback never fires.
      server: { close: () => {} },
      db: {
        close: async () => {
          order.push("db");
        },
      },
      timeoutMs: 25,
      exit: (code) => {
        order.push("exit");
        exitCodes.push(code);
      },
    });

    await shutdown();
    expect(order).toEqual(["db", "exit"]);
    expect(exitCodes).toEqual([0]);
  });
});
