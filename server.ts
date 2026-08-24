import 'dotenv/config';

import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import type { Duplex } from 'stream';

import { openDatabase, deleteEmptyRooms } from './src/server/db';
import { createRealtime, attachMessageHandler } from './src/server/realtime';
import { createRouter } from './src/server/routes';
import { startCli } from './src/server/cli';
import { createGracefulShutdown } from './src/server/shutdown';
import {
  initSessionStore,
  readSession,
  pruneExpiredSessions,
  type Session,
} from './src/server/auth';
import {
  CLEANUP_INTERVAL_MS,
  FRONTEND_ORIGINS,
  isConfiguredFrontendOrigin,
  isAllowedWsOrigin,
  PROJECT_ROOT,
} from './src/server/constants';

const app = express();
// Trust the first reverse proxy so req.secure reflects X-Forwarded-Proto.
// This keeps the session cookie's Secure flag correct behind nginx / load
// balancers / PaaS routers (and prevents it from being forced on over HTTP).
app.set('trust proxy', 1);

// CORS: when the frontend is hosted on a different origin (e.g. Appwrite),
// allow it to call this API and carry the session cookie. When no frontend
// origins are configured this is a no-op (same-origin deployment).
app.use((req: Request, res: Response, next: NextFunction) => {
  if (FRONTEND_ORIGINS.length === 0) return next();

  const origin = req.headers.origin;

  // Echo back the requesting origin only when it's an allowed frontend, since
  // Access-Control-Allow-Credentials can't use a wildcard.
  if (isConfiguredFrontendOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin as string);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    if (!isConfiguredFrontendOrigin(origin)) {
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,POST,PUT,DELETE,OPTIONS'
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] || 'Content-Type'
    );
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
    return;
  }
  next();
});

const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
const SSL_CERT_PATH = process.env.SSL_CERT_PATH;
const useTls = !!(SSL_KEY_PATH && SSL_CERT_PATH);

const server = useTls
  ? https.createServer(
      {
        key: fs.readFileSync(SSL_KEY_PATH!),
        cert: fs.readFileSync(SSL_CERT_PATH!),
      },
      app
    )
  : http.createServer(app);

// Allow base64 data-URL uploads (up to the 2 MB file cap) through the JSON
// body parser.
app.use(express.json({ limit: '5mb' }));

// Serve static files from the React build (production) or fall back to root
// files. Paths resolve against the project root, not this compiled file's
// dist-server/ location.
app.use(express.static(path.join(PROJECT_ROOT, 'dist')));

// Uploaded attachments live on disk (not in the DB) so message history stays
// small and the files can be served directly by the web server. UPLOAD_DIR
// overrides the default (./uploads) so a persistent volume can hold them too
// (e.g. /data/uploads on a Cloud Run FUSE mount).
const UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.join(PROJECT_ROOT, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

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
  // message handler. The db powers member-scoped broadcasts.
  const { wss, broadcast, sendToUser } = createRealtime({ db });
  attachMessageHandler({ wss, db, broadcast });

  // API routes are mounted after the DB is ready.
  app.use('/api', createRouter({ db, broadcast, sendToUser }));

  // Catch any error that escapes a route and respond with JSON (plus a server
  // log) instead of Express's default HTML page, so the client can surface a
  // clean message and operators can see the stack in the logs.
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    console.error(`[server] unhandled error ${req.method} ${req.path}:`, err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  // Authenticate the WS handshake via the session cookie before upgrading.
  server.on('upgrade', async (request, socket: Duplex, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    // Reject cross-origin handshakes from unexpected origins when frontend
    // origins are configured (browsers always send Origin on WS handshakes).
    if (!isAllowedWsOrigin(request.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
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
  const cleanupTimer = setInterval(() => {
    deleteEmptyRooms(db).catch((err) => {
      console.error('Empty-room cleanup failed:', (err as Error).message);
    });
    pruneExpiredSessions().catch((err) => {
      console.error('Session cleanup failed:', (err as Error).message);
    });
  }, CLEANUP_INTERVAL_MS);

  // Graceful shutdown for SIGINT *and* SIGTERM (Docker/K8s send SIGTERM):
  // stop the janitor, drop WS clients, close listeners, then the database.
  const shutdown = createGracefulShutdown({ server, wss, db, cleanupTimer });
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  startCli({ db, server, shutdown });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`Server running on ${useTls ? 'HTTPS' : 'HTTP'} port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
