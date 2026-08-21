import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import express, { type Router, type Request, type Response } from 'express';
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  sessionCookie,
  clearSessionCookie,
  readSession,
  requireAuth,
} from './auth';
import {
  MAX_GC_ID_DIGITS,
  MAX_MESSAGE_LENGTH,
  MAX_UPLOAD_BYTES,
  PROJECT_ROOT,
} from './constants';
import {
  sqliteNow,
  extensionForMime,
  sanitizeFileName,
  addRoomMember,
  removeRoomMember,
  getUserRooms,
  createGroupChat,
  destroyGroupChat,
  validateGCID,
  getReactionsForMessage,
  attachReactions,
  type DB,
} from './db';

// Uploaded attachments live on disk under the project root.
const UPLOAD_DIR = path.join(PROJECT_ROOT, 'uploads');

/** Validation: 3–30 chars, letters/digits/_/-/. — no spaces or symbols. */
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,30}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

/**
 * Parse + validate a room code (1–6 digits, positive). Returns the numeric id
 * or null. Shared by every room-code endpoint so the rules stay in one place.
 */
function parseRoomCode(value: unknown): number | null {
  const idStr = String(value ?? '').trim();
  if (!/^\d{1,6}$/.test(idStr)) return null;
  const id = parseInt(idStr, 10);
  return id > 0 ? id : null;
}

/** Parse + validate a positive integer message id. Returns null when invalid. */
function parseMessageId(value: unknown): number | null {
  const id = parseInt(String(value ?? ''), 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Build the API router. Mounted at `/api` by server.ts, so route paths here
 * are relative (e.g. `router.get('/health')` serves `/api/health`).
 */
export function createRouter({
  db,
  broadcast,
}: {
  db: DB;
  broadcast: (payload: unknown) => void;
}): Router {
  const router = express.Router();

  // Health check endpoint (no DB dependency, for test/CI readiness).
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  router.post('/signup', async (req: Request, res: Response) => {
    const { username, password } = req.body || {};
    const cleanUser = typeof username === 'string' ? username.trim() : '';
    const cleanPass = typeof password === 'string' ? password : '';

    if (!USERNAME_RE.test(cleanUser)) {
      return res
        .status(400)
        .json({ error: 'Username must be 3–30 chars (letters, digits, _ . -)' });
    }
    if (cleanPass.length < MIN_PASSWORD || cleanPass.length > MAX_PASSWORD) {
      return res
        .status(400)
        .json({ error: `Password must be ${MIN_PASSWORD}–${MAX_PASSWORD} characters` });
    }

    try {
      const hash = await hashPassword(cleanPass);
      await db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [
        cleanUser,
        hash,
      ]);
    } catch (err) {
      if (err && /UNIQUE/i.test(String((err as Error).message))) {
        return res.status(409).json({ error: 'Username already taken' });
      }
      console.error('Signup failed:', err);
      return res.status(500).json({ error: 'Failed to create account' });
    }

    const user = await db.get(
      'SELECT id, username, bio, picture_url FROM users WHERE username = ?',
      [cleanUser]
    );
    const token = await createSession(user);
    res.setHeader('Set-Cookie', sessionCookie(token, { secure: req.secure }));
    res.status(201).json({ user });
  });

  router.post('/login', async (req: Request, res: Response) => {
    const { username, password } = req.body || {};
    const cleanUser = typeof username === 'string' ? username.trim() : '';
    const cleanPass = typeof password === 'string' ? password : '';

    if (!cleanUser || !cleanPass) {
      return res
        .status(400)
        .json({ error: 'Username and password are required' });
    }

    const user = await db.get(
      'SELECT id, username, password_hash, bio, picture_url FROM users WHERE username = ?',
      [cleanUser]
    );

    // Verify even when the user is missing to avoid a timing side-channel that
    // reveals which usernames are registered.
    const dummyHash =
      'scrypt:32768:8:1:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';
    const ok = await verifyPassword(
      cleanPass,
      user ? user.password_hash : dummyHash
    );

    if (!user || !ok) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = await createSession(user);
    res.setHeader('Set-Cookie', sessionCookie(token, { secure: req.secure }));
    res.json({
      user: {
        id: user.id,
        username: user.username,
        bio: user.bio,
        picture_url: user.picture_url,
      },
    });
  });

  router.post('/logout', async (req: Request, res: Response) => {
    const cookieHeader = req.headers.cookie || '';
    const match = cookieHeader.match(/(?:^|;)\s*sid=([^;]+)/);
    if (match) await destroySession(match[1]);
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ ok: true });
  });

  router.get('/me', async (req: Request, res: Response) => {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    const user = await db.get(
      'SELECT id, username, bio, picture_url FROM users WHERE id = ?',
      [session.userId]
    );
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ user });
  });

  // -------------------------------------------------------------------------
  // Profiles
  // -------------------------------------------------------------------------

  router.get('/profile/:username', requireAuth, async (req: Request, res: Response) => {
    const username =
      typeof req.params.username === 'string' ? req.params.username.trim() : '';
    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const user = await db.get(
      'SELECT username, bio, picture_url FROM users WHERE username = ?',
      [username]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  });

  router.put('/profile', requireAuth, async (req: Request, res: Response) => {
    const { bio, pictureUrl } = req.body || {};
    const cleanBio = typeof bio === 'string' ? bio.trim() : '';
    const cleanPicture = typeof pictureUrl === 'string' ? pictureUrl.trim() : '';

    if (cleanBio.length > 500) {
      return res
        .status(400)
        .json({ error: 'Bio must be 500 characters or fewer' });
    }
    if (cleanPicture.length > 2000) {
      return res.status(400).json({ error: 'Picture URL is too long' });
    }
    if (cleanPicture && !/^(https?:\/\/|data:image\/)/i.test(cleanPicture)) {
      return res
        .status(400)
        .json({ error: 'Picture must be an image URL (http(s) or data:image)' });
    }

    await db.run('UPDATE users SET bio = ?, picture_url = ? WHERE id = ?', [
      cleanBio,
      cleanPicture || null,
      req.session!.userId,
    ]);
    const user = await db.get(
      'SELECT id, username, bio, picture_url FROM users WHERE id = ?',
      [req.session!.userId]
    );
    res.json({ user });
  });

  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------

  router.post('/createGC', requireAuth, async (req: Request, res: Response) => {
    const { id, name, isPublic } = req.body || {};
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const publicFlag = isPublic === true ? 1 : 0;
    const gcId = parseRoomCode(id);

    if (!gcId) {
      return res
        .status(400)
        .json({ error: `Room code must be 1–${MAX_GC_ID_DIGITS} digits` });
    }
    if (!cleanName) {
      return res.status(400).json({ error: 'Room name is required' });
    }

    try {
      const existing = await db.get('SELECT id FROM group_chats WHERE id = ?', [
        gcId,
      ]);
      if (existing) {
        return res
          .status(409)
          .json({ error: 'A room with this code already exists' });
      }

      await createGroupChat(db, gcId, cleanName, req.session!.userId, publicFlag);
      await addRoomMember(db, req.session!.userId, gcId);
      res.status(201).json({ message: 'Group chat created successfully' });
    } catch (err) {
      if (/UNIQUE/i.test(String((err as Error).message))) {
        return res
          .status(409)
          .json({ error: 'A room with this code already exists' });
      }
      console.error('Create GC failed:', err);
      res.status(500).json({ error: 'Failed to create group chat' });
    }
  });

  router.get('/getGCInfo', requireAuth, async (req: Request, res: Response) => {
    const start = performance.now();
    const { groupChatId } = req.query;

    if (!groupChatId) {
      return res.status(400).json({ error: 'Missing group chat ID' });
    }
    const gcId = Number(groupChatId);
    if (!(await validateGCID(db, gcId))) {
      return res.status(400).json({ error: 'Invalid group chat ID' });
    }

    const groupChat = await db.get('SELECT * FROM group_chats WHERE id = ?', [
      gcId,
    ]);
    const end = performance.now();
    console.log(`getGCInfo took ${end - start} ms`);
    res.json(groupChat);
  });

  router.delete('/deleteGC', requireAuth, async (req: Request, res: Response) => {
    const { groupChatId } = req.body || {};
    const gcId = parseRoomCode(groupChatId);

    if (!gcId) {
      return res.status(400).json({ error: 'Invalid room code' });
    }

    const groupChat = await db.get('SELECT * FROM group_chats WHERE id = ?', [
      gcId,
    ]);
    if (!groupChat) {
      return res.status(404).json({ error: 'Room not found' });
    }
    if (groupChat.owner_user_id !== req.session!.userId) {
      return res
        .status(403)
        .json({ error: 'Only the room owner can delete this room' });
    }

    await destroyGroupChat(db, gcId);
    res.json({ message: 'Room deleted' });
  });

  // Discoverable rooms: only public rooms are listed here, so private rooms
  // stay reachable solely by their numeric code.
  router.get('/publicRooms', requireAuth, async (_req: Request, res: Response) => {
    try {
      const rooms = await db.all(
        'SELECT id, name, is_public FROM group_chats WHERE is_public = 1 ORDER BY id'
      );
      res.json(rooms);
    } catch (err) {
      console.error('publicRooms failed:', err);
      res.status(500).json({ error: 'Failed to load public rooms' });
    }
  });

  router.get('/myRooms', requireAuth, async (req: Request, res: Response) => {
    try {
      const rooms = await getUserRooms(db, req.session!.userId);
      res.json(rooms);
    } catch (err) {
      console.error('myRooms failed:', err);
      res.status(500).json({ error: 'Failed to load rooms' });
    }
  });

  router.post('/joinRoom', requireAuth, async (req: Request, res: Response) => {
    const { groupChatId } = req.body || {};
    const gcId = parseRoomCode(groupChatId);

    if (!gcId) {
      return res.status(400).json({ error: 'Invalid room code' });
    }
    if (!(await validateGCID(db, gcId))) {
      return res.status(404).json({ error: 'Room not found' });
    }

    await addRoomMember(db, req.session!.userId, gcId);
    res.json({ message: 'Joined room' });
  });

  router.post('/leaveRoom', requireAuth, async (req: Request, res: Response) => {
    const { groupChatId } = req.body || {};
    const gcId = parseRoomCode(groupChatId);

    if (!gcId) {
      return res.status(400).json({ error: 'Invalid room code' });
    }
    if (!(await validateGCID(db, gcId))) {
      return res.status(404).json({ error: 'Room not found' });
    }

    await removeRoomMember(db, req.session!.userId, gcId);
    res.json({ message: 'Left room' });
  });

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  router.get('/getMessages', requireAuth, async (req: Request, res: Response) => {
    const start = performance.now();
    const { groupChatId, limit: rawLimit, numMessages, beforeSentAt, beforeId } =
      req.query;

    // Pagination is cursor-based (keyset), not OFFSET-based.
    const requested = rawLimit ?? numMessages;
    const limit = Math.min(
      Math.max(parseInt(String(requested ?? '50'), 10) || 50, 1),
      100
    );

    const gcId = Number(groupChatId);
    if (groupChatId && !(await validateGCID(db, gcId))) {
      return res.status(400).json({ error: 'Invalid group chat ID' });
    }

    const hasBefore = beforeSentAt !== undefined || beforeId !== undefined;
    if (hasBefore && (!beforeSentAt || !beforeId)) {
      return res
        .status(400)
        .json({ error: 'beforeSentAt and beforeId must be provided together' });
    }

    let messages: any[];
    if (beforeSentAt && beforeId) {
      messages = await db.all(
        `SELECT * FROM messages
         WHERE group_chat_id = ?
           AND (sent_at < ? OR (sent_at = ? AND id < ?))
         ORDER BY sent_at DESC, id DESC
         LIMIT ?`,
        [gcId, String(beforeSentAt), String(beforeSentAt), Number(beforeId), limit]
      );
    } else {
      messages = await db.all(
        'SELECT * FROM messages WHERE group_chat_id = ? ORDER BY sent_at DESC, id DESC LIMIT ?',
        [gcId, limit]
      );
    }

    const end = performance.now();
    console.log(`getMessages took ${end - start} ms`);

    await attachReactions(db, messages, req.session!.userId);
    res.json(messages);
  });

  router.put('/editMessage', requireAuth, async (req: Request, res: Response) => {
    const { messageId, messageText } = req.body || {};
    const id = parseMessageId(messageId);
    const cleanText = typeof messageText === 'string' ? messageText.trim() : '';

    if (!id) {
      return res.status(400).json({ error: 'Invalid message id' });
    }
    if (cleanText.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`,
      });
    }

    const existing = await db.get('SELECT * FROM messages WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (existing.user_id !== req.session!.userId) {
      return res
        .status(403)
        .json({ error: 'You can only edit your own messages' });
    }
    if (!cleanText && !existing.gif_url && !existing.file_url) {
      return res.status(400).json({ error: 'Message is empty' });
    }

    const editedAt = sqliteNow();
    await db.run(
      'UPDATE messages SET message_text = ?, edited_at = ? WHERE id = ?',
      [cleanText, editedAt, id]
    );
    const updated = await db.get('SELECT * FROM messages WHERE id = ?', [id]);

    broadcast({
      type: 'editMessage',
      groupChatId: existing.group_chat_id,
      messageId: id,
      messageText: cleanText,
      editedAt,
    });

    res.json(updated);
  });

  router.delete('/deleteMessage', requireAuth, async (req: Request, res: Response) => {
    const { messageId } = req.body || {};
    const id = parseMessageId(messageId);

    if (!id) {
      return res.status(400).json({ error: 'Invalid message id' });
    }

    const existing = await db.get('SELECT * FROM messages WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (existing.user_id !== req.session!.userId) {
      return res
        .status(403)
        .json({ error: 'You can only delete your own messages' });
    }

    await db.run('DELETE FROM messages WHERE id = ?', [id]);
    await db.run('DELETE FROM message_reactions WHERE message_id = ?', [id]);

    broadcast({
      type: 'deleteMessage',
      groupChatId: existing.group_chat_id,
      messageId: id,
    });

    res.json({ message: 'Message deleted' });
  });

  router.post('/reactToMessage', requireAuth, async (req: Request, res: Response) => {
    const { messageId, emoji } = req.body || {};
    const id = parseMessageId(messageId);
    const cleanEmoji = typeof emoji === 'string' ? emoji.trim() : '';

    if (!id) {
      return res.status(400).json({ error: 'Invalid message id' });
    }
    if (!cleanEmoji || cleanEmoji.length > 32) {
      return res.status(400).json({ error: 'Invalid emoji' });
    }

    const existing = await db.get('SELECT * FROM messages WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Message not found' });
    }

    const current = await db.get(
      'SELECT 1 AS present FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
      [id, req.session!.userId, cleanEmoji]
    );
    if (current) {
      await db.run(
        'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
        [id, req.session!.userId, cleanEmoji]
      );
    } else {
      await db.run(
        'INSERT INTO message_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)',
        [id, req.session!.userId, cleanEmoji, sqliteNow()]
      );
    }

    const reactions = await getReactionsForMessage(db, id, req.session!.userId);
    broadcast({
      type: 'messageReactions',
      groupChatId: existing.group_chat_id,
      messageId: id,
      reactions,
    });
    res.json({ reactions });
  });

  // -------------------------------------------------------------------------
  // Files + GIFs
  // -------------------------------------------------------------------------

  router.post('/upload', requireAuth, async (req: Request, res: Response) => {
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

    const storedName =
      crypto.randomBytes(12).toString('hex') + extensionForMime(mime);
    try {
      await fs.promises.writeFile(path.join(UPLOAD_DIR, storedName), buffer);
    } catch (err) {
      console.error('Upload write failed:', (err as Error).message);
      return res.status(500).json({ error: 'Failed to store file' });
    }

    res.status(201).json({
      url: `/uploads/${storedName}`,
      fileName: sanitizeFileName(fileName) || storedName,
      fileType: mime,
      size: buffer.length,
    });
  });

  const giphyApiKey = process.env.GIPHY_API_KEY;

  router.get('/searchGifs', requireAuth, async (req: Request, res: Response) => {
    const start = performance.now();
    const { query } = req.query;
    try {
      const url = `https://api.giphy.com/v1/gifs/search?api_key=${giphyApiKey}&q=${encodeURIComponent(
        String(query ?? '')
      )}&limit=12&rating=r`;
      const response = await fetch(url);
      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error('GIPHY error:', error);
      res.status(500).json({ error: 'Failed to fetch GIFs' });
    }
    const end = performance.now();
    console.log(`searchGifs took ${end - start} ms`);
  });

  return router;
}
