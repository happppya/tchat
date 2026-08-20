const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { WebSocketServer } = require('ws');
const readline = require('readline');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const wss = new WebSocketServer({ noServer: true });
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
let db;

app.use(express.json());

app.get('/', (req, res) => {
  const start = performance.now();
  res.sendFile(__dirname + '/index.html');
  const end = performance.now();
  console.log(`Serving index.html took ${end - start} ms`);
});

app.get('/login', (req, res) => {
  res.sendFile(__dirname + '/login.html');
});

app.get('/signup', (req, res) => {
  res.sendFile(__dirname + '/signup.html');
});

async function initializeAndStore() {
  db = await open({
    filename: './database.db',
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
      id INTEGER PRIMARY KEY,
      display_name TEXT,
      user_name TEXT,
      email TEXT,
      password TEXT
    );
  `);

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

async function createGroupChat(gc_id, gc_name) {
  const query = `INSERT INTO group_chats (id, name) VALUES (?, ?)`;
  await db.run(query, [gc_id, gc_name]);
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

app.get('/api/getMessages', async (req, res) => {
  const start = performance.now();
  const { groupChatId, numMessages } = req.query;
  if (numMessages > 100) {
    return res.status(400).json({ error: 'numMessages exceeds 100' });
  }
  if (groupChatId && !(await validateGCID(groupChatId))) {
    return res.status(400).json({ error: 'Invalid group chat ID' });
  }
  const messages = await db.all(
    'SELECT * FROM messages WHERE group_chat_id = ? ORDER BY sent_at DESC LIMIT ?',
    [parseInt(groupChatId), parseInt(numMessages)]
  );
  const end = performance.now();
  console.log(`getMessages took ${end - start} ms`);
  res.json(messages);
});

app.get('/api/getGCInfo', async (req, res) => {
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

app.post('/api/createGC', async (req, res) => {
  const data = req.body;
  await createGroupChat(data.id, data.name);
  res.status(201).json({ message: 'Group chat created successfully' });
});

const hidden_inventory_key = process.env.GIPHY_API_KEY;

// Fixed /api/searchGifs route
app.get('/api/searchGifs', async (req, res) => {
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

wss.on('connection', (ws) => {
  console.log('New client connected!');

  // Listen for messages from this specific client
  ws.on('message', async (message) => {
    // Incoming messages arrive as Buffers; convert to string
    const messageString = message.toString();
    console.log(`Received: ${messageString}`);

    let messageJSON = JSON.parse(messageString);
    let returnJSON = {};
    let { type, groupChatId = 0, messageText = '', displayNameText = '', gifUrl = '' } = messageJSON;
    if (type === 'ping') {
      returnJSON.type = 'pong';
      ws.send(JSON.stringify(returnJSON));
      return;
    }
    if (((!messageText && !gifUrl) || !displayNameText) && messageJSON.type !== 'ping') {
      returnJSON.type = 'error';
      returnJSON.messageText = 'Either message text or display name is blank';
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

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

server.listen(3000, () => {
  console.log("Server running on port 3000");
});

rl.on('line', async (line) => {
  const input = line.trim();
  const [command, ...args] = input.split(' ');

  switch (command.toLowerCase()) {
    case 'help':
      console.log('Available commands: status, users, create, destroy, stop, db, dbclear, gcclear');
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
