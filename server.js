const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { WebSocketServer } = require('ws');


const app = express();
const server = http.createServer(app);
const io = new Server(server);
const wss = new WebSocketServer({ port: 8080 });
let db;

app.use(express.json());

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

async function initializeAndStore() {
  db = await open({
    filename: './database.db',
    driver: sqlite3.Database
  });
  console.log('Connected to local SQLite file database!');

  // 2. Create a Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      display_name TEXT,
      message_text TEXT,
      sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    // 3. Insert data using parameterized queries to prevent syntax issues
    //const query = `INSERT INTO messages (display_name, message_text, sent_at) VALUES (?, ?, ?)`;
    //await db.run(query, ['Test Name', 'Hello World', '2026-08-13 14:30:00']);
    
    //console.log('Data stored successfully in local file!');

    // 4. Read data back to verify it works
    const messages = await db.all('SELECT * FROM messages');
    console.log('Current messages in file:', messages);

  } catch (error) {
    console.error('Error handling database operations:', error.message);
  } finally {
    // 5. Close connection when done
    await db.exec(`DELETE FROM messages`)
  }
}

initializeAndStore();

function shutdown() {
    console.log("Closing database...");
    db.close();
    process.exit(0);
}
process.on('SIGINT', shutdown)

async function addMessageToTable(messageText, displayNameText, timestamp) {
    const query = `INSERT INTO messages (display_name, message_text, sent_at) VALUES (?, ?, ?)`;
    db.run(query, [displayNameText, messageText, timestamp]);

    const messages = await db.all('SELECT * FROM messages');
    console.log('Current messages in file:', messages);
}



app.post('/api/sendMessage', (req, res) => {
    console.log("send message post received");
    const { messageText, displayNameText } = req.body;
    if (!messageText || !displayNameText) {
        return res.status(400).json({ error: 'Must have display name and a message' });
    }
    if (messageText.length > 300) {
        return res.status(400).json({ error: 'Message exceeds 300 characters' });
    }

    console.log("Message: " + messageText, "Display Name: " + displayNameText);

    const sqliteTextTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    addMessageToTable(messageText, displayNameText, sqliteTextTimestamp);
});

app.get('/api/getMessages', async (req, res) => {
    const { numMessages } = req.query;
    console.log("get messages get received");
    if (numMessages > 100) {
        return res.status(400).json({ error: 'numMessages exceeds 100' });
    }
    const messages = await db.all(
        'SELECT * FROM messages ORDER BY sent_at DESC LIMIT ?',
        [parseInt(numMessages)]
    );
    res.json(messages);
});

wss.on('connection', (ws) => {
  console.log('New client connected!');

  // Listen for messages from this specific client
  ws.on('message', (message) => {
    // Incoming messages arrive as Buffers; convert to string
    const messageString = message.toString();
    console.log(`Received: ${messageString}`);

    console.log("message received and added from WEBSOCKET not from post");
    let messageJSON = JSON.parse(messageString);
    let { messageText, displayNameText } = messageJSON;
    if (!messageText || !displayNameText) {
      messageJSON.type = 'error';
      messageJSON.messageText = 'Either message text or display name is blank';
      ws.send(JSON.stringify(messageJSON));
      return;
    }
    if (messageText.length > 300) {
      messageJSON.type = 'error';
      messageJSON.messageText = 'Message too long';
      ws.send(JSON.stringify(messageJSON));
      return;
    }

    console.log("Message: " + messageText, "Display Name: " + displayNameText);

    const sqliteTextTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    messageJSON.timestamp = sqliteTextTimestamp;
    messageJSON.type = 'message';
    addMessageToTable(messageText, displayNameText, sqliteTextTimestamp);
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

server.listen(3000, () => {
    console.log("Server running on port 3000");
});

