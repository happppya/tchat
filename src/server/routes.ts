import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import express, { type Router, type Request, type Response, type NextFunction } from 'express';
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
import { authLimiter, uploadLimiter, gifLimiter } from './rateLimit';
import {
  ALLOWED_UPLOAD_MIMES,
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
  isRoomMember,
  isSiteAdmin,
  isRoomOwner,
  isRoomStaffOrAdmin,
  isRoomBanned,
  isRoomMuted,
  isRoomMod,
  roomIsAnonymous,
  getAnonName,
  createGroupChat,
  destroyGroupChat,
  validateGCID,
  getReactionsForMessage,
  attachReactions,
  getBoardGroups,
  createBoardGroup,
  renameBoardGroup,
  deleteBoardGroup,
  addRoomToBoardGroup,
  removeRoomFromBoardGroup,
  reorderBoardGroups,
  reorderBoardGroupRooms,
  type DB,
} from './db';

// Uploaded attachments live on disk under the project root.
const UPLOAD_DIR = path.join(PROJECT_ROOT, 'uploads');

/** Validation: 3–30 chars, letters/digits/_/-/. — no spaces or symbols. */
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,30}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

/**
 * Parse + validate a room code (0–6 digits, non-negative). Returns the numeric id
 * or null. Shared by every room-code endpoint so the rules stay in one place.
 */
function parseRoomCode(value: unknown): number | null {
  const idStr = String(value ?? '').trim();
  if (!/^\d{1,6}$/.test(idStr)) return null;
  const id = parseInt(idStr, 10);
  return id >= 0 ? id : null;
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
  sendToUser,
}: {
  db: DB;
  broadcast: (payload: unknown, groupChatId?: number | null) => void;
  sendToUser: (userId: number, payload: unknown) => void;
}): Router {
  const router = express.Router();

  // Health check endpoint (no DB dependency, for test/CI readiness).
  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  router.post('/signup', authLimiter, async (req: Request, res: Response) => {
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
      const user = await db.get(
        'SELECT id, username, is_admin, bio, picture_url FROM users WHERE username = ?',
        [cleanUser]
      );
      if (!user) {
        throw new Error('Inserted user not found on read-back');
      }
      const token = await createSession({ ...user, isAdmin: !!user.is_admin });
      res.setHeader('Set-Cookie', sessionCookie(token, { secure: req.secure }));

      // Every new user starts in Room 0.
      await addRoomMember(db, user.id, 0);

      console.log(`[auth] signup ok: ${user.username} (id ${user.id})`);
      res.status(201).json({
        user: { ...user, isAdmin: !!user.is_admin },
      });
    } catch (err) {
      if (err && /UNIQUE/i.test(String((err as Error).message))) {
        return res.status(409).json({ error: 'Username already taken' });
      }
      console.error('[auth] signup failed:', err);
      res.status(500).json({ error: 'Failed to create account' });
    }
  });

  router.post('/login', authLimiter, async (req: Request, res: Response) => {
    const { username, password } = req.body || {};
    const cleanUser = typeof username === 'string' ? username.trim() : '';
    const cleanPass = typeof password === 'string' ? password : '';

    if (!cleanUser || !cleanPass) {
      return res
        .status(400)
        .json({ error: 'Username and password are required' });
    }

    try {
      const user = await db.get(
        'SELECT id, username, password_hash, is_admin, bio, picture_url FROM users WHERE username = ?',
        [cleanUser]
      );

      // Verify even when the user is missing to avoid a timing side-channel
      // that reveals which usernames are registered.
      const dummyHash =
        'scrypt:32768:8:1:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000';
      const ok = await verifyPassword(
        cleanPass,
        user ? user.password_hash : dummyHash
      );

      if (!user || !ok) {
        console.log(`[auth] login denied: ${cleanUser}`);
        return res.status(401).json({ error: 'Invalid username or password' });
      }

      const token = await createSession({ ...user, isAdmin: !!user.is_admin });
      res.setHeader('Set-Cookie', sessionCookie(token, { secure: req.secure }));

      // Ensure the user is in Room 0 (lobby). Idempotent.
      await addRoomMember(db, user.id, 0);

      console.log(`[auth] login ok: ${user.username} (id ${user.id})`);
      res.json({
        user: {
          id: user.id,
          username: user.username,
          isAdmin: !!user.is_admin,
          bio: user.bio,
          picture_url: user.picture_url,
        },
      });
    } catch (err) {
      console.error('[auth] login failed:', err);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  router.post('/logout', async (req: Request, res: Response) => {
    const cookieHeader = req.headers.cookie || '';
    const match = cookieHeader.match(/(?:^|;)\s*sid=([^;]+)/);
    if (match) await destroySession(match[1]);
    res.setHeader('Set-Cookie', clearSessionCookie(req.secure));
    res.json({ ok: true });
  });

  router.get('/me', async (req: Request, res: Response) => {
    const session = await readSession(req);
    if (!session) return res.status(401).json({ error: 'Not authenticated' });
    const user = await db.get(
      'SELECT id, username, is_admin, bio, picture_url FROM users WHERE id = ?',
      [session.userId]
    );
    if (!user) return res.status(401).json({ error: 'Not authenticated' });
    res.json({
      user: { ...user, isAdmin: !!user.is_admin },
    });
  });

  // -------------------------------------------------------------------------
  // Profiles
  // -------------------------------------------------------------------------

  router.get('/profile/:username', requireAuth, async (req: Request, res: Response) => {
    const username =
      typeof req.params.username === 'string' ? req.params.username.trim() : '';
    const { groupChatId } = req.query;
    const gcId = groupChatId ? parseRoomCode(groupChatId) : null;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const user = await db.get(
      'SELECT id, username, is_admin, bio, picture_url FROM users WHERE username = ?',
      [username]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    let owner = false;
    if (gcId !== null) {
      owner = await isRoomOwner(db, user.id, gcId);
    }

    res.json({
      username: user.username,
      bio: user.bio,
      picture_url: user.picture_url,
      isAdmin: !!user.is_admin,
      isRoomOwner: owner,
    });
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
    // Only site admins may create rooms.
    const admin = await isSiteAdmin(db, req.session!.userId);
    if (!admin) {
      return res.status(403).json({ error: 'Only admins can create rooms' });
    }

    const { id, name, isHidden, password, isReadonly, isAnonymous, isTransparent, isPublic } =
      req.body || {};
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const gcId = parseRoomCode(id);

    if (gcId === null) {
      return res
        .status(400)
        .json({ error: `Room code must be 1–${MAX_GC_ID_DIGITS} digits` });
    }
    if (gcId === 0) {
      return res.status(400).json({ error: 'Room 0 is reserved' });
    }
    if (!cleanName) {
      return res.status(400).json({ error: 'Room name is required' });
    }

    // Hidden rooms need a password (>8 chars). Hash and store it.
    let passwordHash: string | null = null;
    if (isHidden) {
      const pass = typeof password === 'string' ? password : '';
      if (pass.length < 9) {
        return res
          .status(400)
          .json({ error: 'Hidden rooms require a password (>8 characters)' });
      }
      passwordHash = await hashPassword(pass);
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

      await createGroupChat(
        db,
        gcId,
        cleanName,
        req.session!.userId,
        isHidden ? 1 : 0,
        passwordHash,
        isReadonly ? 1 : 0,
        isAnonymous ? 1 : 0,
        isTransparent ? 1 : 0,
        isPublic ? 1 : 0
      );
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
    // Room contents are for members only — knowing the numeric code is not
    // enough to read a room you haven't joined. Room 0 (lobby) is the
    // exception: any authenticated user can see it.
    if (gcId !== 0 && !(await isRoomMember(db, req.session!.userId, gcId))) {
      return res
        .status(403)
        .json({ error: 'You are not a member of this room' });
    }

    const groupChat = await db.get('SELECT * FROM group_chats WHERE id = ?', [
      gcId,
    ]);
    // Strip the password hash from non-admin responses.
    const isAdmin = await isSiteAdmin(db, req.session!.userId);
    const isStaff = await isRoomStaffOrAdmin(db, req.session!.userId, gcId);
    if (!isAdmin && groupChat) {
      delete (groupChat as Record<string, unknown>).password_hash;
    }
    const result = { ...groupChat, viewer_is_staff: isStaff };
    const end = performance.now();
    console.log(`getGCInfo took ${end - start} ms`);
    res.json(result);
  });

  router.delete('/deleteGC', requireAuth, async (req: Request, res: Response) => {
    const { groupChatId } = req.body || {};
    const gcId = parseRoomCode(groupChatId);

    if (gcId === null) {
      return res.status(400).json({ error: 'Invalid room code' });
    }
    if (gcId === 0) {
      // Only site admins may delete Room 0.
      const isAdmin = await isSiteAdmin(db, req.session!.userId);
      if (!isAdmin) {
        return res.status(403).json({ error: 'Room 0 cannot be deleted' });
      }
    }

    const groupChat = await db.get('SELECT * FROM group_chats WHERE id = ?', [
      gcId,
    ]);
    if (!groupChat) {
      return res.status(404).json({ error: 'Room not found' });
    }
    // Admins or the room owner can delete the room.
    const isAdmin = await isSiteAdmin(db, req.session!.userId);
    if (!isAdmin && groupChat.owner_user_id !== req.session!.userId) {
      return res
        .status(403)
        .json({ error: 'Only the room owner or an admin can delete this room' });
    }

    await destroyGroupChat(db, gcId);
    // Tell every connected client this room is gone so they can clean up.
    broadcast({ type: 'deleteRoom', groupChatId: gcId });
    res.json({ message: 'Room deleted' });
  });

  router.put('/renameRoom', requireAuth, async (req: Request, res: Response) => {
    const { groupChatId, name } = req.body || {};
    const gcId = parseRoomCode(groupChatId);
    const cleanName = typeof name === 'string' ? name.trim() : '';

    if (gcId === null) {
      return res.status(400).json({ error: 'Invalid room code' });
    }
    if (!cleanName) {
      return res.status(400).json({ error: 'Room name is required' });
    }

    const groupChat = await db.get('SELECT * FROM group_chats WHERE id = ?', [gcId]);
    if (!groupChat) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Admins can rename any room; room owners can rename their own.
    const isAdmin = await isSiteAdmin(db, req.session!.userId);
    if (!isAdmin && groupChat.owner_user_id !== req.session!.userId) {
      return res
        .status(403)
        .json({ error: 'Only the room owner or an admin can rename this room' });
    }

    await db.run('UPDATE group_chats SET name = ? WHERE id = ?', [cleanName, gcId]);
    broadcast({ type: 'renameRoom', groupChatId: gcId, name: cleanName });
    res.json({ name: cleanName });
  });

  // Board: rooms marked public (is_public = 1). Code-only rooms stay code-access-only.
  router.get('/publicRooms', requireAuth, async (_req: Request, res: Response) => {
    try {
      const rooms = await db.all(
        'SELECT id, name, is_hidden, is_readonly, is_anonymous, is_transparent, is_public FROM group_chats WHERE is_public = 1 ORDER BY id'
      );
      res.json(rooms);
    } catch (err) {
      console.error('publicRooms failed:', err);
      res.status(500).json({ error: 'Failed to load public rooms' });
    }
  });

  // Board groups — anyone can read, only admins can mutate.

  /** Middleware that rejects non-admin requests for board group mutations. */
  const requireBoardAdmin = async (req: Request, res: Response, next: NextFunction) => {
    if (!(await isSiteAdmin(db, req.session!.userId))) {
      return res.status(403).json({ error: 'Only admins can manage board groups' });
    }
    next();
  };

  router.get('/boardGroups', requireAuth, async (_req: Request, res: Response) => {
    try {
      const groups = await getBoardGroups(db);
      res.json(groups);
    } catch (err) {
      console.error('boardGroups failed:', err);
      res.status(500).json({ error: 'Failed to load board groups' });
    }
  });

  router.post('/boardGroups', requireAuth, requireBoardAdmin, async (req: Request, res: Response) => {
    const { name } = req.body || {};
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (!cleanName) {
      return res.status(400).json({ error: 'Group name is required' });
    }
    try {
      const id = await createBoardGroup(db, cleanName);
      res.status(201).json({ id, name: cleanName, roomIds: [], position: 0 });
    } catch (err) {
      console.error('createBoardGroup failed:', err);
      res.status(500).json({ error: 'Failed to create board group' });
    }
  });

  router.put('/boardGroups/:id', requireAuth, requireBoardAdmin, async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid group id' });
    }
    const { name } = req.body || {};
    if (typeof name === 'string' && name.trim()) {
      await renameBoardGroup(db, id, name.trim());
    }
    res.json({ ok: true });
  });

  router.delete('/boardGroups/:id', requireAuth, requireBoardAdmin, async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid group id' });
    }
    await deleteBoardGroup(db, id);
    res.json({ ok: true });
  });

  router.post('/boardGroups/reorder', requireAuth, requireBoardAdmin, async (req: Request, res: Response) => {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.every((i: unknown) => typeof i === 'number')) {
      return res.status(400).json({ error: 'ids must be an array of numbers' });
    }
    await reorderBoardGroups(db, ids);
    res.json({ ok: true });
  });

  router.post('/boardGroups/:id/rooms', requireAuth, requireBoardAdmin, async (req: Request, res: Response) => {
    const groupId = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(groupId) || groupId < 1) {
      return res.status(400).json({ error: 'Invalid group id' });
    }
    const { roomId } = req.body || {};
    if (typeof roomId !== 'number') {
      return res.status(400).json({ error: 'roomId is required' });
    }
    await addRoomToBoardGroup(db, groupId, roomId);
    res.json({ ok: true });
  });

  router.delete('/boardGroups/rooms/:roomId', requireAuth, requireBoardAdmin, async (req: Request, res: Response) => {
    const roomId = parseInt(String(req.params.roomId), 10);
    if (!Number.isInteger(roomId) || roomId < 1) {
      return res.status(400).json({ error: 'Invalid room id' });
    }
    await removeRoomFromBoardGroup(db, roomId);
    res.json({ ok: true });
  });

  router.post('/boardGroups/:id/reorder-rooms', requireAuth, requireBoardAdmin, async (req: Request, res: Response) => {
    const groupId = parseInt(String(req.params.id), 10);
    if (!Number.isInteger(groupId) || groupId < 1) {
      return res.status(400).json({ error: 'Invalid group id' });
    }
    const { roomIds } = req.body || {};
    if (!Array.isArray(roomIds) || !roomIds.every((i: unknown) => typeof i === 'number')) {
      return res.status(400).json({ error: 'roomIds must be an array of numbers' });
    }
    await reorderBoardGroupRooms(db, groupId, roomIds);
    res.json({ ok: true });
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
    const { groupChatId, password } = req.body || {};
    const gcId = parseRoomCode(groupChatId);

    if (gcId === null) {
      return res.status(400).json({ error: 'Invalid room code' });
    }

    const groupChat = await db.get(
      'SELECT * FROM group_chats WHERE id = ?',
      [gcId]
    );
    if (!groupChat) {
      return res.status(404).json({ error: 'Room not found' });
    }

    // Site admins bypass ban and password checks.
    const isAdmin = await isSiteAdmin(db, req.session!.userId);

    // Ban check (admins immune).
    if (!isAdmin && (await isRoomBanned(db, req.session!.userId, gcId))) {
      return res.status(403).json({ error: 'You are banned from this room' });
    }

    // Hidden rooms require the password — but only for first join.
    const alreadyMember = await isRoomMember(db, req.session!.userId, gcId);
    if (groupChat.is_hidden && groupChat.password_hash && !isAdmin && !alreadyMember) {
      const pass = typeof password === 'string' ? password : '';
      const ok = await verifyPassword(pass, groupChat.password_hash);
      if (!ok) {
        return res.status(403).json({ error: 'Invalid room password' });
      }
    }

    await addRoomMember(db, req.session!.userId, gcId);

    // Anonymous rooms: assign a stable per-user-per-room name.
    let anonName: string | null = null;
    if (groupChat.is_anonymous && !isAdmin) {
      anonName = await getAnonName(db, req.session!.userId, gcId);
    }

    res.json({ message: 'Joined room', anonName });
  });

  router.post('/leaveRoom', requireAuth, async (req: Request, res: Response) => {
    const { groupChatId } = req.body || {};
    const gcId = parseRoomCode(groupChatId);

    if (gcId === null) {
      return res.status(400).json({ error: 'Invalid room code' });
    }
    if (gcId === 0) {
      return res.status(403).json({ error: 'Cannot leave Room 0 (the lobby)' });
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
    // Same membership rule as getGCInfo: history is members-only, except
    // Room 0 which is public to any authenticated user.
    if (
      groupChatId &&
      gcId !== 0 &&
      !(await isRoomMember(db, req.session!.userId, gcId))
    ) {
      return res
        .status(403)
        .json({ error: 'You are not a member of this room' });
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

    // In anonymous rooms, strip user_id from messages for non-admin clients.
    // Admins get the real username for each message so mod actions work.
    const anon = groupChatId ? await roomIsAnonymous(db, gcId) : false;
    const viewerIsAdmin = groupChatId
      ? await isSiteAdmin(db, req.session!.userId)
      : false;
    if (anon) {
      if (viewerIsAdmin) {
        // Join real usernames onto each message for admin mod actions.
        const userIds = [...new Set(messages.map((m) => m.user_id).filter(Boolean))];
        if (userIds.length > 0) {
          const placeholders = userIds.map(() => '?').join(',');
          const users = await db.all(
            `SELECT id, username FROM users WHERE id IN (${placeholders})`,
            userIds
          );
          const map = new Map(users.map((u) => [u.id, u.username]));
          for (const m of messages) {
            m.username = m.user_id ? (map.get(m.user_id) ?? null) : null;
          }
        }
      } else {
        for (const m of messages) {
          m.user_id = null;
        }
      }
    }

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
      // Admins can edit any message.
      if (!(await isSiteAdmin(db, req.session!.userId))) {
        return res
          .status(403)
          .json({ error: 'You can only edit your own messages' });
      }
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

    broadcast(
      {
        type: 'editMessage',
        groupChatId: existing.group_chat_id,
        messageId: id,
        messageText: cleanText,
        editedAt,
      },
      existing.group_chat_id
    );

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
      // Admins can delete any message, including from other admins.
      if (!(await isSiteAdmin(db, req.session!.userId))) {
        return res
          .status(403)
          .json({ error: 'You can only delete your own messages' });
      }
    }

    await db.run('DELETE FROM messages WHERE id = ?', [id]);
    await db.run('DELETE FROM message_reactions WHERE message_id = ?', [id]);

    broadcast(
      {
        type: 'deleteMessage',
        groupChatId: existing.group_chat_id,
        messageId: id,
      },
      existing.group_chat_id
    );

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
    // Reacting mutates shared room state, so it requires membership too.
    if (!(await isRoomMember(db, req.session!.userId, existing.group_chat_id))) {
      return res
        .status(403)
        .json({ error: 'You are not a member of this room' });
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
    broadcast(
      {
        type: 'messageReactions',
        groupChatId: existing.group_chat_id,
        messageId: id,
        reactions,
      },
      existing.group_chat_id
    );
    res.json({ reactions });
  });

  // -------------------------------------------------------------------------
  // Room commands (slash-command endpoint)
  // -------------------------------------------------------------------------

  router.post('/roomCommand', requireAuth, async (req: Request, res: Response) => {
    const { groupChatId, command, targetUsername } = req.body || {};
    const gcId = parseRoomCode(groupChatId);
    const cmd = typeof command === 'string' ? command.trim().toLowerCase() : '';
    const target = typeof targetUsername === 'string' ? targetUsername.trim() : '';

    if (gcId === null) return res.status(400).json({ error: 'Invalid room code' });
    if (gcId === 0) return res.status(403).json({ error: 'Moderation commands are disabled in Room 0' });
    if (!cmd) return res.status(400).json({ error: 'Command is required' });

    const actorId = req.session!.userId;
    const isAdmin = await isSiteAdmin(db, actorId);
    const isStaff = await isRoomStaffOrAdmin(db, actorId, gcId);

    // Resolve the target user by username.
    let targetId: number | null = null;
    if (target) {
      const targetRow = await db.get(
        'SELECT id, is_admin FROM users WHERE username = ?',
        [target]
      );
      if (!targetRow) {
        return res.status(404).json({ error: `User "${target}" not found` });
      }
      // No one can act on an admin.
      if (targetRow.is_admin && !isAdmin) {
        return res
          .status(403)
          .json({ error: 'Cannot act on a site admin' });
      }
      targetId = targetRow.id;
    }

    if (
      ['kick', 'ban', 'unban', 'mute', 'unmute'].includes(cmd) &&
      !isStaff
    ) {
      return res
        .status(403)
        .json({ error: 'Only room staff or admins can use this command' });
    }

    if (['mod', 'demod'].includes(cmd)) {
      // Room owners and admins can promote/demote moderators.
      if (!isAdmin && !(await isRoomOwner(db, actorId, gcId))) {
        return res
          .status(403)
          .json({ error: 'Only room owners or admins can manage moderators' });
      }
    }

    if (!targetId) {
      return res.status(400).json({ error: 'A target user is required' });
    }

    switch (cmd) {
      case 'kick': {
        await removeRoomMember(db, targetId, gcId);
        sendToUser(targetId, {
          type: 'kicked',
          groupChatId: gcId,
          message: `You were kicked from this room.`,
        });
        res.json({ message: `Kicked ${target}` });
        break;
      }
      case 'ban': {
        await db.run(
          'INSERT OR REPLACE INTO room_bans (room_id, user_id, banned_by, banned_at) VALUES (?, ?, ?, ?)',
          [gcId, targetId, actorId, sqliteNow()]
        );
        await removeRoomMember(db, targetId, gcId);
        sendToUser(targetId, {
          type: 'banned',
          groupChatId: gcId,
          message: `You were banned from this room.`,
        });
        res.json({ message: `Banned ${target}` });
        break;
      }
      case 'unban': {
        await db.run(
          'DELETE FROM room_bans WHERE room_id = ? AND user_id = ?',
          [gcId, targetId]
        );
        res.json({ message: `Unbanned ${target}` });
        break;
      }
      case 'mute':
      case 'unmute': {
        const muted = await isRoomMuted(db, targetId, gcId);
        if (muted) {
          await db.run(
            'DELETE FROM room_mutes WHERE room_id = ? AND user_id = ?',
            [gcId, targetId]
          );
          res.json({ message: `Unmuted ${target}` });
        } else {
          await db.run(
            'INSERT OR REPLACE INTO room_mutes (room_id, user_id, muted_by, muted_at) VALUES (?, ?, ?, ?)',
            [gcId, targetId, actorId, sqliteNow()]
          );
          res.json({ message: `Muted ${target}` });
        }
        break;
      }
      case 'mod':
      case 'demod': {
        const mod = await isRoomMod(db, targetId, gcId);
        if (mod) {
          await db.run(
            'DELETE FROM room_moderators WHERE room_id = ? AND user_id = ?',
            [gcId, targetId]
          );
          res.json({ message: `Demoted ${target} from moderator` });
        } else {
          await db.run(
            'INSERT OR REPLACE INTO room_moderators (room_id, user_id, elevated_by, elevated_at) VALUES (?, ?, ?, ?)',
            [gcId, targetId, actorId, sqliteNow()]
          );
          res.json({ message: `Promoted ${target} to moderator` });
        }
        break;
      }
      default:
        return res.status(400).json({ error: `Unknown command: ${cmd}` });
    }
  });

  // -------------------------------------------------------------------------
  // Files + GIFs
  // -------------------------------------------------------------------------

  router.post(
    '/upload',
    uploadLimiter,
    requireAuth,
    async (req: Request, res: Response) => {
    const { fileName, dataUrl } = req.body || {};

    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return res.status(400).json({ error: 'Invalid file data' });
    }
    const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
    if (!match) {
      return res.status(400).json({ error: 'Expected a base64 data URL' });
    }

    const mime = match[1].toLowerCase();
    // Reject anything not explicitly allowlisted. SVG/HTML execute as script
    // when served same-origin, so they can never be stored.
    if (!ALLOWED_UPLOAD_MIMES.has(mime)) {
      return res.status(415).json({ error: 'File type not allowed' });
    }
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
    }
  );

  const giphyApiKey = process.env.GIPHY_API_KEY;

  router.get(
    '/searchGifs',
    gifLimiter,
    requireAuth,
    async (req: Request, res: Response) => {
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
    }
  );

  return router;
}
