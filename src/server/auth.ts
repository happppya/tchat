import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import type { DB } from './db';

/**
 * Authentication helpers for the chat server.
 *
 * Passwords are hashed with scrypt (Node's built-in, PBKDF2-grade KDF) using a
 * per-password random salt. Sessions are opaque random tokens stored in SQLite
 * so they survive server restarts.
 */

export interface Session {
  userId: number;
  username: string;
  expires: number;
}

// Make `req.session` available on Express requests once `requireAuth` runs.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: Session;
    }
  }
}

const SCRYPT_KEYLEN = 32; // 256-bit derived key
const SCRYPT_PARAMS = {
  // scrypt cost (N), block size (r), parallelism (p). N=2^15 is OWASP-aligned
  // for interactive logins on modern hardware.
  N: 1 << 15,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024, // 64 MiB upper bound for the KDF
};

// The session store is injected after the database opens (server.ts calls
// initSessionStore). Everything else reads through this module-level handle.
let sessionDb: DB | null = null;

/** Point the session store at the opened database. Must run before any route. */
export function initSessionStore(db: DB): void {
  sessionDb = db;
}

function getSessionDb(): DB {
  if (!sessionDb) {
    throw new Error('Session store not initialized (call initSessionStore(db))');
  }
  return sessionDb;
}

/**
 * Hash a password. Returns "scrypt:N:r:p:saltHex:hashHex" — a self-describing
 * string so the verify path can evolve parameters later.
 */
export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(
      password,
      salt,
      SCRYPT_KEYLEN,
      SCRYPT_PARAMS,
      (err, derivedKey) => {
        if (err) return reject(err);
        const { N, r, p } = SCRYPT_PARAMS;
        resolve(
          `scrypt:${N}:${r}:${p}:${salt.toString('hex')}:${derivedKey.toString(
            'hex'
          )}`
        );
      }
    );
  });
}

/**
 * Verify a password against a stored "scrypt:..." string using a timing-safe
 * comparison.
 */
export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (typeof stored !== 'string') return resolve(false);
    const parts = stored.split(':');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return resolve(false);

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'hex');
    const expected = Buffer.from(parts[5], 'hex');
    if (
      !Number.isFinite(N) ||
      !Number.isFinite(r) ||
      !Number.isFinite(p) ||
      salt.length === 0 ||
      expected.length === 0
    ) {
      return resolve(false);
    }

    crypto.scrypt(
      password,
      salt,
      expected.length,
      { N, r, p, maxmem: SCRYPT_PARAMS.maxmem },
      (err, derivedKey) => {
        if (err) return reject(err);
        resolve(
          derivedKey.length === expected.length &&
            crypto.timingSafeEqual(derivedKey, expected)
        );
      }
    );
  });
}

export const SESSION_COOKIE = 'sid';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Create a new persistent session for a user, returns the opaque token. */
export async function createSession(user: {
  id: number;
  username: string;
}): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const db = getSessionDb();
  await db.run(
    'INSERT INTO sessions (token, user_id, username, expires_at) VALUES (?, ?, ?, ?)',
    [token, user.id, user.username, Date.now() + SESSION_TTL_MS]
  );
  return token;
}

/** Look up a session by token. Returns null if missing/expired. */
async function getSession(token: string | null): Promise<Session | null> {
  if (!token) return null;
  const db = getSessionDb();
  const row = await db.get(
    'SELECT token, user_id, username, expires_at FROM sessions WHERE token = ?',
    [token]
  );
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    await db.run('DELETE FROM sessions WHERE token = ?', [token]);
    return null;
  }
  return { userId: row.user_id, username: row.username, expires: row.expires_at };
}

/** Delete a session (logout). */
export async function destroySession(token: string): Promise<void> {
  const db = getSessionDb();
  await db.run('DELETE FROM sessions WHERE token = ?', [token]);
}

/** Remove expired sessions so the table doesn't grow unbounded. */
export async function pruneExpiredSessions(): Promise<void> {
  const db = getSessionDb();
  await db.run('DELETE FROM sessions WHERE expires_at < ?', [Date.now()]);
}

/** Serialize a token into a Set-Cookie header value. */
export function sessionCookie(
  token: string,
  maxAgeMs: number = SESSION_TTL_MS
): string {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  // Secure only over HTTPS in production; dev runs over plain HTTP.
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  return attrs.join('; ');
}

/** Build a cookie that immediately expires (clears the browser cookie). */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * Read the session token from a request's Cookie header, returning the
 * resolved session object (or null). Works for both Express requests and raw
 * Node IncomingMessage upgrade requests.
 */
export async function readSession(req: {
  headers: { cookie?: string };
}): Promise<Session | null> {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;)\s*sid=([^;]+)/);
  if (!match) return null;
  return getSession(match[1]);
}

/** Express middleware: require an authenticated session, else 401. */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const session = await readSession(req);
  if (!session) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  req.session = session;
  next();
}
