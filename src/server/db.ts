import path from 'path';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { EMPTY_ROOM_TTL_MS } from './constants';

export type DB = Database<sqlite3.Database, sqlite3.Statement>;

/** Busy handler wait before a locked write fails with SQLITE_BUSY (ms). */
const BUSY_TIMEOUT_MS = 5000;

/**
 * Open the SQLite database and run all idempotent migrations. Returns the
 * ready-to-use db handle.
 */
export async function openDatabase(dbPath: string): Promise<DB> {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });
  // Concurrency settings: the HTTP API and WebSocket handlers write from many
  // interleaved async paths, so without WAL + a busy timeout any overlapping
  // write pair surfaces as SQLITE_BUSY errors. foreign_keys is off by default
  // per connection; enabling it keeps future schema changes safe (existing
  // tables declare no FKs, so this is inert until they do).
  await db.exec('PRAGMA journal_mode = WAL;');
  await db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
  await db.exec('PRAGMA foreign_keys = ON;');
  await runMigrations(db);
  return db;
}

/** Create base tables + apply every idempotent migration. */
export async function runMigrations(db: DB): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_chat_id INTEGER NOT NULL,
      display_name TEXT,
      message_text TEXT,
      gif_url TEXT,
      sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS group_chats (
      id INTEGER PRIMARY KEY,
      name TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Persistent login sessions (survive server restarts).
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);'
  );

  // Lightweight migration: the original schema stored credentials in ad-hoc
  // columns (user_name / password). If those legacy columns still exist from
  // an older database file, drop them so the new schema is the source of
  // truth. This is idempotent — no-op once the columns are gone.
  await migrateUsersTable(db);

  // Track who created each room so the owner can delete it later.
  await ensureGroupChatsOwnerColumn(db);

  // Permanent per-user data: which rooms each user is currently in, plus a
  // timestamp so fully-empty rooms can be reclaimed later.
  await ensureRoomMembersTable(db);
  await ensureGroupChatsEmptiedAtColumn(db);

  // Public rooms are discoverable in the rooms tab; private rooms are not.
  await ensureGroupChatsVisibilityColumn(db);

  // Profile fields on users and per-message avatars (denormalized at send
  // time, so old messages keep the avatar the author had then).
  await ensureUserProfileColumns(db);
  await ensureMessagesAvatarColumn(db);

  // Index the exact (group_chat_id, sent_at, id) access path pagination uses.
  await ensureMessagesPaginationIndex(db);

  // File attachments on messages.
  await ensureMessagesFileColumns(db);

  // Author identity + edit marker so users can edit/delete their own messages.
  await ensureMessagesUserColumn(db);
  await ensureMessagesEditedColumn(db);

  // Replies quote a message; reactions live in a small per-message join table.
  await ensureMessagesReplyColumns(db);
  await ensureMessageReactionsTable(db);
}

/**
 * Idempotent migration: ensure the users table matches the current schema.
 * Drops legacy columns (user_name/email/password) if they survived from an
 * older database file.
 */
async function migrateUsersTable(db: DB): Promise<void> {
  try {
    const cols = await db.all('PRAGMA table_info(users)');
    const names = cols.map((c) => c.name);
    const hasLegacy =
      names.includes('user_name') ||
      names.includes('email') ||
      names.includes('password') ||
      names.includes('display_name');
    const hasNew = names.includes('username') && names.includes('password_hash');
    if (hasLegacy && !hasNew) {
      await db.exec('DROP TABLE users');
      await db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
      console.log('users table migrated to new schema');
    }
  } catch (err) {
    console.error('users table migration failed:', (err as Error).message);
  }
}

/** Add owner_user_id to group_chats so room ownership is recorded. */
async function ensureGroupChatsOwnerColumn(db: DB): Promise<void> {
  try {
    const cols = await db.all('PRAGMA table_info(group_chats)');
    if (!cols.some((c) => c.name === 'owner_user_id')) {
      await db.exec('ALTER TABLE group_chats ADD COLUMN owner_user_id INTEGER');
      console.log('group_chats table migrated: added owner_user_id');
    }
  } catch (err) {
    console.error('group_chats migration failed:', (err as Error).message);
  }
}

/** Membership join table keyed by (user_id, room_id). */
async function ensureRoomMembersTable(db: DB): Promise<void> {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS room_members (
        user_id INTEGER NOT NULL,
        room_id INTEGER NOT NULL,
        joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, room_id)
      );
    `);
    await db.exec(
      'CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_id);'
    );
  } catch (err) {
    console.error('room_members migration failed:', (err as Error).message);
  }
}

/** emptied_at records when a room's last member left. */
async function ensureGroupChatsEmptiedAtColumn(db: DB): Promise<void> {
  try {
    const cols = await db.all('PRAGMA table_info(group_chats)');
    if (!cols.some((c) => c.name === 'emptied_at')) {
      await db.exec(
        'ALTER TABLE group_chats ADD COLUMN emptied_at TIMESTAMP WITH TIME ZONE'
      );
      console.log('group_chats table migrated: added emptied_at');
    }
  } catch (err) {
    console.error('group_chats emptied_at migration failed:', (err as Error).message);
  }
}

/** is_public marks a room as discoverable in the rooms tab. */
async function ensureGroupChatsVisibilityColumn(db: DB): Promise<void> {
  try {
    const cols = await db.all('PRAGMA table_info(group_chats)');
    if (!cols.some((c) => c.name === 'is_public')) {
      await db.exec(
        'ALTER TABLE group_chats ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0'
      );
      console.log('group_chats table migrated: added is_public');
    }
  } catch (err) {
    console.error('group_chats is_public migration failed:', (err as Error).message);
  }
}

/** User profile fields. */
async function ensureUserProfileColumns(db: DB): Promise<void> {
  try {
    const cols = await db.all('PRAGMA table_info(users)');
    const names = cols.map((c) => c.name);
    if (!names.includes('bio')) {
      await db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
      console.log('users table migrated: added bio');
    }
    if (!names.includes('picture_url')) {
      await db.exec('ALTER TABLE users ADD COLUMN picture_url TEXT');
      console.log('users table migrated: added picture_url');
    }
  } catch (err) {
    console.error('users profile migration failed:', (err as Error).message);
  }
}

/** Store the author's avatar on each message row (denormalized at send time). */
async function ensureMessagesAvatarColumn(db: DB): Promise<void> {
  try {
    const cols = await db.all('PRAGMA table_info(messages)');
    if (!cols.some((c) => c.name === 'avatar_url')) {
      await db.exec('ALTER TABLE messages ADD COLUMN avatar_url TEXT');
      console.log('messages table migrated: added avatar_url');
    }
  } catch (err) {
    console.error('messages avatar migration failed:', (err as Error).message);
  }
}

/** Composite index for the cursor pagination access pattern. */
async function ensureMessagesPaginationIndex(db: DB): Promise<void> {
  try {
    await db.exec(
      'CREATE INDEX IF NOT EXISTS idx_messages_gc_sent_id ON messages(group_chat_id, sent_at, id);'
    );
  } catch (err) {
    console.error('messages pagination index failed:', (err as Error).message);
  }
}

/** The author's user id, needed to authorize edit/delete. */
async function ensureMessagesUserColumn(db: DB): Promise<void> {
  try {
    const cols = await db.all('PRAGMA table_info(messages)');
    if (!cols.some((c) => c.name === 'user_id')) {
      await db.exec('ALTER TABLE messages ADD COLUMN user_id INTEGER');
      console.log('messages table migrated: added user_id');
    }
  } catch (err) {
    console.error('messages user_id migration failed:', (err as Error).message);
  }
}

/** edited_at stamps when a message was last edited. */
async function ensureMessagesEditedColumn(db: DB): Promise<void> {
  try {
    const cols = await db.all('PRAGMA table_info(messages)');
    if (!cols.some((c) => c.name === 'edited_at')) {
      await db.exec(
        'ALTER TABLE messages ADD COLUMN edited_at TIMESTAMP WITH TIME ZONE'
      );
      console.log('messages table migrated: added edited_at');
    }
  } catch (err) {
    console.error('messages edited_at migration failed:', (err as Error).message);
  }
}

/** Reply metadata (denormalized quote + author). */
async function ensureMessagesReplyColumns(db: DB): Promise<void> {
  try {
    const cols = await db.all('PRAGMA table_info(messages)');
    const names = cols.map((c) => c.name);
    if (!names.includes('reply_to_id')) {
      await db.exec('ALTER TABLE messages ADD COLUMN reply_to_id INTEGER');
      console.log('messages table migrated: added reply_to_id');
    }
    if (!names.includes('reply_quote')) {
      await db.exec('ALTER TABLE messages ADD COLUMN reply_quote TEXT');
      console.log('messages table migrated: added reply_quote');
    }
    if (!names.includes('reply_author')) {
      await db.exec('ALTER TABLE messages ADD COLUMN reply_author TEXT');
      console.log('messages table migrated: added reply_author');
    }
  } catch (err) {
    console.error('messages reply columns migration failed:', (err as Error).message);
  }
}

/** Emoji reactions, one row per (message, user, emoji). */
async function ensureMessageReactionsTable(db: DB): Promise<void> {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS message_reactions (
        message_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        emoji TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (message_id, user_id, emoji)
      );
    `);
  } catch (err) {
    console.error('message_reactions migration failed:', (err as Error).message);
  }
}

/** File attachment columns (bytes live on disk, not in the DB). */
async function ensureMessagesFileColumns(db: DB): Promise<void> {
  try {
    const cols = await db.all('PRAGMA table_info(messages)');
    const names = cols.map((c) => c.name);
    if (!names.includes('file_url')) {
      await db.exec('ALTER TABLE messages ADD COLUMN file_url TEXT');
      console.log('messages table migrated: added file_url');
    }
    if (!names.includes('file_name')) {
      await db.exec('ALTER TABLE messages ADD COLUMN file_name TEXT');
      console.log('messages table migrated: added file_name');
    }
    if (!names.includes('file_type')) {
      await db.exec('ALTER TABLE messages ADD COLUMN file_type TEXT');
      console.log('messages table migrated: added file_type');
    }
  } catch (err) {
    console.error('messages file columns migration failed:', (err as Error).message);
  }
}

/** Current time in the zero-padded SQLite datetime format used elsewhere. */
export function sqliteNow(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/** Map a MIME type to a safe, short file extension for stored uploads. */
export function extensionForMime(mime: string): string {
  const m = String(mime || '').toLowerCase();
  if (m.includes('png')) return '.png';
  if (m.includes('jpeg') || m.includes('jpg')) return '.jpg';
  if (m.includes('gif')) return '.gif';
  if (m.includes('svg')) return '.svg';
  if (m.includes('webp')) return '.webp';
  if (m.includes('pdf')) return '.pdf';
  if (m.includes('json')) return '.json';
  if (m.includes('text/plain')) return '.txt';
  if (m.includes('text/')) return '.txt';
  if (m.includes('zip')) return '.zip';
  return '.bin';
}

/** Keep only the basename and strip path/control characters. */
export function sanitizeFileName(name: string): string {
  if (typeof name !== 'string') return '';
  const base = path.basename(name).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  return base.trim() || '';
}

/** Add a user to a room (idempotent) and mark the room active again. */
export async function addRoomMember(
  db: DB,
  userId: number,
  roomId: number
): Promise<void> {
  await db.run(
    'INSERT OR IGNORE INTO room_members (user_id, room_id, joined_at) VALUES (?, ?, ?)',
    [userId, roomId, sqliteNow()]
  );
  await db.run('UPDATE group_chats SET emptied_at = NULL WHERE id = ?', [roomId]);
}

/** Remove a user from a room; stamp the room as empty when the last one leaves. */
export async function removeRoomMember(
  db: DB,
  userId: number,
  roomId: number
): Promise<void> {
  await db.run('DELETE FROM room_members WHERE user_id = ? AND room_id = ?', [
    userId,
    roomId,
  ]);
  const remaining = await db.get(
    'SELECT COUNT(*) AS count FROM room_members WHERE room_id = ?',
    [roomId]
  );
  if (remaining && remaining.count === 0) {
    await db.run('UPDATE group_chats SET emptied_at = ? WHERE id = ?', [
      sqliteNow(),
      roomId,
    ]);
  }
}

/** True when `userId` is currently a member of room `roomId`. */
export async function isRoomMember(
  db: DB,
  userId: number,
  roomId: number
): Promise<boolean> {
  const row = await db.get(
    'SELECT 1 AS present FROM room_members WHERE user_id = ? AND room_id = ?',
    [userId, roomId]
  );
  return row !== undefined;
}

/** Rooms the given user is currently a member of. */
export async function getUserRooms(
  db: DB,
  userId: number
): Promise<Array<{ id: number; name: string; is_public: number }>> {
  return db.all(
    `SELECT g.id, g.name, g.is_public
     FROM group_chats g
     JOIN room_members m ON m.room_id = g.id
     WHERE m.user_id = ?
     ORDER BY g.id`,
    [userId]
  );
}

/** Delete rooms whose last member left more than EMPTY_ROOM_TTL_MS ago. */
export async function deleteEmptyRooms(db: DB): Promise<void> {
  const cutoff = new Date(Date.now() - EMPTY_ROOM_TTL_MS)
    .toISOString()
    .replace('T', ' ')
    .substring(0, 19);
  const rooms = await db.all(
    'SELECT id FROM group_chats WHERE emptied_at IS NOT NULL AND emptied_at <= ?',
    [cutoff]
  );
  for (const room of rooms) {
    await destroyGroupChat(db, room.id);
  }
}

export async function addMessageToTable(
  db: DB,
  groupChatId: number,
  messageText: string,
  displayNameText: string,
  gifUrl: string,
  timestamp: string,
  avatarUrl: string | null = null,
  fileUrl: string | null = null,
  fileName: string | null = null,
  fileType: string | null = null,
  userId: number | null = null,
  replyToId: number | null = null,
  replyQuote: string | null = null,
  replyAuthor: string | null = null
): Promise<number> {
  const query = `INSERT INTO messages
    (group_chat_id, display_name, message_text, gif_url, sent_at, avatar_url, file_url, file_name, file_type, user_id, reply_to_id, reply_quote, reply_author)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const result = await db.run(query, [
    groupChatId,
    displayNameText,
    messageText,
    gifUrl,
    timestamp,
    avatarUrl,
    fileUrl,
    fileName,
    fileType,
    userId,
    replyToId,
    replyQuote,
    replyAuthor,
  ]);
  return Number(result.lastID);
}

export async function createGroupChat(
  db: DB,
  gc_id: number,
  gc_name: string,
  owner_user_id: number | null = null,
  is_public: number | boolean = 0
): Promise<void> {
  const query = `INSERT INTO group_chats (id, name, owner_user_id, is_public) VALUES (?, ?, ?, ?)`;
  await db.run(query, [gc_id, gc_name, owner_user_id, is_public ? 1 : 0]);
  console.log(
    `GC created: ${gc_name} (ID: ${gc_id}) ${is_public ? '(public)' : '(private)'}`
  );
}

export async function destroyGroupChat(db: DB, gc_id: number): Promise<void> {
  // Reactions have no FK cascade, so clear them before the messages vanish.
  await db.run(
    'DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE group_chat_id = ?)',
    [gc_id]
  );
  await db.run('DELETE FROM messages WHERE group_chat_id = ?', [gc_id]);
  await db.run('DELETE FROM room_members WHERE room_id = ?', [gc_id]);
  await db.run('DELETE FROM group_chats WHERE id = ?', [gc_id]);
  console.log(`GC destroyed: (ID: ${gc_id})`);
}

export async function clearAllGroupChats(db: DB): Promise<void> {
  await db.run(`DELETE FROM group_chats`);
  await db.run(`DELETE FROM messages`);
  await db.run(`DELETE FROM room_members`);
  await db.run(`DELETE FROM message_reactions`);
  console.log(`All GCs destroyed`);
}

export async function validateGCID(db: DB, gc_id: number): Promise<boolean> {
  const query = `SELECT * FROM group_chats WHERE id = ?`;
  const result = await db.get(query, [gc_id]);
  return result !== undefined;
}

export interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
}

/** Aggregate reactions for one message into [{ emoji, count, me }]. */
export async function getReactionsForMessage(
  db: DB,
  messageId: number,
  userId: number
): Promise<Reaction[]> {
  const rows = await db.all(
    `SELECT emoji, COUNT(*) AS count,
            MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS me
     FROM message_reactions
     WHERE message_id = ?
     GROUP BY emoji
     ORDER BY emoji`,
    [userId, messageId]
  );
  return rows.map((r) => ({ emoji: r.emoji, count: r.count, me: !!r.me }));
}

/** Attach each message's reaction list in-place (used by getMessages). */
export async function attachReactions(
  db: DB,
  messages: Array<{ id: number; reactions?: Reaction[] }>,
  userId: number
): Promise<void> {
  if (!messages.length) return;
  const ids = messages.map((m) => m.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT message_id, emoji, COUNT(*) AS count,
            MAX(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS me
     FROM message_reactions
     WHERE message_id IN (${placeholders})
     GROUP BY message_id, emoji
     ORDER BY emoji`,
    [userId, ...ids]
  );

  const byMessage = new Map<number, Reaction[]>();
  for (const r of rows) {
    if (!byMessage.has(r.message_id)) byMessage.set(r.message_id, []);
    byMessage.get(r.message_id)!.push({
      emoji: r.emoji,
      count: r.count,
      me: !!r.me,
    });
  }
  for (const m of messages) {
    m.reactions = byMessage.get(m.id) || [];
  }
}
