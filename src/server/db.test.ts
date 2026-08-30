import { afterAll, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import { openDatabase, deleteEmptyRooms, type DB } from "./db";

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

  it("honors SQLITE_JOURNAL_MODE=delete (for FUSE-backed volumes)", async () => {
    const file = path.join(
      os.tmpdir(),
      `tchat-journal-${Date.now()}-${process.pid}.db`
    );
    tempFiles.push(file);

    const prev = process.env.SQLITE_JOURNAL_MODE;
    process.env.SQLITE_JOURNAL_MODE = "delete";
    const db: DB = await openDatabase(file);
    if (prev === undefined) delete process.env.SQLITE_JOURNAL_MODE;
    else process.env.SQLITE_JOURNAL_MODE = prev;
    try {
      const journalMode = await db.get("PRAGMA journal_mode");
      expect(String(journalMode.journal_mode).toLowerCase()).toBe("delete");
    } finally {
      await db.close();
    }
  });
});

describe("deleteEmptyRooms", () => {
  // EMPTY_ROOM_TTL_MS is captured at import time, so these use real timestamps
  // relative to the default 24h TTL instead of env overrides.
  const sqlTime = (msAgo: number) =>
    new Date(Date.now() - msAgo).toISOString().replace("T", " ").substring(0, 19);

  it("returns the ids of the rooms it deletes", async () => {
    const db: DB = await openDatabase(":memory:");
    try {
      await db.run("INSERT INTO group_chats (id, name, emptied_at) VALUES (111, 'Empty', ?)", [
        sqlTime(25 * 60 * 60 * 1000),
      ]);
      await db.run("INSERT INTO group_chats (id, name) VALUES (222, 'Kept')");

      const deleted = await deleteEmptyRooms(db);

      expect(deleted).toEqual([111]);
      const kept = await db.get("SELECT id FROM group_chats WHERE id = 222");
      expect(kept).toBeDefined();
    } finally {
      await db.close();
    }
  });

  it("returns an empty list when no rooms are due for deletion", async () => {
    const db: DB = await openDatabase(":memory:");
    try {
      await db.run("INSERT INTO group_chats (id, name, emptied_at) VALUES (113, 'Fresh', ?)", [
        sqlTime(60 * 1000),
      ]);

      const deleted = await deleteEmptyRooms(db);

      expect(deleted).toEqual([]);
    } finally {
      await db.close();
    }
  });
});
