import 'dotenv/config';

import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import type { Duplex } from 'stream';

import { openDatabase, deleteEmptyRooms } from './src/server/db';
import { createRealtime, attachMessageHandler } from './src/server/realtime';
import { createRouter } from './src/server/routes';
import { startCli } from './src/server/cli';
import {
  initSessionStore,
  readSession,
  pruneExpiredSessions,
  type Session,
} from './src/server/auth';
import { CLEANUP_INTERVAL_MS, PROJECT_ROOT } from './src/server/constants';

const app = express();
// Trust the first reverse proxy so req.secure reflects X-Forwarded-Proto.
// This keeps the session cookie's Secure flag correct behind nginx / load
// balancers / PaaS routers (and prevents it from being forced on over HTTP).
app.set('trust proxy', 1);
const server = http.createServer(app);

// Allow base64 data-URL uploads (up to the 2 MB file cap) through the JSON
// body parser.
app.use(express.json({ limit: '5mb' }));

// Serve static files from the React build (production) or fall back to root
// files. Paths resolve against the project root, not this compiled file's
// dist-server/ location.
app.use(express.static(path.join(PROJECT_ROOT, 'dist')));

// Uploaded attachments live on disk (not in the DB) so message history stays
// small and the files can be served directly by the web server.
const UPLOAD_DIR = path.join(PROJECT_ROOT, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// Also serve root-level legacy HTML files (popup.html for Chrome extension).
app.use(express.static(PROJECT_ROOT));

// SPA fallback: any non-API, non-static route -> dist/index.html.
app.get(/^(?!\/api\/|\/ws|\/uploads\/).*/, (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, 'dist', 'index.html'), (err) => {
    if (err) {
      // Fall back to old index.html during development.
      res.sendFile(path.join(PROJECT_ROOT, 'index.html'), (err2) => {
        if (err2) res.status(404).send('Not found');
      });
    }
  });
});

async function main(): Promise<void> {
  const db = await openDatabase(process.env.DATABASE_PATH || './database.db');
  initSessionStore(db);
  console.log('Connected to local SQLite file database!');

  // Real-time layer: one WebSocket server + broadcast shared by routes and the
  // message handler.
  const { wss, broadcast } = createRealtime();
  attachMessageHandler({ wss, db, broadcast });

  // API routes are mounted after the DB is ready.
  app.use('/api', createRouter({ db, broadcast }));

  // Authenticate the WS handshake via the session cookie before upgrading.
  server.on('upgrade', async (request, socket: Duplex, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const session = await readSession(request);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      // Stash the resolved session so the connection handler can use it.
      (ws as typeof ws & { session: Session }).session = session;
      wss.emit('connection', ws, request);
    });
  });

  // Reap fully-empty rooms and expired sessions on a timer. The HTTP server
  // keeps the process alive.
  setInterval(() => {
    deleteEmptyRooms(db).catch((err) => {
      console.error('Empty-room cleanup failed:', (err as Error).message);
    });
    pruneExpiredSessions().catch((err) => {
      console.error('Session cleanup failed:', (err as Error).message);
    });
  }, CLEANUP_INTERVAL_MS);

  function shutdown(): void {
    console.log('Closing database...');
    db.close()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  }
  process.on('SIGINT', shutdown);

  startCli({ db, server, shutdown });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
