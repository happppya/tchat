import { afterAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import { openDatabase, type DB } from "./db";

/**
 * Connection-level settings live in openDatabase(); these tests pin them so a
 * refactor can't silently drop the durability/concurrency pragmas.
 */

const tempFiles: string[] = [];

afterAll(() => {
  for (const file of tempFiles) {
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}-wal`, { force: true });
    fs.rmSync(`${file}-shm`, { force: true });
  }
});

describe("database connection settings", () => {
  it("enables WAL, foreign-key enforcement, and a busy timeout", async () => {
    // WAL is a file-level mode; :memory: databases report 'memory', so this
    // test uses a real temp file.
    const file = path.join(
      os.tmpdir(),
      `tchat-pragma-${Date.now()}-${process.pid}.db`
    );
    tempFiles.push(file);

    const db: DB = await openDatabase(file);
    try {
      const journalMode = await db.get("PRAGMA journal_mode");
      expect(String(journalMode.journal_mode).toLowerCase()).toBe("wal");

      const foreignKeys = await db.get("PRAGMA foreign_keys");
      expect(Number(foreignKeys.foreign_keys)).toBe(1);

      // Note: this pragma's result column is named `timeout`.
      const busyTimeout = await db.get("PRAGMA busy_timeout");
      expect(Number(busyTimeout.timeout)).toBeGreaterThan(0);
    } finally {
      await db.close();
    }
  });
});
