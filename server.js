const express = require('express');
const http = require('http');
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

app.use(express.json());

// Health check endpoint (no DB dependency, for test/CI readiness)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve static files from the React build (production) or fall back to root files
const path = require('path');
app.use(express.static(path.join(__dirname, 'dist')));

// Also serve root-level legacy HTML files (popup.html for Chrome extension)
app.use(express.static(__dirname));

// SPA fallback: any non-API, non-static route -> dist/index.html
app.get(/^(?!\/api\/|\/ws).*/, (req, res) => {
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
  const user = await db.get('SELECT id, username FROM users WHERE username = ?', [cleanUser]);
  const token = createSession(user);
  res.setHeader('Set-Cookie', sessionCookie(token));
  res.status(201).json({ user: { id: user.id, username: user.username } });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const cleanUser = typeof username === 'string' ? username.trim() : '';
  const cleanPass = typeof password === 'string' ? password : '';

  if (!cleanUser || !cleanPass) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = await db.get('SELECT id, username, password_hash FROM users WHERE username = ?', [cleanUser]);

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
  res.json({ user: { id: user.id, username: user.username } });
});

app.post('/api/logout', (req, res) => {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;)\s*sid=([^;]+)/);
  if (match) destroySession(match[1]);
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: { id: session.userId, username: session.username } });
});

function shutdown() {
  console.log("Closing database...");
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);

async function addMessageToTable(groupChatId, messageText, displayNameText, gifUrl, timestamp) {
  const query = `INSERT INTO messages (group_chat_id, display_name, message_text, gif_url, sent_at) VALUES (?, ?, ?, ?, ?)`;
  await db.run(query, [groupChatId, displayNameText, messageText, gifUrl, timestamp]);
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
    'DELETE FROM group_chats WHERE id = ?',
    [gc_id]
  );

  console.log(`GC destroyed: (ID: ${gc_id})`);
}

async function clearAllGroupChats() {
  await db.run(`DELETE FROM group_chats`);
  await db.run(`DELETE FROM messages`);
  console.log(`All GCs destroyed`);
}

async function validateGCID(gc_id) {
  const query = `SELECT * FROM group_chats WHERE id = ?`;
  const result = await db.get(query, [gc_id]);
  return result !== undefined;
}

app.get('/api/getMessages', requireAuth, async (req, res) => {
  const start = performance.now();
  const { groupChatId, numMessages } = req.query;
  if (numMessages > 100) {
    return res.status(400).json({ error: 'numMessages exceeds 100' });
  }
  if (groupChatId && !(await validateGCID(groupChatId))) {
    return res.status(400).json({ error: 'Invalid group chat ID' });
  }
  // Order newest-first by sent_at, using the autoincrement id as a stable
  // tiebreaker. sent_at has only second precision, so messages sent within the
  // same second would otherwise be returned in an arbitrary order — which
  // scrambles the list once the client reverses it to oldest-first.
  const messages = await db.all(
    'SELECT * FROM messages WHERE group_chat_id = ? ORDER BY sent_at DESC, id DESC LIMIT ?',
    [parseInt(groupChatId), parseInt(numMessages)]
  );
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
    let { type, groupChatId = 0, messageText = '', gifUrl = '' } = messageJSON;
    // The display name is always the authenticated username — clients cannot
    // spoof another user's identity.
    const displayNameText = session.username;
    if (type === 'ping') {
      returnJSON.type = 'pong';
      ws.send(JSON.stringify(returnJSON));
      return;
    }
    if ((!messageText && !gifUrl) && messageJSON.type !== 'ping') {
      returnJSON.type = 'error';
      returnJSON.messageText = 'Message text is blank';
      ws.send(JSON.stringify(returnJSON));
      return;
    }
    if (messageText.length > 300) {
      returnJSON.type = 'error';
      returnJSON.messageText = 'Message too long';
      ws.send(JSON.stringify(returnJSON));
      return;
    }
    if (groupChatId && !(await validateGCID(groupChatId))) {
      returnJSON.type = 'error';
      returnJSON.messageText = 'Invalid group chat ID';
      ws.send(JSON.stringify(returnJSON));
      return;
    }

    console.log("Message: " + messageText, "Display Name: " + displayNameText);

    const sqliteTextTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    messageJSON.timestamp = sqliteTextTimestamp;
    messageJSON.type = 'message';
    // Include the authenticated display name so live recipients can render the
    // author. (Clients can't spoof it — displayNameText comes from the session.)
    messageJSON.displayNameText = displayNameText;
    await addMessageToTable(groupChatId, messageText, displayNameText, gifUrl, sqliteTextTimestamp);
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
