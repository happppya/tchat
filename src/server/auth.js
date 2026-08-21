"use strict";

/**
 * Authentication helpers for the chat server.
 *
 * Passwords are hashed with scrypt (Node's built-in, PBKDF2-grade KDF) using a
 * per-password random salt. Sessions are opaque random tokens kept in an
 * in-memory Map (token -> { userId, username }), cleared on server restart.
 *
 * No external dependencies — only Node's `crypto`.
 */

const crypto = require("crypto");

const SCRYPT_KEYLEN = 32; // 256-bit derived key
const SCRYPT_PARAMS = {
  // scrypt cost (N), block size (r), parallelism (p). N=2^15 is OWASP-aligned
  // for interactive logins on modern hardware.
  N: 1 << 15,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024, // 64 MiB upper bound for the KDF
};

/**
 * Hash a password. Returns "scrypt:N:r:p:saltHex:hashHex" — a self-describing
 * string so the verify path can evolve parameters later.
 */
function hashPassword(password) {
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
          `scrypt:${N}:${r}:${p}:${salt.toString("hex")}:${derivedKey.toString(
            "hex"
          )}`
        );
      }
    );
  });
}

/**
 * Verify a password against a stored "scrypt:..." string. Uses a
 * timing-safe comparison to avoid leaking information about partial matches.
 */
function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    if (typeof stored !== "string") return resolve(false);
    const parts = stored.split(":");
    if (parts.length !== 6 || parts[0] !== "scrypt") return resolve(false);

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], "hex");
    const expected = Buffer.from(parts[5], "hex");
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
        // constant-time compare
        resolve(
          derivedKey.length === expected.length &&
            crypto.timingSafeEqual(derivedKey, expected)
        );
      }
    );
  });
}

/** In-memory session store: token -> session object. */
const sessions = new Map();

const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Create a new session for a user, returns the opaque token string. */
function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    userId: user.id,
    username: user.username,
    expires: Date.now() + SESSION_TTL_MS,
  });
  return token;
}

/** Look up a session by token. Returns null if missing/expired. */
function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.expires) {
    sessions.delete(token);
    return null;
  }
  return s;
}

/** Delete a session (logout). */
function destroySession(token) {
  if (token) sessions.delete(token);
}

/** Serialize a token into a Set-Cookie header value. */
function sessionCookie(token, maxAgeMs = SESSION_TTL_MS) {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  // Secure only over HTTPS in production; dev runs over plain HTTP.
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs.join("; ");
}

/** Build a cookie that immediately expires (clears the browser cookie). */
function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/**
 * Read the session token from the request's Cookie header, returning the
 * resolved session object (or null).
 */
function readSession(req) {
  const cookieHeader = req.headers.cookie || "";
  const match = cookieHeader.match(/(?:^|;)\s*sid=([^;]+)/);
  if (!match) return null;
  return getSession(match[1]);
}

/** Express middleware: require an authenticated session, else 401. */
function requireAuth(req, res, next) {
  const session = readSession(req);
  if (!session) {
    return res.status(401).json({ error: "Authentication required" });
  }
  req.session = session;
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  sessionCookie,
  clearSessionCookie,
  readSession,
  requireAuth,
  SESSION_COOKIE,
};

const SESSION_TTL = SESSION_TTL_MS;
module.exports.SESSION_TTL_MS = SESSION_TTL;
