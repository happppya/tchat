import path from 'path';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { EMPTY_ROOM_TTL_MS } from './constants';

export type DB = Database<sqlite3.Database, sqlite3.Statement>;

/** Busy handler wait before a locked write fails with SQLITE_BUSY (ms). */
const BUSY_TIMEOUT_MS = 5000;

/** Journal modes sqlite3 accepts for a file database. */
const ALLOWED_JOURNAL_MODES = [
  'delete',
  'truncate',
  'persist',
  'memory',
  'wal',
  'off',
] as const;
type JournalMode = (typeof ALLOWED_JOURNAL_MODES)[number];

/**
 * Journal mode from SQLITE_JOURNAL_MODE (default "wal").
 *
 * Cloud Storage FUSE volumes (Cloud Run) don't provide real file locking, so
 * WAL's -wal/-shm lock files are unsafe there — set SQLITE_JOURNAL_MODE=delete
 * (paired with --max-instances=1) when the DB lives on a FUSE mount.
 */
function journalModeFromEnv(): JournalMode {
  const value = (process.env.SQLITE_JOURNAL_MODE || 'wal').toLowerCase();
  return (ALLOWED_JOURNAL_MODES as readonly string[]).includes(value)
    ? (value as JournalMode)
    : 'wal';
}

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
  await db.exec(`PRAGMA journal_mode = ${journalModeFromEnv()};`);
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

  // Room-type flags: Hidden (password-gated), Readonly (admin-only speak),
  // Anonymous (random display names, no profiles), Transparent (default).
  await ensureGroupChatsTypeColumns(db);

  // Public/private flag: public rooms appear on the board, private are code-only.
  await ensureGroupChatsPublicColumn(db);

  // Role tables: site admins, room moderators, bans, mutes.
  await ensureUsersAdminColumn(db);
  await ensureRoomModeratorsTable(db);
  await ensureRoomBansTable(db);
  await ensureRoomMutesTable(db);

  // Stable anonymous display names per user per room.
  await ensureRoomAnonNamesTable(db);

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

  // Pinned messages: owner/mods/admins can highlight messages for the room.
  await ensureMessagesPinnedColumn(db);

  // Seed Room 0 (the directory lobby) during migration so it's always present.
  await seedRoomZero(db);

  // Board groups: admin-curated groupings of public rooms on the board tab.
  await ensureBoardGroupsTable(db);
  await ensureBoardGroupRoomsTable(db);

  // Forum rooms: a post-first discussion board with threads.
  await ensureGroupChatsForumColumn(db);
  await ensureForumPostsTable(db);
  await ensureMessagesForumPostIdColumn(db);
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

/** is_public flag: public rooms appear on the board; private rooms are code-only. */
async function ensureGroupChatsPublicColumn(db: DB): Promise<void> {
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

/** Room type flags: non-exclusive, all default to off (0). */
async function ensureGroupChatsTypeColumns(db: DB): Promise<void> {
  try {
    const cols = await db.all('PRAGMA table_info(group_chats)');
    const names = cols.map((c) => c.name);
    for (const [col, label] of [
      ['is_hidden', 'is_hidden'],
      ['password_hash', 'password_hash'],
      ['is_readonly', 'is_readonly'],
      ['is_anonymous', 'is_anonymous'],
      ['is_transparent', 'is_transparent'],
    ] as const) {
      if (!names.includes(col)) {
        const def = col === 'password_hash' ? 'TEXT' : 'INTEGER NOT NULL DEFAULT 0';
        await db.exec(`ALTER TABLE group_chats ADD COLUMN ${col} ${def}`);
        console.log(`group_chats table migrated: added ${label}`);
      }
    }
  } catch (err) {
    console.error('group_chats type columns migration failed:', (err as Error).message);
  }
}

/** is_admin flag on users: manually elevated site-wide admins. */
async function ensureUsersAdminColumn(db: DB): Promise<void> {
  try {
    const cols = await db.all('PRAGMA table_info(users)');
    if (!cols.some((c) => c.name === 'is_admin')) {
      await db.exec(
        'ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0'
      );
      console.log('users table migrated: added is_admin');
    }
  } catch (err) {
    console.error('users is_admin migration failed:', (err as Error).message);
  }
}

/** Room moderators: (room_id, user_id). Elevated by owner or admin. */
async function ensureRoomModeratorsTable(db: DB): Promise<void> {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS room_moderators (
        room_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        elevated_by INTEGER NOT NULL,
        elevated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (room_id, user_id)
      );
    `);
  } catch (err) {
    console.error('room_moderators migration failed:', (err as Error).message);
  }
}

/** Room bans: (room_id, user_id) with an expiry (null = permanent). */
async function ensureRoomBansTable(db: DB): Promise<void> {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS room_bans (
        room_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        banned_by INTEGER NOT NULL,
        banned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP WITH TIME ZONE,
        PRIMARY KEY (room_id, user_id)
      );
    `);
  } catch (err) {
    console.error('room_bans migration failed:', (err as Error).message);
  }
}

/** Room mutes: (room_id, user_id). Muted users cannot send messages. */
async function ensureRoomMutesTable(db: DB): Promise<void> {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS room_mutes (
        room_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        muted_by INTEGER NOT NULL,
        muted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (room_id, user_id)
      );
    `);
  } catch (err) {
    console.error('room_mutes migration failed:', (err as Error).message);
  }
}

/** Stable anonymous display names: one per (room, user) pair. */
async function ensureRoomAnonNamesTable(db: DB): Promise<void> {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS room_anon_names (
        room_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        anon_name TEXT NOT NULL,
        PRIMARY KEY (room_id, user_id)
      );
    `);
  } catch (err) {
    console.error('room_anon_names migration failed:', (err as Error).message);
  }
}

/** Get or create a stable anon name for a user in a room. */
export async function getAnonName(
  db: DB,
  userId: number,
  roomId: number
): Promise<string> {
  const row = await db.get(
    'SELECT anon_name FROM room_anon_names WHERE room_id = ? AND user_id = ?',
    [roomId, userId]
  );
  if (row) return row.anon_name;
  const name = randomAnonName();
  await db.run(
    'INSERT INTO room_anon_names (room_id, user_id, anon_name) VALUES (?, ?, ?)',
    [roomId, userId, name]
  );
  return name;
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

/** Pinned flag on messages. Owners, mods, and admins can toggle this. */
async function ensureMessagesPinnedColumn(db: DB): Promise<void> {
  try {
    const cols = await db.all('PRAGMA table_info(messages)');
    if (!cols.some((c) => c.name === 'pinned')) {
      await db.exec('ALTER TABLE messages ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
      console.log('messages table migrated: added pinned');
    }
  } catch (err) {
    console.error('messages pinned migration failed:', (err as Error).message);
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

/** Forum room flag on group_chats. */
async function ensureGroupChatsForumColumn(db: DB): Promise<void> {
  try {
    const cols = await db.all('PRAGMA table_info(group_chats)');
    if (!cols.some((c) => c.name === 'is_forum')) {
      await db.exec(
        'ALTER TABLE group_chats ADD COLUMN is_forum INTEGER NOT NULL DEFAULT 0'
      );
      console.log('group_chats table migrated: added is_forum');
    }
  } catch (err) {
    console.error('group_chats is_forum migration failed:', (err as Error).message);
  }
}

/** Forum posts — one row per thread. */
async function ensureForumPostsTable(db: DB): Promise<void> {
  // Helper: create the table + index in a single go.
  const createBoth = () => db.exec(`
    CREATE TABLE IF NOT EXISTS forum_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_chat_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      author_id INTEGER NOT NULL,
      display_name TEXT NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_forum_posts_gc ON forum_posts(group_chat_id);
  `);

  // Try normal creation first.
  try {
    await createBoth();
    // Verify the table is actually healthy — a prior deploy may have
    // left sqlite_master entry intact with a bad rootpage.
    await db.get('SELECT 1 AS ok FROM forum_posts LIMIT 1');
    return; // all good
  } catch (err) {
    const msg = (err as Error).message;
    if (
      msg.includes('SQLITE_CORRUPT') ||
      msg.includes('malformed database schema') ||
      msg.includes('invalid rootpage')
    ) {
      console.log('forum_posts table is corrupt — dropping and recreating…');
    } else {
      console.error('forum_posts migration failed:', msg);
      return; // non-corruption error (e.g. disk full) — don't touch the table
    }
  }

  // Drop the broken table and start fresh.
  try { await db.exec('DROP TABLE IF EXISTS forum_posts'); } catch (_) {}
  try {
    await createBoth();
    // Sanity-check the fresh table.
    await db.get('SELECT 1 AS ok FROM forum_posts LIMIT 1');
    console.log('forum_posts table recreated successfully');
  } catch (retryErr) {
    console.error('forum_posts recreation failed:', (retryErr as Error).message);
  }
}

/** forum_post_id on messages links a message to a forum thread. */
async function ensureMessagesForumPostIdColumn(db: DB): Promise<void> {
  try {
    const cols = await db.all('PRAGMA table_info(messages)');
    if (!cols.some((c) => c.name === 'forum_post_id')) {
      await db.exec('ALTER TABLE messages ADD COLUMN forum_post_id INTEGER');
      console.log('messages table migrated: added forum_post_id');
      await db.exec(
        'CREATE INDEX IF NOT EXISTS idx_messages_forum_post ON messages(forum_post_id, sent_at, id);'
      );
    }
  } catch (err) {
    console.error('messages forum_post_id migration failed:', (err as Error).message);
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
): Promise<Array<{ id: number; name: string; is_hidden: number; is_readonly: number; is_anonymous: number; is_transparent: number; is_public: number; is_forum: number }>> {
  return db.all(
    `SELECT g.id, g.name, g.is_hidden, g.is_readonly, g.is_anonymous, g.is_transparent, g.is_public, g.is_forum
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
  replyAuthor: string | null = null,
  forumPostId: number | null = null
): Promise<number> {
  const query = `INSERT INTO messages
    (group_chat_id, display_name, message_text, gif_url, sent_at, avatar_url, file_url, file_name, file_type, user_id, reply_to_id, reply_quote, reply_author, forum_post_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
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
    forumPostId,
  ]);
  return Number(result.lastID);
}

// --------------------------------------------------------------------------
// Forum posts
// --------------------------------------------------------------------------

export async function createForumPost(
  db: DB,
  groupChatId: number,
  title: string,
  content: string,
  authorId: number,
  displayName: string
): Promise<number> {
  const now = sqliteNow();
  const result = await db.run(
    `INSERT INTO forum_posts (group_chat_id, title, content, author_id, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [groupChatId, title, content, authorId, displayName, now, now]
  );
  return Number(result.lastID);
}

export async function getForumPost(db: DB, postId: number) {
  return db.get('SELECT * FROM forum_posts WHERE id = ?', [postId]);
}

export async function getForumPosts(
  db: DB,
  groupChatId: number,
  sort: 'recent' | 'date' | 'alpha' = 'recent',
  limit: number = 50,
  offset: number = 0
) {
  let order = 'fp.updated_at DESC, fp.id DESC';
  if (sort === 'date') order = 'fp.created_at DESC, fp.id DESC';
  if (sort === 'alpha') order = 'fp.title COLLATE NOCASE ASC, fp.id ASC';

  return db.all(
    `SELECT fp.*,
      (SELECT COUNT(*) FROM messages m WHERE m.forum_post_id = fp.id) AS reply_count
     FROM forum_posts fp
     WHERE fp.group_chat_id = ?
     ORDER BY ${order}
     LIMIT ? OFFSET ?`,
    [groupChatId, limit, offset]
  );
}

export async function searchForumPosts(
  db: DB,
  groupChatId: number,
  query: string
) {
  // Fuzzy: LIKE with % wildcards on both sides.
  const pattern = `%${query}%`;
  return db.all(
    `SELECT fp.*,
      (SELECT COUNT(*) FROM messages m WHERE m.forum_post_id = fp.id) AS reply_count
     FROM forum_posts fp
     WHERE fp.group_chat_id = ? AND (fp.title LIKE ? OR fp.content LIKE ?)
     ORDER BY fp.updated_at DESC
     LIMIT 50`,
    [groupChatId, pattern, pattern]
  );
}

export async function countForumPosts(db: DB, groupChatId: number): Promise<number> {
  const row = await db.get(
    'SELECT COUNT(*) AS cnt FROM forum_posts WHERE group_chat_id = ?',
    [groupChatId]
  );
  return Number(row?.cnt ?? 0);
}

export async function bumpForumPost(db: DB, postId: number): Promise<void> {
  await db.run(
    'UPDATE forum_posts SET updated_at = ? WHERE id = ?',
    [sqliteNow(), postId]
  );
}

/** Edit a forum post's title and/or content. Returns the updated row. */
export async function editForumPost(
  db: DB,
  postId: number,
  title: string,
  content: string
): Promise<void> {
  await db.run(
    'UPDATE forum_posts SET title = ?, content = ?, updated_at = ? WHERE id = ?',
    [title, content, sqliteNow(), postId]
  );
}

/** Delete a forum post and all its thread messages. */
export async function deleteForumPost(db: DB, postId: number): Promise<void> {
  // Clean up reactions on messages in this thread first (no FK cascade).
  await db.run(
    'DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE forum_post_id = ?)',
    [postId]
  );
  await db.run('DELETE FROM messages WHERE forum_post_id = ?', [postId]);
  await db.run('DELETE FROM forum_posts WHERE id = ?', [postId]);
}

export async function createGroupChat(
  db: DB,
  gc_id: number,
  gc_name: string,
  owner_user_id: number | null = null,
  is_hidden: number | boolean = 0,
  password_hash: string | null = null,
  is_readonly: number | boolean = 0,
  is_anonymous: number | boolean = 0,
  is_transparent: number | boolean = 0,
  is_public: number | boolean = 0,
  is_forum: number | boolean = 0
): Promise<void> {
  await db.run(
    `INSERT INTO group_chats (id, name, owner_user_id,
      is_hidden, password_hash, is_readonly, is_anonymous, is_transparent, is_public, is_forum)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      gc_id,
      gc_name,
      owner_user_id,
      is_hidden ? 1 : 0,
      password_hash ?? null,
      is_readonly ? 1 : 0,
      is_anonymous ? 1 : 0,
      is_transparent ? 1 : 0,
      is_public ? 1 : 0,
      is_forum ? 1 : 0,
    ]
  );
  const flags: string[] = [];
  if (is_hidden) flags.push('hidden');
  if (is_readonly) flags.push('readonly');
  if (is_anonymous) flags.push('anonymous');
  if (is_transparent) flags.push('transparent');
  if (is_forum) flags.push('forum');
  console.log(
    `GC created: ${gc_name} (ID: ${gc_id}) [${flags.join(', ') || 'none'}]`
  );
}

export async function destroyGroupChat(db: DB, gc_id: number): Promise<void> {
  // Authorization is handled by the route layer; admins may delete any room
  // including Room 0.
  // Reactions have no FK cascade, so clear them before the messages vanish.
  await db.run(
    'DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE group_chat_id = ?)',
    [gc_id]
  );
  await db.run('DELETE FROM messages WHERE group_chat_id = ?', [gc_id]);
  await db.run('DELETE FROM forum_posts WHERE group_chat_id = ?', [gc_id]);
  await db.run('DELETE FROM room_members WHERE room_id = ?', [gc_id]);
  await db.run('DELETE FROM room_moderators WHERE room_id = ?', [gc_id]);
  await db.run('DELETE FROM room_bans WHERE room_id = ?', [gc_id]);
  await db.run('DELETE FROM room_mutes WHERE room_id = ?', [gc_id]);
  await db.run('DELETE FROM room_anon_names WHERE room_id = ?', [gc_id]);
  await db.run('DELETE FROM board_group_rooms WHERE room_id = ?', [gc_id]);
  await db.run('DELETE FROM group_chats WHERE id = ?', [gc_id]);
  console.log(`GC destroyed: (ID: ${gc_id})`);
}

export async function clearAllGroupChats(db: DB): Promise<void> {
  await db.run(`DELETE FROM room_moderators`);
  await db.run(`DELETE FROM room_bans`);
  await db.run(`DELETE FROM room_mutes`);
  await db.run(`DELETE FROM room_anon_names`);
  await db.run(`DELETE FROM message_reactions`);
  await db.run(`DELETE FROM messages`);
  await db.run(`DELETE FROM room_members`);
  await db.run(`DELETE FROM board_group_rooms`);
  await db.run(`DELETE FROM board_groups`);
  await db.run(`DELETE FROM group_chats WHERE id != 0`);
  console.log(`All GCs destroyed (Room 0 preserved)`);
}

export async function validateGCID(db: DB, gc_id: number): Promise<boolean> {
  const query = `SELECT * FROM group_chats WHERE id = ?`;
  const result = await db.get(query, [gc_id]);
  return result !== undefined;
}

// --------------------------------------------------------------------------
// Role helpers — site admins, room owners, moderators, bans, mutes
// --------------------------------------------------------------------------

/** True when userId is a site admin. */
export async function isSiteAdmin(db: DB, userId: number): Promise<boolean> {
  const row = await db.get(
    'SELECT 1 AS present FROM users WHERE id = ? AND is_admin = 1',
    [userId]
  );
  return row !== undefined;
}

/** True when userId owns this room. */
export async function isRoomOwner(
  db: DB,
  userId: number,
  roomId: number
): Promise<boolean> {
  const row = await db.get(
    'SELECT 1 AS present FROM group_chats WHERE id = ? AND owner_user_id = ?',
    [roomId, userId]
  );
  return row !== undefined;
}

/** True when userId is an owner, mod, or site admin. */
export async function isRoomStaffOrAdmin(
  db: DB,
  userId: number,
  roomId: number
): Promise<boolean> {
  if (await isSiteAdmin(db, userId)) return true;
  if (await isRoomOwner(db, userId, roomId)) return true;
  const row = await db.get(
    'SELECT 1 AS present FROM room_moderators WHERE room_id = ? AND user_id = ?',
    [roomId, userId]
  );
  return row !== undefined;
}

/** True when userId is a moderator of this room specifically. */
export async function isRoomMod(
  db: DB,
  userId: number,
  roomId: number
): Promise<boolean> {
  const row = await db.get(
    'SELECT 1 AS present FROM room_moderators WHERE room_id = ? AND user_id = ?',
    [roomId, userId]
  );
  return row !== undefined;
}

/** True when userId is banned in this room (active ban, not expired). */
export async function isRoomBanned(
  db: DB,
  userId: number,
  roomId: number
): Promise<boolean> {
  const row = await db.get(
    `SELECT 1 AS present FROM room_bans
     WHERE room_id = ? AND user_id = ?
       AND (expires_at IS NULL OR expires_at > ?)`,
    [roomId, userId, sqliteNow()]
  );
  return row !== undefined;
}

/** True when userId is muted in this room. */
export async function isRoomMuted(
  db: DB,
  userId: number,
  roomId: number
): Promise<boolean> {
  const row = await db.get(
    'SELECT 1 AS present FROM room_mutes WHERE room_id = ? AND user_id = ?',
    [roomId, userId]
  );
  return row !== undefined;
}

/** Whether the room is flagged as readonly. */
export async function roomIsReadonly(
  db: DB,
  roomId: number
): Promise<boolean> {
  const row = await db.get(
    'SELECT is_readonly FROM group_chats WHERE id = ?',
    [roomId]
  );
  return row ? !!row.is_readonly : false;
}

/** Whether the room is flagged as anonymous. */
export async function roomIsAnonymous(
  db: DB,
  roomId: number
): Promise<boolean> {
  const row = await db.get(
    'SELECT is_anonymous FROM group_chats WHERE id = ?',
    [roomId]
  );
  return row ? !!row.is_anonymous : false;
}

/** Generate a short random display name for anonymous rooms. */
export function randomAnonName(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `Guest_${suffix}`;
}

/** Seed Room 0 (directory lobby) if it doesn't exist. Cannot be deleted. */
export async function seedRoomZero(db: DB): Promise<void> {
  const row = await db.get('SELECT id FROM group_chats WHERE id = 0');
  if (row) return;
  // Room 0 has no owner — it's the system room. Public by default.
  await db.run(
    "INSERT INTO group_chats (id, name, is_transparent, is_public) VALUES (0, 'Lobby', 1, 1)"
  );
  console.log('Room 0 seeded');
}

// ---------------------------------------------------------------------------
// Board groups — admin-curated groupings on the board tab
// ---------------------------------------------------------------------------

async function ensureBoardGroupsTable(db: DB): Promise<void> {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS board_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0
      );
    `);
  } catch (err) {
    console.error('board_groups migration failed:', (err as Error).message);
  }
}

async function ensureBoardGroupRoomsTable(db: DB): Promise<void> {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS board_group_rooms (
        group_id INTEGER NOT NULL,
        room_id INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (group_id, room_id)
      );
    `);
  } catch (err) {
    console.error('board_group_rooms migration failed:', (err as Error).message);
  }
}

/** Fetch all board groups with their room ids. */
export async function getBoardGroups(
  db: DB
): Promise<Array<{ id: number; name: string; position: number; roomIds: number[] }>> {
  const groups = await db.all(
    'SELECT id, name, position FROM board_groups ORDER BY position, id'
  );
  const result: Array<{ id: number; name: string; position: number; roomIds: number[] }> = [];
  for (const g of groups) {
    const rooms = await db.all(
      'SELECT room_id FROM board_group_rooms WHERE group_id = ? ORDER BY position, room_id',
      [g.id]
    );
    result.push({
      id: g.id,
      name: g.name,
      position: g.position,
      roomIds: rooms.map((r) => r.room_id),
    });
  }
  return result;
}

/** Create a new board group. */
export async function createBoardGroup(db: DB, name: string): Promise<number> {
  const maxPos = await db.get('SELECT MAX(position) AS maxPos FROM board_groups');
  const pos = (maxPos?.maxPos ?? -1) + 1;
  const result = await db.run(
    'INSERT INTO board_groups (name, position) VALUES (?, ?)',
    [name, pos]
  );
  return Number(result.lastID);
}

/** Rename a board group. */
export async function renameBoardGroup(db: DB, id: number, name: string): Promise<void> {
  await db.run('UPDATE board_groups SET name = ? WHERE id = ?', [name, id]);
}

/** Delete a board group (rooms spill to top level). */
export async function deleteBoardGroup(db: DB, id: number): Promise<void> {
  await db.run('DELETE FROM board_group_rooms WHERE group_id = ?', [id]);
  await db.run('DELETE FROM board_groups WHERE id = ?', [id]);
}

/** Add a room to a board group. */
export async function addRoomToBoardGroup(
  db: DB,
  groupId: number,
  roomId: number
): Promise<void> {
  // Remove from any existing group first.
  await db.run('DELETE FROM board_group_rooms WHERE room_id = ?', [roomId]);
  const maxPos = await db.get(
    'SELECT MAX(position) AS maxPos FROM board_group_rooms WHERE group_id = ?',
    [groupId]
  );
  await db.run(
    'INSERT OR REPLACE INTO board_group_rooms (group_id, room_id, position) VALUES (?, ?, ?)',
    [groupId, roomId, (maxPos?.maxPos ?? -1) + 1]
  );
}

/** Remove a room from its board group (spills to top level). */
export async function removeRoomFromBoardGroup(db: DB, roomId: number): Promise<void> {
  await db.run('DELETE FROM board_group_rooms WHERE room_id = ?', [roomId]);
}

/** Reorder board groups to match the given id order. */
export async function reorderBoardGroups(db: DB, ids: number[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await db.run('UPDATE board_groups SET position = ? WHERE id = ?', [i, ids[i]]);
  }
}

/** Reorder rooms within a board group. */
export async function reorderBoardGroupRooms(
  db: DB,
  groupId: number,
  roomIds: number[]
): Promise<void> {
  for (let i = 0; i < roomIds.length; i++) {
    await db.run(
      'UPDATE board_group_rooms SET position = ? WHERE group_id = ? AND room_id = ?',
      [i, groupId, roomIds[i]]
    );
  }
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
