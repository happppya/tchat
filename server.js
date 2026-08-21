const express = require('express');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { WebSocketServer } = require('ws');
const readline = require('readline');
require('dotenv').config();

const {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  sessionCookie,
  clearSessionCookie,
  readSession,
  requireAuth,
} = require('./src/server/auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const wss = new WebSocketServer({ noServer: true });
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
let db;

// Room codes are numeric IDs. Cap their length so codes stay short and
// greppable (matches the 6-digit codes the tests generate).
const MAX_GC_ID_DIGITS = 6;

// A room with no members is "empty". Give it a grace period, then delete it
// (and its messages) in the background. Both knobs are env-tunable for tests.
const EMPTY_ROOM_TTL_MS = Number(process.env.EMPTY_ROOM_TTL_MS) || 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS) || 5 * 60 * 1000;

// Text messages can carry markdown/code blocks, so allow a roomier body than
// the old 300-char cap. Files are capped separately to protect the disk.
const MAX_MESSAGE_LENGTH = 4000;
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB

// Allow base64 data-URL uploads (up to the 2 MB file cap) through the JSON
// body parser.
app.use(express.json({ limit: '5mb' }));

// Health check endpoint (no DB dependency, for test/CI readiness)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve static files from the React build (production) or fall back to root files
const path = require('path');
app.use(express.static(path.join(__dirname, 'dist')));

// Uploaded attachments live on disk (not in the DB) so message history stays
// small and the files can be served directly by the web server.
const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// Also serve root-level legacy HTML files (popup.html for Chrome extension)
app.use(express.static(__dirname));

// SPA fallback: any non-API, non-static route -> dist/index.html
app.get(/^(?!\/api\/|\/ws|\/uploads\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'), (err) => {
    if (err) {
      // Fall back to old index.html during development
      res.sendFile(path.join(__dirname, 'index.html'), (err2) => {
        if (err2) res.status(404).send('Not found');
      });
    }
  });
});

async function initializeAndStore() {
  const dbPath = process.env.DATABASE_PATH || './database.db';
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });
  console.log('Connected to local SQLite file database!');

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

  // Profile fields on users and per-message avatars (denormalized at send
  // time, so old messages keep the avatar the author had then).
  await ensureUserProfileColumns(db);
  await ensureMessagesAvatarColumn(db);

  // Index the exact (group_chat_id, sent_at, id) access path pagination uses.
  await ensureMessagesPaginationIndex(db);

  // File attachments on messages.
  await ensureMessagesFileColumns(db);

  // Reap fully-empty rooms on a timer. The HTTP server keeps the process
  // alive, so this interval just runs for the lifetime of the process.
  setInterval(() => {
    deleteEmptyRooms().catch((err) => {
      console.error('Empty-room cleanup failed:', err.message);
    });
  }, CLEANUP_INTERVAL_MS);

  try {
    const messages = await db.all('SELECT * FROM messages');
    //console.log('Current messages in file:', messages);

    const groupChats = await db.all('SELECT * FROM group_chats');
    //console.log('Current group chats in file:', groupChats);
  } catch (error) {
    console.error('Error handling database operations:', error.message);
  }
}

initializeAndStore();

/**
 * Idempotent migration: ensure the users table matches the current schema.
 * Drops legacy columns (user_name/email/password) if they survived from an
 * older database file. SQLite doesn't support DROP COLUMN before 3.35, so we
 * guard with a PRAGMA check and recreate the table when needed.
 */
async function migrateUsersTable(db) {
  try {
    const cols = await db.all("PRAGMA table_info(users)");
    const names = cols.map((c) => c.name);
    const hasLegacy = names.includes('user_name') || names.includes('email') || names.includes('password') || names.includes('display_name');
    const hasNew = names.includes('username') && names.includes('password_hash');
    if (hasLegacy && !hasNew) {
      // Recreate with the clean schema. Existing rows can't be migrated
      // meaningfully (old passwords were plaintext or differently shaped),
      // so we drop them — users simply re-register.
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
    console.error('users table migration failed:', err.message);
  }
}

/**
 * Idempotent migration: add owner_user_id to group_chats so room ownership is
 * recorded when a room is created. Existing rooms get NULL (no owner), which
 * simply means no one can delete them via the API — the CLI still can.
 */
async function ensureGroupChatsOwnerColumn(db) {
  try {
    const cols = await db.all("PRAGMA table_info(group_chats)");
    if (!cols.some((c) => c.name === 'owner_user_id')) {
      await db.exec('ALTER TABLE group_chats ADD COLUMN owner_user_id INTEGER');
      console.log('group_chats table migrated: added owner_user_id');
    }
  } catch (err) {
    console.error('group_chats migration failed:', err.message);
  }
}

/**
 * Idempotent migration: a membership join table keyed by (user_id, room_id),
 * indexed for lookups from both directions. This is the durable record of
 * "which rooms is this user currently in" — it lives in the DB, not the
 * browser, so it follows the user across devices.
 */
async function ensureRoomMembersTable(db) {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS room_members (
        user_id INTEGER NOT NULL,
        room_id INTEGER NOT NULL,
        joined_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, room_id)
      );
    `);
    // The PK covers user_id lookups; add a room_id index for member counts
    // and per-room cleanup.
    await db.exec('CREATE INDEX IF NOT EXISTS idx_room_members_room ON room_members(room_id);');
  } catch (err) {
    console.error('room_members migration failed:', err.message);
  }
}

/**
 * Idempotent migration: emptied_at records when a room's last member left, so
 * the cleanup job can reclaim it after the grace period.
 */
async function ensureGroupChatsEmptiedAtColumn(db) {
  try {
    const cols = await db.all("PRAGMA table_info(group_chats)");
    if (!cols.some((c) => c.name === 'emptied_at')) {
      await db.exec('ALTER TABLE group_chats ADD COLUMN emptied_at TIMESTAMP WITH TIME ZONE');
      console.log('group_chats table migrated: added emptied_at');
    }
  } catch (err) {
    console.error('group_chats emptied_at migration failed:', err.message);
  }
}

/**
 * Idempotent migration: user profile fields. bio is a short free-text blurb;
 * picture_url is an optional image URL (http(s) or data:image).
 */
async function ensureUserProfileColumns(db) {
  try {
    const cols = await db.all("PRAGMA table_info(users)");
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
    console.error('users profile migration failed:', err.message);
  }
}

/**
 * Idempotent migration: store the author's avatar on each message row so the
 * chat can render pictures without a lookup per author on every render.
 */
async function ensureMessagesAvatarColumn(db) {
  try {
    const cols = await db.all("PRAGMA table_info(messages)");
    if (!cols.some((c) => c.name === 'avatar_url')) {
      await db.exec('ALTER TABLE messages ADD COLUMN avatar_url TEXT');
      console.log('messages table migrated: added avatar_url');
    }
  } catch (err) {
    console.error('messages avatar migration failed:', err.message);
  }
}

/**
 * Idempotent index for the message pagination access pattern. Cursor-based
 * pagination queries by (group_chat_id, sent_at, id), so a composite index
 * lets SQLite seek directly instead of scanning the whole room's history as
 * chats grow large.
 */
async function ensureMessagesPaginationIndex(db) {
  try {
    await db.exec(
      'CREATE INDEX IF NOT EXISTS idx_messages_gc_sent_id ON messages(group_chat_id, sent_at, id);'
    );
  } catch (err) {
    console.error('messages pagination index failed:', err.message);
  }
}

/**
 * Idempotent migration: file attachment columns. The file bytes themselves
 * live on disk; the DB stores only the served URL, original name, and MIME.
 */
async function ensureMessagesFileColumns(db) {
  try {
    const cols = await db.all("PRAGMA table_info(messages)");
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
    console.error('messages file columns migration failed:', err.message);
  }
}

/** Current time in the zero-padded SQLite datetime format used elsewhere. */
function sqliteNow() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/** Map a MIME type to a safe, short file extension for stored uploads. */
function extensionForMime(mime) {
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
function sanitizeFileName(name) {
  if (typeof name !== 'string') return '';
  const base = path.basename(name).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  return base.trim() || '';
}

/** Add a user to a room (idempotent) and mark the room active again. */
async function addRoomMember(userId, roomId) {
  await db.run(
    'INSERT OR IGNORE INTO room_members (user_id, room_id, joined_at) VALUES (?, ?, ?)',
    [userId, roomId, sqliteNow()]
  );
  await db.run('UPDATE group_chats SET emptied_at = NULL WHERE id = ?', [roomId]);
}

/** Remove a user from a room; stamp the room as empty when the last one leaves. */
async function removeRoomMember(userId, roomId) {
  await db.run('DELETE FROM room_members WHERE user_id = ? AND room_id = ?', [userId, roomId]);
  const remaining = await db.get('SELECT COUNT(*) AS count FROM room_members WHERE room_id = ?', [roomId]);
  if (remaining.count === 0) {
    await db.run('UPDATE group_chats SET emptied_at = ? WHERE id = ?', [sqliteNow(), roomId]);
  }
}

/** Rooms the given user is currently a member of. */
async function getUserRooms(userId) {
  return db.all(
    `SELECT g.id, g.name
     FROM group_chats g
     JOIN room_members m ON m.room_id = g.id
     WHERE m.user_id = ?
     ORDER BY g.id`,
    [userId]
  );
}

/** Delete rooms whose last member left more than EMPTY_ROOM_TTL_MS ago. */
async function deleteEmptyRooms() {
  const cutoff = new Date(Date.now() - EMPTY_ROOM_TTL_MS)
    .toISOString()
    .replace('T', ' ')
    .substring(0, 19);
  const rooms = await db.all(
    'SELECT id FROM group_chats WHERE emptied_at IS NOT NULL AND emptied_at <= ?',
    [cutoff]
  );
  for (const room of rooms) {
    await destroyGroupChat(room.id);
  }
}

// ---------------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------------

/** Validation: 3–30 chars, letters/digits/_/-/. — no spaces or symbols. */
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,30}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body || {};
  const cleanUser = typeof username === 'string' ? username.trim() : '';
  const cleanPass = typeof password === 'string' ? password : '';

  if (!USERNAME_RE.test(cleanUser)) {
    return res.status(400).json({ error: 'Username must be 3–30 chars (letters, digits, _ . -)' });
  }
  if (cleanPass.length < MIN_PASSWORD || cleanPass.length > MAX_PASSWORD) {
    return res.status(400).json({ error: `Password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters` });
  }

  try {
    const hash = await hashPassword(cleanPass);
    await db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [cleanUser, hash]);
  } catch (err) {
    if (err && /UNIQUE/i.test(String(err.message))) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    console.error('Signup failed:', err);
    return res.status(500).json({ error: 'Failed to create account' });
  }

  // Immediately create a session and log the user in.
  const user = await db.get('SELECT id, username, bio, picture_url FROM users WHERE username = ?', [cleanUser]);
  const token = createSession(user);
  res.setHeader('Set-Cookie', sessionCookie(token));
  res.status(201).json({ user });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const cleanUser = typeof username === 'string' ? username.trim() : '';
  const cleanPass = typeof password === 'string' ? password : '';

  if (!cleanUser || !cleanPass) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = await db.get('SELECT id, username, password_hash, bio, picture_url FROM users WHERE username = ?', [cleanUser]);

  // Run a verify regardless of whether the user exists, to avoid a timing
  // side-channel that reveals which usernames are registered. We compare
  // against a dummy hash when the row is missing.
  const dummyHash = 'scrypt:32768:8:1:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';
  const ok = await verifyPassword(cleanPass, user ? user.password_hash : dummyHash);

  if (!user || !ok) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = createSession(user);
  res.setHeader('Set-Cookie', sessionCookie(token));
  res.json({ user: { id: user.id, username: user.username, bio: user.bio, picture_url: user.picture_url } });
});

app.post('/api/logout', (req, res) => {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;)\s*sid=([^;]+)/);
  if (match) destroySession(match[1]);
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  const user = await db.get('SELECT id, username, bio, picture_url FROM users WHERE id = ?', [session.userId]);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user });
});

/** View a user's public profile. */
app.get('/api/profile/:username', requireAuth, async (req, res) => {
  const username = typeof req.params.username === 'string' ? req.params.username.trim() : '';
  if (!username) return res.status(400).json({ error: 'Username is required' });

  const user = await db.get('SELECT username, bio, picture_url FROM users WHERE username = ?', [username]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

/** Edit the current user's profile (bio + optional picture). */
app.put('/api/profile', requireAuth, async (req, res) => {
  const { bio, pictureUrl } = req.body || {};
  const cleanBio = typeof bio === 'string' ? bio.trim() : '';
  const cleanPicture = typeof pictureUrl === 'string' ? pictureUrl.trim() : '';

  if (cleanBio.length > 500) {
    return res.status(400).json({ error: 'Bio must be 500 characters or fewer' });
  }
  if (cleanPicture.length > 2000) {
    return res.status(400).json({ error: 'Picture URL is too long' });
  }
  if (cleanPicture && !/^(https?:\/\/|data:image\/)/i.test(cleanPicture)) {
    return res.status(400).json({ error: 'Picture must be an image URL (http(s) or data:image)' });
  }

  await db.run(
    'UPDATE users SET bio = ?, picture_url = ? WHERE id = ?',
    [cleanBio, cleanPicture || null, req.session.userId]
  );
  const user = await db.get('SELECT id, username, bio, picture_url FROM users WHERE id = ?', [req.session.userId]);
  res.json({ user });
});

function shutdown() {
  console.log("Closing database...");
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);

async function addMessageToTable(
  groupChatId,
  messageText,
  displayNameText,
  gifUrl,
  timestamp,
  avatarUrl = null,
  fileUrl = null,
  fileName = null,
  fileType = null
) {
  const query = `INSERT INTO messages
    (group_chat_id, display_name, message_text, gif_url, sent_at, avatar_url, file_url, file_name, file_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  await db.run(query, [
    groupChatId,
    displayNameText,
    messageText,
    gifUrl,
    timestamp,
    avatarUrl,
    fileUrl,
    fileName,
    fileType,
  ]);
}

async function createGroupChat(gc_id, gc_name, owner_user_id = null) {
  const query = `INSERT INTO group_chats (id, name, owner_user_id) VALUES (?, ?, ?)`;
  await db.run(query, [gc_id, gc_name, owner_user_id]);
  console.log(`GC created: ${gc_name} (ID: ${gc_id})`);
}

async function destroyGroupChat(gc_id) {
  await db.run(
    'DELETE FROM messages WHERE group_chat_id = ?',
    [gc_id]
  );

  await db.run(
    'DELETE FROM room_members WHERE room_id = ?',
    [gc_id]
  );

  await db.run(
    'DELETE FROM group_chats WHERE id = ?',
    [gc_id]
  );

  console.log(`GC destroyed: (ID: ${gc_id})`);
}

async function clearAllGroupChats() {
  await db.run(`DELETE FROM group_chats`);
  await db.run(`DELETE FROM messages`);
  await db.run(`DELETE FROM room_members`);
  console.log(`All GCs destroyed`);
}

async function validateGCID(gc_id) {
  const query = `SELECT * FROM group_chats WHERE id = ?`;
  const result = await db.get(query, [gc_id]);
  return result !== undefined;
}

// Upload a small file, store it on disk, and hand back a public /uploads URL
// the client can then attach to a chat message.
app.post('/api/upload', requireAuth, async (req, res) => {
  const { fileName, dataUrl } = req.body || {};

  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return res.status(400).json({ error: 'Invalid file data' });
  }
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) {
    return res.status(400).json({ error: 'Expected a base64 data URL' });
  }

  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) {
    return res.status(400).json({ error: 'File is empty' });
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return res.status(413).json({
      error: `File exceeds ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit`,
    });
  }

  const storedName = crypto.randomBytes(12).toString('hex') + extensionForMime(mime);
  try {
    await fs.promises.writeFile(path.join(UPLOAD_DIR, storedName), buffer);
  } catch (err) {
    console.error('Upload write failed:', err.message);
    return res.status(500).json({ error: 'Failed to store file' });
  }

  res.status(201).json({
    url: `/uploads/${storedName}`,
    fileName: sanitizeFileName(fileName) || storedName,
    fileType: mime,
    size: buffer.length,
  });
});

app.get('/api/getMessages', requireAuth, async (req, res) => {
  const start = performance.now();
  const { groupChatId, limit: rawLimit, numMessages, beforeSentAt, beforeId } = req.query;

  // Pagination is cursor-based (keyset), not OFFSET-based, so fetching deep
  // history stays a direct index seek as a room grows.
  const requested = rawLimit ?? numMessages;
  const limit = Math.min(Math.max(parseInt(requested, 10) || 50, 1), 100);

  if (groupChatId && !(await validateGCID(groupChatId))) {
    return res.status(400).json({ error: 'Invalid group chat ID' });
  }

  const gcId = parseInt(groupChatId, 10);
  const hasBefore = beforeSentAt !== undefined || beforeId !== undefined;
  if (hasBefore && (!beforeSentAt || !beforeId)) {
    return res.status(400).json({ error: 'beforeSentAt and beforeId must be provided together' });
  }

  let messages;
  if (beforeSentAt && beforeId) {
    // Keyset: everything strictly older than (beforeSentAt, beforeId), newest
    // first. sent_at has second precision, so id breaks same-second ties.
    messages = await db.all(
      `SELECT * FROM messages
       WHERE group_chat_id = ?
         AND (sent_at < ? OR (sent_at = ? AND id < ?))
       ORDER BY sent_at DESC, id DESC
       LIMIT ?`,
      [gcId, beforeSentAt, beforeSentAt, parseInt(beforeId, 10), limit]
    );
  } else {
    // Chat open: the most recent page.
    messages = await db.all(
      'SELECT * FROM messages WHERE group_chat_id = ? ORDER BY sent_at DESC, id DESC LIMIT ?',
      [gcId, limit]
    );
  }

  const end = performance.now();
  console.log(`getMessages took ${end - start} ms`);
  res.json(messages);
});

app.get('/api/getGCInfo', requireAuth, async (req, res) => {
  const start = performance.now();
  const { groupChatId } = req.query;

  if (!groupChatId) {
    return res.status(400).json({ error: 'Missing group chat ID' });
  }

  if (!(await validateGCID(groupChatId))) {
    return res.status(400).json({ error: 'Invalid group chat ID' });
  }

  const groupChat = await db.get('SELECT * FROM group_chats WHERE id = ?', [parseInt(groupChatId)]);
  const end = performance.now();
  console.log(`getGCInfo took ${end - start} ms`);
  res.json(groupChat);
});

app.post('/api/createGC', requireAuth, async (req, res) => {
  const { id, name } = req.body || {};
  const idStr = String(id ?? '').trim();
  const cleanName = typeof name === 'string' ? name.trim() : '';

  // Room codes are 1–6 digits. Reject anything else rather than letting an
  // oversized code (or a negative value) become a confusing DB entry.
  if (!/^\d{1,6}$/.test(idStr) || parseInt(idStr, 10) <= 0) {
    return res.status(400).json({ error: `Room code must be 1–${MAX_GC_ID_DIGITS} digits` });
  }
  if (!cleanName) {
    return res.status(400).json({ error: 'Room name is required' });
  }

  const gcId = parseInt(idStr, 10);

  try {
    // Explicit duplicate check so the client can tell the user why creation
    // failed instead of surfacing a generic 500.
    const existing = await db.get('SELECT id FROM group_chats WHERE id = ?', [gcId]);
    if (existing) {
      return res.status(409).json({ error: 'A room with this code already exists' });
    }

    await createGroupChat(gcId, cleanName, req.session.userId);
    // The creator is automatically a member of the room they just made.
    await addRoomMember(req.session.userId, gcId);
    res.status(201).json({ message: 'Group chat created successfully' });
  } catch (err) {
    // Safety net for races: the PRIMARY KEY constraint catches a duplicate
    // that slipped in between the SELECT and the INSERT.
    if (/UNIQUE/i.test(String(err && err.message))) {
      return res.status(409).json({ error: 'A room with this code already exists' });
    }
    console.error('Create GC failed:', err);
    res.status(500).json({ error: 'Failed to create group chat' });
  }
});

app.delete('/api/deleteGC', requireAuth, async (req, res) => {
  const { groupChatId } = req.body || {};
  const idStr = String(groupChatId ?? '').trim();

  if (!/^\d{1,6}$/.test(idStr) || parseInt(idStr, 10) <= 0) {
    return res.status(400).json({ error: 'Invalid room code' });
  }

  const gcId = parseInt(idStr, 10);
  const groupChat = await db.get('SELECT * FROM group_chats WHERE id = ?', [gcId]);

  if (!groupChat) {
    return res.status(404).json({ error: 'Room not found' });
  }

  if (groupChat.owner_user_id !== req.session.userId) {
    return res.status(403).json({ error: 'Only the room owner can delete this room' });
  }

  await destroyGroupChat(gcId);
  res.json({ message: 'Room deleted' });
});

// Rooms the current user is a member of (their permanent, cross-device list).
app.get('/api/myRooms', requireAuth, async (req, res) => {
  try {
    const rooms = await getUserRooms(req.session.userId);
    res.json(rooms);
  } catch (err) {
    console.error('myRooms failed:', err);
    res.status(500).json({ error: 'Failed to load rooms' });
  }
});

// Join a room by code. Idempotent — rejoining a room you left is allowed.
app.post('/api/joinRoom', requireAuth, async (req, res) => {
  const { groupChatId } = req.body || {};
  const idStr = String(groupChatId ?? '').trim();

  if (!/^\d{1,6}$/.test(idStr) || parseInt(idStr, 10) <= 0) {
    return res.status(400).json({ error: 'Invalid room code' });
  }

  const gcId = parseInt(idStr, 10);
  if (!(await validateGCID(gcId))) {
    return res.status(404).json({ error: 'Room not found' });
  }

  await addRoomMember(req.session.userId, gcId);
  res.json({ message: 'Joined room' });
});

// Leave a room. The room is stamped for cleanup once its last member leaves.
app.post('/api/leaveRoom', requireAuth, async (req, res) => {
  const { groupChatId } = req.body || {};
  const idStr = String(groupChatId ?? '').trim();

  if (!/^\d{1,6}$/.test(idStr) || parseInt(idStr, 10) <= 0) {
    return res.status(400).json({ error: 'Invalid room code' });
  }

  const gcId = parseInt(idStr, 10);
  if (!(await validateGCID(gcId))) {
    return res.status(404).json({ error: 'Room not found' });
  }

  await removeRoomMember(req.session.userId, gcId);
  res.json({ message: 'Left room' });
});

const hidden_inventory_key = process.env.GIPHY_API_KEY;

// Fixed /api/searchGifs route
app.get('/api/searchGifs', requireAuth, async (req, res) => {
  const start = performance.now();
  const { query } = req.query;
  try {
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${hidden_inventory_key}&q=${encodeURIComponent(query)}&limit=12&rating=r`;
    const response = await fetch(url);
    const data = await response.json();

    // Return data back to client
    res.json(data);
  } catch (error) {
    console.error("GIPHY error:", error);
    res.status(500).json({ error: "Failed to fetch GIFs" });
  }
  const end = performance.now();
  console.log(`searchGifs took ${end - start} ms`);
});

wss.on('connection', (ws, request) => {
  // The session was resolved in the upgrade handler and stashed on the ws.
  const session = ws.session;
  if (!session) {
    ws.close(1008, 'Authentication required');
    return;
  }
  console.log(`Client connected: ${session.username}`);

  // Listen for messages from this specific client
  ws.on('message', async (message) => {
    // Incoming messages arrive as Buffers; convert to string
    const messageString = message.toString();
    console.log(`Received: ${messageString}`);

    let messageJSON = JSON.parse(messageString);
    let returnJSON = {};
    let {
      type,
      groupChatId = 0,
      messageText = '',
      gifUrl = '',
      fileUrl = null,
      fileName = null,
      fileType = null,
    } = messageJSON;
    // The display name is always the authenticated username — clients cannot
    // spoof another user's identity.
    const displayNameText = session.username;
    if (type === 'ping') {
      returnJSON.type = 'pong';
      ws.send(JSON.stringify(returnJSON));
      return;
    }
    if ((!messageText && !gifUrl && !fileUrl) && messageJSON.type !== 'ping') {
      returnJSON.type = 'error';
      returnJSON.messageText = 'Message is empty';
      ws.send(JSON.stringify(returnJSON));
      return;
    }
    if (messageText.length > MAX_MESSAGE_LENGTH) {
      returnJSON.type = 'error';
      returnJSON.messageText = `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`;
      ws.send(JSON.stringify(returnJSON));
      return;
    }
    // Only accept references to files we actually served from /uploads.
    if (fileUrl && !/^\/uploads\/[A-Za-z0-9._-]+$/.test(fileUrl)) {
      returnJSON.type = 'error';
      returnJSON.messageText = 'Invalid file reference';
      ws.send(JSON.stringify(returnJSON));
      return;
    }
    if (fileUrl) {
      fileName = typeof fileName === 'string' ? fileName.slice(0, 120) : null;
      fileType = typeof fileType === 'string' ? fileType.slice(0, 100) : null;
    } else {
      fileName = null;
      fileType = null;
    }
    if (groupChatId && !(await validateGCID(groupChatId))) {
      returnJSON.type = 'error';
      returnJSON.messageText = 'Invalid group chat ID';
      ws.send(JSON.stringify(returnJSON));
      return;
    }

    console.log("Message: " + messageText, "Display Name: " + displayNameText);

    // Attach the sender's current profile picture so live recipients can render
    // the avatar without another lookup. Stored denormalized on the row too.
    const sender = await db.get('SELECT picture_url FROM users WHERE id = ?', [session.userId]);
    const avatarUrl = sender ? sender.picture_url : null;

    const sqliteTextTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    messageJSON.timestamp = sqliteTextTimestamp;
    messageJSON.type = 'message';
    // Include the authenticated display name so live recipients can render the
    // author. (Clients can't spoof it — displayNameText comes from the session.)
    messageJSON.displayNameText = displayNameText;
    messageJSON.avatarUrl = avatarUrl;
    messageJSON.fileUrl = fileUrl;
    messageJSON.fileName = fileName;
    messageJSON.fileType = fileType;
    await addMessageToTable(
      groupChatId,
      messageText,
      displayNameText,
      gifUrl,
      sqliteTextTimestamp,
      avatarUrl,
      fileUrl,
      fileName,
      fileType
    );
    wss.clients.forEach((client) => {
      // Check if the connection is open before sending
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify(messageJSON));
      }
    });
  });

  // Handle client disconnection
  ws.on('close', () => {
    console.log('Client has disconnected');
  });
});

server.on('upgrade', (request, socket, head) => { //black magic
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }

  // Authenticate the WS handshake via the session cookie. Unauthenticated
  // upgrades are rejected before the connection is established.
  const session = readSession(request);
  if (!session) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    // Stash the resolved session so the connection handler can use it.
    ws.session = session;
    wss.emit('connection', ws, request);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

rl.on('line', async (line) => {
  const input = line.trim();
  const [command, ...args] = input.split(' ');

  switch (command.toLowerCase()) {
    case 'help':
      console.log('Available commands: status, users, create, destroy, stop, db, gcclear');
      break;
    case 'status':
      console.log(`Server status: ONLINE. Connections: ${server.connections ?? 0}`);
      break;
    case 'stop':
      console.log('Shutting down server gracefully...');
      shutdown();
      break;
    case 'create':
      if (args.length < 2) {
        console.log('Usage: create <gc_id> <gc_name>');
      } else {
        const [gc_id, ...gc_name_parts] = args;
        const gc_name = gc_name_parts.join(' ');
        await createGroupChat(gc_id, gc_name);
      }
      break;
    case 'destroy':
      if (args.length < 1) {
        console.log('Usage: destroy <gc_id>');
      } else {
        const [gc_id] = args;
        destroyGroupChat(gc_id);
      }
      break;
    case 'db':
      if (args.length < 1) {
        console.log('Usage: db <query>');
      } else {
        const query = args.join(' ');
        await db.run(query, []);
        console.log('Query executed successfully.');
      }
      break;
    case 'msgclear':
      if (args.length < 1) {
        const query = `DELETE FROM messages`;
        await db.exec(query);
        console.log('Messages table cleared successfully.');
      } else {
        const query = `DELETE FROM messages WHERE group_chat_id = ?; DELETE FROM sqlite_sequence WHERE name='messages';`;
        db.run(query, [args[0]]);
        console.log(`Messages for group chat ID ${args[0]} cleared successfully.`);
      }
      break;
    case 'gcclear':
      await clearAllGroupChats();
      break;
    default:
      console.log(`Unknown command: "${command}". Type "help" for options.`);
      break;
  }
});
