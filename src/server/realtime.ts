/** The WebSocket server: auth/session handling, message + moderation frames,
 *  and the minigame lifecycle/gameplay protocol (gameCreate..gameEnded).
 *  Server-authoritative — game state and timers live here. */
import { WebSocketServer, WebSocket } from 'ws';
import type { Session } from './core/auth';
import { MAX_MESSAGE_LENGTH, MAX_WS_FRAME_BYTES } from './core/constants';
import { GameManager, type Game } from './games/games';
import { isKnownGameType } from './games/gameTypes';
import { IMPOSTOR_WORD_POOL, CTF_PROMPT_POOL } from './games/gamePools';
import {
  createImpostorSession,
  submitHint,
  timeoutHintTurn,
  timeoutGuess,
  choose,
  castVote as castImpostorVote,
  submitGuess,
  type ImpostorSession,
} from './games/impostorSession';
import {
  createCtfSession,
  validateSettings as validateCtfSettings,
  submitAnswers,
  timeoutAnswers,
  castVote as castCtfVote,
  timeoutVote as timeoutCtfVote,
  type CtfSession,
} from './games/completeTheFunny';
import {
  sqliteNow,
  validateGCID,
  isRoomMember,
  isSiteAdmin,
  isRoomBanned,
  isRoomMuted,
  roomIsReadonly,
  roomIsAnonymous,
  getAnonName,
  addMessageToTable,
  bumpForumPost,
  type DB,
} from './core/db';

interface Realtime {
  wss: WebSocketServer;
  broadcast: (payload: unknown, groupChatId?: number | null) => void;
  /** Send a JSON frame to every socket belonging to a specific user. */
  sendToUser: (userId: number, payload: unknown) => void;
}

type AuthedSocket = WebSocket & { session?: Session };

/**
 * Create the WebSocket server plus its broadcast helper. Both are returned
 * together so the route layer and the message handler share the same wss.
 * `db` powers recipient filtering: broadcasts scoped to a room only reach
 * sockets whose user is a member of that room.
 */
export function createRealtime({ db }: { db: DB }): Realtime {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_FRAME_BYTES,
  });

  function broadcast(
    payload: unknown,
    groupChatId?: number | null
  ): void {
    // No room scope → deliver to everyone (used for server-wide notices).
    if (groupChatId === null || groupChatId === undefined) {
      const data = JSON.stringify(payload);
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
      });
      return;
    }

    // Resolve the room's members, then fan out to matching sockets only.
    db.all('SELECT user_id FROM room_members WHERE room_id = ?', [groupChatId])
      .then((rows) => {
        const memberIds = new Set<number>(rows.map((r) => Number(r.user_id)));
        const data = JSON.stringify(payload);
        wss.clients.forEach((client) => {
          const session = (client as AuthedSocket).session;
          if (!session || !memberIds.has(session.userId)) return;
          if (client.readyState === WebSocket.OPEN) client.send(data);
        });
      })
      .catch((err) => {
        console.error('[ws] scoped broadcast failed:', err);
      });
  }

  function sendToUser(userId: number, payload: unknown): void {
    const data = JSON.stringify(payload);
    wss.clients.forEach((client) => {
      const session = (client as AuthedSocket).session;
      if (!session || session.userId !== userId) return;
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
  }

  return { wss, broadcast, sendToUser };
}

/** Send a JSON error over a WebSocket. */
function wsError(ws: WebSocket, messageText: string): void {
  ws.send(JSON.stringify({ type: 'error', messageText }));
}

/**
 * Attach the authenticated message handler to a WebSocket server. The session
 * is resolved in the HTTP upgrade handler (in server.ts) and stashed on the
 * socket, so this only has to read ws.session.
 */
/** Room-scoped game cleanup, used when a room is deleted or reaped. */
export interface GameCleanup {
  endGamesInRoom: (groupChatId: number) => void;
}

export function attachMessageHandler({
  wss,
  db,
  broadcast,
  sendToUser,
  games,
}: {
  wss: WebSocketServer;
  db: DB;
  broadcast: (payload: unknown, groupChatId?: number | null) => void;
  sendToUser: (userId: number, payload: unknown) => void;
  /** Shared game registry; a fresh one is created when not supplied. */
  games?: GameManager;
}): GameCleanup {
  const manager = games ?? new GameManager();
  // In-play sessions per game (Impostor / Complete the Funny) plus the
  // server-enforced turn/answer timers. Ended games clear both.
  const gameSessions = new Map<string, ImpostorSession | CtfSession>();
  const gameTimers = new Map<string, NodeJS.Timeout>();
  wss.on('connection', (rawWs: WebSocket) => {
    const ws = rawWs as AuthedSocket;
    const session = ws.session;
    if (!session) {
      ws.close(1008, 'Authentication required');
      return;
    }
    console.log(`Client connected: ${session.username}`);

    // ws emits protocol/socket errors here (e.g. WS_ERR_UNSUPPORTED_MESSAGE_
    // LENGTH when a frame exceeds maxPayload). Without this listener the
    // error would escape as an uncaught exception and kill the process.
    ws.on('error', (err) => {
      console.error(`[ws] socket error (${session.username}):`, err.message);
    });

    ws.on('message', async (message) => {
      // A malformed frame or DB failure must never take the process down:
      // `ws` ignores the promise returned by this listener, so without this
      // catch every rejection would surface as an unhandledRejection and
      // terminate the server.
      try {
        await handleFrame(message.toString(), {
          ws,
          session,
          db,
          broadcast,
          sendToUser,
          games: manager,
          gameSessions,
          gameTimers,
        });
      } catch (err) {
        console.error('[ws] failed to handle frame:', err);
        if (ws.readyState === WebSocket.OPEN) {
          wsError(ws, 'Message could not be processed');
        }
      }
    });

    ws.on('close', async () => {
      // Closing the tab / losing the connection is a hard leave (spec §3.1):
      // the player is removed from any game they were in, freeing their
      // one-game-at-a-time slot, and the room sees the updated roster.
      const playerId = String(session.userId);
      const game = manager.gameOf(playerId);
      if (game) {
        try {
          const updated = manager.hardLeaveGame(playerId, game.gameId);
          await broadcastGameView(
            db,
            broadcast,
            game.groupChatId,
            updated.participantIds,
            (map) => gameStatePayload(updated, map)
          );
        } catch (err) {
          console.error('[ws] hard-leave on disconnect failed:', err);
        }
      }
      console.log('Client has disconnected');
    });
  });

  return {
    /**
     * End every game in a room (used when the room is deleted) and drop the
     * in-play session and timer for each, so no stale game keeps advancing.
     */
    endGamesInRoom(groupChatId: number): void {
      for (const gameId of manager.endGamesInRoom(groupChatId)) {
        const timer = gameTimers.get(gameId);
        if (timer) clearTimeout(timer);
        gameTimers.delete(gameId);
        gameSessions.delete(gameId);
      }
    },
  };
}

const HELP_COMMANDS: [string, string][] = [
  ['/kick @user', 'Remove a user from the room.'],
  ['/ban @user', 'Ban a user from the room.'],
  ['/unban @user', 'Remove a user\'s ban.'],
  ['/mute @user', 'Prevent a user from sending messages.'],
  ['/unmute @user', 'Allow a muted user to send messages.'],
  ['/mod @user', 'Promote a user to moderator.'],
  ['/demod @user', 'Demote a moderator.'],
  ['/join #code', 'Join a room by its numeric code.'],
  ['/leave', 'Leave the current room.'],
  ['/help [page]', 'Show this help.'],
];
const HELP_PAGE_SIZE = 10;

async function broadcastHelp(ctx: {
  db: DB;
  session: Session;
  groupChatId: number;
  page: number;
  broadcast: Realtime['broadcast'];
}): Promise<void> {
  const { db, session, groupChatId, page, broadcast } = ctx;
  const totalPages = Math.ceil(HELP_COMMANDS.length / HELP_PAGE_SIZE);
  const p = Math.max(1, Math.min(page, totalPages));
  const start = (p - 1) * HELP_PAGE_SIZE;
  const slice = HELP_COMMANDS.slice(start, start + HELP_PAGE_SIZE);

  const lines = [
    `Commands (page ${p} of ${totalPages}):`,
    '',
    ...slice.map(([cmd, desc]) => `${cmd}  —  ${desc}`),
    '',
    totalPages > 1 ? `Type /help N for page N.` : '',
  ].filter(Boolean);

  broadcast(
    {
      type: 'message',
      speaker: 'sys',
      displayNameText: 'SYS',
      groupChatId,
      messageText: lines.join('\n'),
      timestamp: sqliteNow(),
    },
    groupChatId
  );
}

/**
 * Validate one client frame, store the message, and return the clean echo
 * payload to broadcast. Throws on invalid input; the connection handler turns
 * that into an error frame.
 */
async function handleFrame(
  messageString: string,
  ctx: GameFrameCtx
): Promise<void> {
  const { ws, session, db, broadcast, games } = ctx;

  // The dynamic shape is validated field-by-field below.
  const messageJSON: Record<string, any> = JSON.parse(messageString);
  let {
    type,
    groupChatId = 0,
    messageText = '',
    gifUrl = '',
    fileUrl = null,
    fileName = null,
    fileType = null,
    replyToId = null,
    forumPostId = null,
  } = messageJSON;
  // The display name is the authenticated username unless the room is
  // anonymous and the user is not an admin.
  let displayNameText = session.username;
  const isAnon =
    groupChatId !== undefined &&
    groupChatId !== null &&
    (await roomIsAnonymous(db, groupChatId));
  const isAdmin = session.isAdmin || (await isSiteAdmin(db, session.userId));
  if (isAnon && !isAdmin) {
    displayNameText = await getAnonName(db, session.userId, groupChatId);
  }

  if (type === 'ping') {
    ws.send(JSON.stringify({ type: 'pong' }));
    return;
  }
  if (type === 'help') {
    const page = Math.max(1, parseInt(String(messageJSON.page ?? '1'), 10) || 1);
    broadcastHelp({ db, session, groupChatId, page, broadcast });
    return;
  }
  if (typeof type === 'string' && type.startsWith('game')) {
    try {
      await handleGameFrame(messageJSON, ctx);
    } catch (err) {
      if (ws.readyState === WebSocket.OPEN) {
        wsError(
          ws,
          err instanceof Error ? err.message : 'Message could not be processed'
        );
      }
    }
    return;
  }
  if (!messageText && !gifUrl && !fileUrl) {
    return wsError(ws, 'Message is empty');
  }
  if (messageText.length > MAX_MESSAGE_LENGTH) {
    return wsError(
      ws,
      `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`
    );
  }
  // Only accept references to files we actually served from /uploads.
  if (fileUrl && !/^\/uploads\/[A-Za-z0-9._-]+$/.test(fileUrl)) {
    return wsError(ws, 'Invalid file reference');
  }
  // GIFs must point at the GIPHY CDN over HTTPS. Anything else would let a
  // client embed arbitrary remote images and track every viewer's IP.
  if (
    gifUrl &&
    !/^https:\/\/([\w-]+\.)*giphy\.com\//i.test(String(gifUrl))
  ) {
    return wsError(ws, 'Invalid GIF URL');
  }
  if (fileUrl) {
    fileName = typeof fileName === 'string' ? fileName.slice(0, 120) : null;
    fileType = typeof fileType === 'string' ? fileType.slice(0, 100) : null;
  } else {
    fileName = null;
    fileType = null;
  }
  if (groupChatId && !(await validateGCID(db, groupChatId))) {
    return wsError(ws, 'Invalid group chat ID');
  }
  // Posting is members-only, mirroring the HTTP read rules.
  if (!(await isRoomMember(db, session.userId, groupChatId))) {
    return wsError(ws, 'Join this room before sending messages');
  }

  // Banned users may not send messages (admins are immune).
  if (!isAdmin && (await isRoomBanned(db, session.userId, groupChatId))) {
    return wsError(ws, 'You are banned from this room');
  }

  // Muted users may not send messages (admins are immune).
  if (
    !isAdmin &&
    (await isRoomMuted(db, session.userId, groupChatId))
  ) {
    return wsError(ws, 'You are muted in this room');
  }

  // Readonly rooms: only admins may speak.
  if (
    !isAdmin &&
    (await roomIsReadonly(db, groupChatId))
  ) {
    return wsError(ws, 'This room is read-only (admins only)');
  }

  // Resolve the reply target server-side so clients can't spoof the quoted
  // author/text. The quote is denormalized at reply time, so it survives the
  // original being edited or deleted later.
  let replyToIdValue: number | null = null;
  let replyQuote: string | null = null;
  let replyAuthor: string | null = null;
  if (replyToId !== null && replyToId !== undefined && replyToId !== '') {
    replyToIdValue = parseInt(replyToId, 10);
    if (!Number.isInteger(replyToIdValue) || replyToIdValue <= 0) {
      return wsError(ws, 'Invalid reply target');
    }
    const replyTarget = await db.get(
      'SELECT * FROM messages WHERE id = ? AND group_chat_id = ?',
      [replyToIdValue, groupChatId]
    );
    if (!replyTarget) {
      return wsError(ws, 'Reply target not found');
    }
    replyAuthor = replyTarget.display_name || '';
    if (replyTarget.message_text) {
      replyQuote = replyTarget.message_text;
    } else if (replyTarget.file_url) {
      replyQuote = `📎 ${replyTarget.file_name || 'attachment'}`;
    } else if (replyTarget.gif_url) {
      replyQuote = 'GIF';
    }
    if (replyQuote) replyQuote = replyQuote.slice(0, 280);

    // Prepend @replyAuthor so the reply target gets pinged. Only do this
    // when the sender hasn't already included the mention themselves.
    if (replyAuthor && messageText) {
      const mention = `@${replyAuthor}`;
      if (!messageText.startsWith(mention)) {
        messageText = `${mention} ${messageText}`;
      }
    }
  }

  // Attach the sender's current profile picture so live recipients can
  // render the avatar without another lookup.
  const sender = await db.get('SELECT picture_url FROM users WHERE id = ?', [
    session.userId,
  ]);
  const avatarUrl = sender ? sender.picture_url : null;

  const sqliteTextTimestamp = sqliteNow();

  // Store with the authenticated author id, then include the real DB id +
  // author id in the echo so clients can later edit/delete by id.

  // Validate and parse forumPostId if present
  let forumPostIdValue: number | null = null;
  if (forumPostId !== null && forumPostId !== undefined && forumPostId !== '') {
    forumPostIdValue = parseInt(forumPostId, 10);
    if (!Number.isInteger(forumPostIdValue) || forumPostIdValue <= 0) {
      forumPostIdValue = null;
    }
  }

  const messageId = await addMessageToTable(
    db,
    groupChatId,
    messageText,
    displayNameText,
    gifUrl,
    sqliteTextTimestamp,
    avatarUrl,
    fileUrl,
    fileName,
    fileType,
    session.userId,
    replyToIdValue,
    replyQuote,
    replyAuthor,
    forumPostIdValue
  );

  // Broadcast a rebuilt payload. In anonymous rooms, strip userId so
  // non-admin clients can't track who sent what (admins see IDs via REST).
  broadcast(
    {
      type: 'message',
      id: messageId,
      userId: isAnon && !isAdmin ? null : session.userId,
      groupChatId,
      messageText,
      gifUrl,
      displayNameText,
      username: session.username,
      avatarUrl: isAnon && !isAdmin ? null : avatarUrl,
      timestamp: sqliteTextTimestamp,
      fileUrl,
      fileName,
      fileType,
      replyToId: replyToIdValue,
      replyQuote,
      replyAuthor,
      forumPostId: forumPostIdValue,
    },
    groupChatId
  );

  // Bump the forum post's updated_at so it sorts by recent activity.
  if (forumPostIdValue) {
    try {
      await bumpForumPost(db, forumPostIdValue);
    } catch (_) { /* non-critical */ }
  }
}

interface GameFrameCtx {
  ws: WebSocket;
  session: Session;
  db: DB;
  broadcast: Realtime['broadcast'];
  sendToUser: (userId: number, payload: unknown) => void;
  games: GameManager;
  gameSessions: Map<string, ImpostorSession | CtfSession>;
  gameTimers: Map<string, NodeJS.Timeout>;
}

/**
 * Game frames (spec §8 Phase 0/2/3). Lifecycle mutations (create/join/leave/
 * start/end) go through the GameManager and broadcast `gameState`; gameplay
 * (hint/choose/vote/guess/answer) drives the per-game session and broadcasts
 * `gamePlay`. Starting an Impostor game privately deals each player their word
 * (crewmates) or hint (impostors) — the secret word never enters a broadcast.
 *
 * Client → server:
 * - `{ type: 'gameCreate', gameType, groupChatId, settings? }`
 * - `{ type: 'gameJoin' | 'gameRejoin' | 'gameSoftLeave' | 'gameHardLeave'
 *     | 'gameStart' | 'gameEnd', gameId, settings? }`
 * - `{ type: 'gameHint', gameId, hint }`
 * - `{ type: 'gameChoose', gameId, choice: 'continue' | 'vote' }`
 * - `{ type: 'gameVote', gameId, votedForId }` (Impostor)
 * - `{ type: 'gameVote', gameId, phaseIndex, answerId }` (Complete the Funny)
 * - `{ type: 'gameGuess', gameId, guess }` (Impostor)
 * - `{ type: 'gameAnswer', gameId, answers: string[] }` (Complete the Funny)
 */
async function handleGameFrame(
  messageJSON: Record<string, any>,
  ctx: GameFrameCtx
): Promise<void> {
  const { ws, session, db, broadcast, games } = ctx;
  const type: string = messageJSON.type;
  const gameId: unknown = messageJSON.gameId;

  switch (type) {
    case 'gameCreate': {
      const gameType = messageJSON.gameType;
      const groupChatId = Number(messageJSON.groupChatId);
      if (typeof gameType !== 'string' || !isKnownGameType(gameType)) {
        return wsError(ws, 'unknown game type');
      }
      if (
        !Number.isInteger(groupChatId) ||
        !(await validateGCID(db, groupChatId))
      ) {
        return wsError(ws, 'Invalid group chat ID');
      }
      if (!(await isRoomMember(db, session.userId, groupChatId))) {
        return wsError(ws, 'Join this room before creating a game');
      }
      const game = games.createGame({
        gameType,
        hostId: String(session.userId),
        groupChatId,
      });
      await broadcastGameView(db, broadcast, groupChatId, game.participantIds, (map) =>
        gameStatePayload(game, map)
      );
      return;
    }
    case 'gameJoin': {
      const game = await resolveGameForPlayer(ws, session, db, games, gameId);
      if (!game) return;
      const updated = games.joinGame(String(session.userId), game.gameId);
      await broadcastGameView(
        db,
        broadcast,
        game.groupChatId,
        updated.participantIds,
        (map) => gameStatePayload(updated, map)
      );
      return;
    }
    case 'gameStart': {
      const game = await resolveGameForPlayer(ws, session, db, games, gameId);
      if (!game) return;
      const updated = games.startGame(String(session.userId), game.gameId);
      const settings = (messageJSON.settings ?? {}) as Record<string, unknown>;
      if (game.gameType === 'impostor') {
        await startImpostorPlay(ctx, updated, settings);
      } else if (game.gameType === 'complete-the-funny') {
        await startCtfPlay(ctx, updated, settings);
      } else {
        await broadcastGameView(
          db,
          broadcast,
          game.groupChatId,
          updated.participantIds,
          (map) => gameStatePayload(updated, map)
        );
      }
      return;
    }
    case 'gameHint': {
      const game = await requirePlayable(ws, session, db, games, ctx.gameSessions, gameId);
      if (!game) return;
      if (!requireActivePlayer(ctx, game)) return;
      const imp = requireImpostorSession(ctx, game);
      if (!imp) return;
      try {
        submitHint(imp, String(session.userId), String(messageJSON.hint ?? ''), Date.now());
      } catch (err) {
        return wsError(ws, err instanceof Error ? err.message : 'invalid hint');
      }
      scheduleImpostorTimer(ctx, game.gameId);
      await broadcastGameView(
        db,
        broadcast,
        game.groupChatId,
        imp.playerIds,
        (map) => impostorPlayView(imp, game, map)
      );
      return;
    }
    case 'gameChoose': {
      const game = await requirePlayable(ws, session, db, games, ctx.gameSessions, gameId);
      if (!game) return;
      if (!requireActivePlayer(ctx, game)) return;
      const imp = requireImpostorSession(ctx, game);
      if (!imp) return;
      try {
        choose(
          imp,
          String(session.userId),
          messageJSON.choice === 'vote' ? 'vote' : 'continue',
          Date.now()
        );
      } catch (err) {
        return wsError(ws, err instanceof Error ? err.message : 'invalid choice');
      }
      // When max rounds is reached and everyone continues, choose() ends
      // the game as a tie. Broadcast the final "over" play view (I-5) so
      // clients render the result screen, then finish the game; the overlay
      // stays open on the client until each player closes it.
      if (imp.phase.kind === 'over') {
        await broadcastGameOverView(ctx, game, imp, imp.phase.outcome);
        return;
      }
      await broadcastGameView(
        db,
        broadcast,
        game.groupChatId,
        imp.playerIds,
        (map) => impostorPlayView(imp, game, map)
      );
      return;
    }
    case 'gameVote': {
      const game = await requirePlayable(ws, session, db, games, ctx.gameSessions, gameId);
      if (!game) return;
      if (!requireActivePlayer(ctx, game)) return;
      const sessionObj = ctx.gameSessions.get(game.gameId);
      if (!sessionObj) return wsError(ws, 'game not found or has ended');
      const before = sessionObj.phase.kind;
      try {
        if ('roleByPlayerId' in sessionObj) {
          // The client sends a display name (username / anon name) as
          // votedForId; reverse-map it to the raw user id the session uses.
          const map = await playerIdentityMap(db, game.groupChatId, sessionObj.playerIds);
          const reverse = new Map([...map.entries()].map(([id, name]) => [name, id]));
          const votedForId = reverse.get(String(messageJSON.votedForId ?? '')) ?? String(messageJSON.votedForId ?? '');
          castImpostorVote(sessionObj, String(session.userId), votedForId);
        } else {
          castCtfVote(
            sessionObj,
            String(session.userId),
            Number(messageJSON.phaseIndex),
            String(messageJSON.answerId ?? '')
          );
        }
      } catch (err) {
        return wsError(ws, err instanceof Error ? err.message : 'invalid vote');
      }
      await afterVote(ctx, game, sessionObj, before);
      return;
    }
    case 'gameGuess': {
      const game = await requirePlayable(ws, session, db, games, ctx.gameSessions, gameId);
      if (!game) return;
      if (!requireActivePlayer(ctx, game)) return;
      const imp = requireImpostorSession(ctx, game);
      if (!imp) return;
      try {
        submitGuess(imp, String(session.userId), String(messageJSON.guess ?? ''));
      } catch (err) {
        return wsError(ws, err instanceof Error ? err.message : 'invalid guess');
      }
      if (imp.phase.kind === 'over') {
        await broadcastGameOverView(ctx, game, imp, imp.phase.outcome);
      }
      return;
    }
    case 'gameAnswer': {
      const game = await requirePlayable(ws, session, db, games, ctx.gameSessions, gameId);
      if (!game) return;
      if (!requireActivePlayer(ctx, game)) return;
      const ctf = ctx.gameSessions.get(game.gameId);
      if (!ctf || 'roleByPlayerId' in ctf) return wsError(ws, 'not a Complete the Funny game');
      try {
        submitAnswers(
          ctf,
          String(session.userId),
          Array.isArray(messageJSON.answers) ? messageJSON.answers.map(String) : [],
          Date.now()
        );
      } catch (err) {
        return wsError(ws, err instanceof Error ? err.message : 'invalid answers');
      }
      scheduleCtfTimer(ctx, game.gameId);
      await broadcastGameView(
        db,
        broadcast,
        game.groupChatId,
        ctf.playerIds,
        (map) => ctfPlayView(ctf, game, map)
      );
      return;
    }
    case 'gameSoftLeave': {
      const game = await resolveGameForPlayer(ws, session, db, games, gameId);
      if (!game) return;
      const updated = games.softLeaveGame(String(session.userId), game.gameId);
      await broadcastGameView(
        db,
        broadcast,
        game.groupChatId,
        updated.participantIds,
        (map) => gameStatePayload(updated, map)
      );
      return;
    }
    case 'gameRejoin': {
      const game = await resolveGameForPlayer(ws, session, db, games, gameId);
      if (!game) return;
      const updated = games.rejoinGame(String(session.userId), game.gameId);
      await broadcastGameView(
        db,
        broadcast,
        game.groupChatId,
        updated.participantIds,
        (map) => gameStatePayload(updated, map)
      );
      return;
    }
    case 'gameHardLeave': {
      const game = await resolveGameForPlayer(ws, session, db, games, gameId);
      if (!game) return;
      const updated = games.hardLeaveGame(String(session.userId), game.gameId);
      await broadcastGameView(
        db,
        broadcast,
        game.groupChatId,
        updated.participantIds,
        (map) => gameStatePayload(updated, map)
      );
      return;
    }
    case 'gameEnd': {
      const game = await resolveGameForPlayer(ws, session, db, games, gameId);
      if (!game) return;
      if (game.hostId !== String(session.userId)) {
        return wsError(ws, 'only the host can end the game');
      }
      finishGame(ctx, game, undefined);
      return;
    }
    default:
      throw new Error('not implemented');
  }
}

/** Resolve the game; gameplay frames also require an in-play session. */
async function requirePlayable(
  ws: WebSocket,
  session: Session,
  db: DB,
  games: GameManager,
  gameSessions: Map<string, ImpostorSession | CtfSession>,
  gameId: unknown
): Promise<Game | null> {
  const game = await resolveGameForPlayer(ws, session, db, games, gameId);
  if (!game) return null;
  if (!gameSessions.has(game.gameId)) {
    wsError(ws, 'game not found or has ended');
    return null;
  }
  return game;
}

/** Soft-leavers stay participants but cannot act until they rejoin. */
function requireActivePlayer(ctx: GameFrameCtx, game: Game): boolean {
  const playerId = String(ctx.session.userId);
  if (game.inactivePlayerIds.includes(playerId)) {
    ctx.ws.send(
      JSON.stringify({ type: 'error', messageText: 'rejoin the game to keep playing' })
    );
    return false;
  }
  return true;
}

function requireImpostorSession(
  ctx: GameFrameCtx,
  game: Game
): ImpostorSession | null {
  const session = ctx.gameSessions.get(game.gameId);
  if (!session || !('roleByPlayerId' in session)) {
    ctx.ws.send(
      JSON.stringify({ type: 'error', messageText: 'not an Impostor game' })
    );
    return null;
  }
  return session;
}

/** Start an Impostor game: deal private roles, then broadcast the play view. */
async function startImpostorPlay(
  ctx: GameFrameCtx,
  game: Game,
  settings: Record<string, unknown>
): Promise<void> {
  const { db, sendToUser, broadcast } = ctx;
  const impostorCount = Number(settings.impostorCount ?? 1);
  const hintTimeMs =
    settings.hintTimeMs !== undefined ? Number(settings.hintTimeMs) : undefined;
  const wordViewMs =
    settings.wordViewMs !== undefined ? Number(settings.wordViewMs) : undefined;
  const guessTimeMs =
    settings.guessTimeMs !== undefined ? Number(settings.guessTimeMs) : undefined;
  const maxRounds =
    settings.maxRounds !== undefined ? Number(settings.maxRounds) : undefined;
  const play = createImpostorSession({
    playerIds: game.participantIds,
    impostorCount,
    wordPool: IMPOSTOR_WORD_POOL,
    random: Math.random,
    now: Date.now(),
    hintTimeMs,
    wordViewMs,
    guessTimeMs,
    maxRounds,
  });
  ctx.gameSessions.set(game.gameId, play);
  const map = await playerIdentityMap(db, game.groupChatId, game.participantIds);
  // Private frames: crewmates get the word, impostors get the hint. The word
  // must never appear in a room broadcast. In anonymous rooms each player
  // also learns their own anon name so they can find themselves among the
  // anonymized participant lists in the broadcast views.
  for (const playerId of game.participantIds) {
    const isImpostor = play.roleByPlayerId[playerId] === 'impostor';
    sendToUser(Number(playerId), {
      type: 'gameRole',
      gameId: game.gameId,
      role: isImpostor ? 'impostor' : 'crewmate',
      ...(isImpostor ? { hint: play.hint } : { secretWord: play.secretWord }),
      ...(map.get(playerId) !== playerId ? { anonName: map.get(playerId) } : {}),
    });
  }
  scheduleImpostorTimer(ctx, game.gameId);
  broadcast(impostorPlayView(play, game, map), game.groupChatId);
}

/** Start a Complete the Funny game: deal prompts, then broadcast the play view. */
async function startCtfPlay(
  ctx: GameFrameCtx,
  game: Game,
  settings: Record<string, unknown>
): Promise<void> {
  const { db, broadcast } = ctx;
  const ctf = createCtfSession({
    gameId: game.gameId,
    playerIds: game.participantIds,
    settings: validateCtfSettings(settings),
    promptPool: CTF_PROMPT_POOL,
    random: Math.random,
    now: Date.now(),
  });
  ctx.gameSessions.set(game.gameId, ctf);
  scheduleCtfTimer(ctx, game.gameId);
  await broadcastGameView(
    db,
    broadcast,
    game.groupChatId,
    ctf.playerIds,
    (map) => ctfPlayView(ctf, game, map)
  );
}

/**
 * After a vote lands: resolve/advance silently until the phase changes, then
 * broadcast the outcome — a new round's answering phase, a guess phase, or
 * game over (which deletes the game).
 */
async function afterVote(
  ctx: GameFrameCtx,
  game: Game,
  session: ImpostorSession | CtfSession,
  beforeKind: string
): Promise<void> {
  const { db, broadcast } = ctx;
  const afterKind = session.phase.kind;
  // For Impostor, broadcast on every vote so the live vote tally
  // (I-1 dots) updates for everyone — not just when the phase changes.
  if ('roleByPlayerId' in session) {
    // Impostor: voted-out crewmate → over; voted-out impostor → guess phase.
    // Always broadcast so the live vote tally (I-1 dots) updates on every
    // vote, even while still in the vote phase.
    if (session.phase.kind === 'guess') {
      // Server-enforced deadline so a disconnected impostor can't hang the
      // game (resolves as crewmates-win on timeout).
      scheduleGuessTimer(ctx, game.gameId);
    }
    if (session.phase.kind === 'over') {
      await broadcastGameOverView(ctx, game, session, session.phase.outcome);
    } else {
      await broadcastGameView(
        db,
        broadcast,
        game.groupChatId,
        session.playerIds,
        (map) => impostorPlayView(session, game, map)
      );
    }
    return;
  }
  if (session.phase.kind === 'over') {
    // CTF-6: broadcast the final "over" play view (ranked leaderboard)
    // before ending the game, so clients render the scoreboard.
    await broadcastCtfGameOverView(ctx, game, session);
  } else if (session.phase.kind === 'answering') {
    // Round advanced to the next answering phase.
    scheduleCtfTimer(ctx, game.gameId);
    await broadcastGameView(
      db,
      broadcast,
      game.groupChatId,
      session.playerIds,
      (map) => ctfPlayView(session, game, map)
    );
  } else {
    // Still voting (synchronized): schedule the per-matchup vote timer so
    // a straggler can't hang the game, and re-broadcast the live tally.
    scheduleCtfVoteTimer(ctx, game.gameId);
    await broadcastGameView(
      db,
      broadcast,
      game.groupChatId,
      session.playerIds,
      (map) => ctfPlayView(session, game, map)
    );
  }
}

/**
 * Broadcast the final "over" play view (I-5: clients must render the result
 * screen — outcome, who the slime was, the secret word — and keep it until
 * each player closes the overlay), then finish the game. The session is
 * still alive at broadcast time so the play view carries the outcome; the
 * client persists the last play view after gameEnded (useMinigames).
 */
async function broadcastGameOverView(
  ctx: GameFrameCtx,
  game: Game,
  session: ImpostorSession,
  outcome: string
): Promise<void> {
  const { db, broadcast } = ctx;
  await broadcastGameView(
    db,
    broadcast,
    game.groupChatId,
    session.playerIds,
    (map) => impostorPlayView(session, game, map)
  );
  finishGame(ctx, game, outcome);
}

/**
 * CTF-6: broadcast the final "over" play view (ranked leaderboard) before
 * ending the game, mirroring the Impostor I-5 fix. The client persists the
 * last play view after gameEnded (useMinigames), so the scoreboard stays.
 */
async function broadcastCtfGameOverView(
  ctx: GameFrameCtx,
  game: Game,
  session: CtfSession
): Promise<void> {
  const { db, broadcast } = ctx;
  await broadcastGameView(
    db,
    broadcast,
    game.groupChatId,
    session.playerIds,
    (map) => ctfPlayView(session, game, map)
  );
  finishGame(ctx, game, undefined);
}

/** Delete the game (data + session + timer) and announce it to the room. */
function finishGame(
  ctx: GameFrameCtx,
  game: Game,
  outcome: string | undefined
): void {
  const { games, broadcast } = ctx;
  const timer = ctx.gameTimers.get(game.gameId);
  if (timer) clearTimeout(timer);
  ctx.gameTimers.delete(game.gameId);
  ctx.gameSessions.delete(game.gameId);
  games.endGame(game.gameId);
  broadcast(
    {
      type: 'gameEnded',
      gameId: game.gameId,
      groupChatId: game.groupChatId,
      ...(outcome !== undefined ? { outcome } : {}),
    },
    game.groupChatId
  );
}

/** Replace any pending timer for a game with the new one. */
function registerTimer(
  ctx: GameFrameCtx,
  gameId: string,
  handle: NodeJS.Timeout
): void {
  const prev = ctx.gameTimers.get(gameId);
  if (prev) clearTimeout(prev);
  ctx.gameTimers.set(gameId, handle);
}

/** Server-enforced hint timer: skip the current turn when its deadline passes. */
function scheduleImpostorTimer(ctx: GameFrameCtx, gameId: string): void {
  const { db, broadcast } = ctx;
  const session = ctx.gameSessions.get(gameId);
  if (!session || !('roleByPlayerId' in session)) return;
  if (session.phase.kind !== 'hint') return;
  const game = ctx.games.getGame(gameId);
  if (!game) return;
  const ms = Math.max(0, session.phase.hintDeadline - Date.now());
  const handle = setTimeout(async () => {
    timeoutHintTurn(session, Date.now());
    if (session.phase.kind === 'hint') {
      scheduleImpostorTimer(ctx, gameId);
    }
    await broadcastGameView(
      db,
      broadcast,
      game.groupChatId,
      session.playerIds,
      (map) => impostorPlayView(session, game, map)
    );
  }, ms);
  registerTimer(ctx, gameId, handle);
}

/** Server-enforced guess timer: resolve when the impostor's deadline passes. */
function scheduleGuessTimer(ctx: GameFrameCtx, gameId: string): void {
  const { db, broadcast } = ctx;
  const session = ctx.gameSessions.get(gameId);
  if (!session || !('roleByPlayerId' in session)) return;
  if (session.phase.kind !== 'guess') return;
  const game = ctx.games.getGame(gameId);
  if (!game) return;
  const ms = Math.max(0, session.phase.deadline - Date.now());
  const handle = setTimeout(async () => {
    timeoutGuess(session, Date.now());
    if (session.phase.kind === 'over') {
      await broadcastGameOverView(ctx, game, session, session.phase.outcome);
    } else {
      await broadcastGameView(
        db,
        broadcast,
        game.groupChatId,
        session.playerIds,
        (map) => impostorPlayView(session, game, map)
      );
    }
  }, ms);
  registerTimer(ctx, gameId, handle);
}

/** Server-enforced answer timer: fill missing answers at the deadline. */
function scheduleCtfTimer(ctx: GameFrameCtx, gameId: string): void {
  const { db, broadcast } = ctx;
  const session = ctx.gameSessions.get(gameId);
  if (!session || 'roleByPlayerId' in session) return;
  if (session.phase.kind !== 'answering') return;
  const game = ctx.games.getGame(gameId);
  if (!game) return;
  const ms = Math.max(0, session.phase.deadline - Date.now());
  const handle = setTimeout(async () => {
    const now = Date.now();
    for (const playerId of session.playerIds) {
      timeoutAnswers(session, playerId, now);
    }
    if (session.phase.kind === 'answering') {
      scheduleCtfTimer(ctx, gameId);
    }
    await broadcastGameView(
      db,
      broadcast,
      game.groupChatId,
      session.playerIds,
      (map) => ctfPlayView(session, game, map)
    );
  }, ms);
  registerTimer(ctx, gameId, handle);
}

/**
 * Server-enforced per-matchup voting timer (CTF-2): when the current
 * matchup's deadline passes, advance even if not everyone voted (stragglers'
 * votes don't count). If the round resolves, broadcast the over view (CTF-6).
 */
function scheduleCtfVoteTimer(ctx: GameFrameCtx, gameId: string): void {
  const { db, broadcast } = ctx;
  const session = ctx.gameSessions.get(gameId);
  if (!session || 'roleByPlayerId' in session) return;
  if (session.phase.kind !== 'voting') return;
  const matchup = session.phase.phases[session.phase.current];
  if (!matchup) return;
  const game = ctx.games.getGame(gameId);
  if (!game) return;
  const ms = Math.max(0, matchup.voteDeadline - Date.now());
  const handle = setTimeout(async () => {
    const before = session.phase.kind;
    timeoutCtfVote(session, Date.now());
    const after = session.phase.kind;
    if (session.phase.kind === 'voting') {
      // Still voting on the next matchup — reschedule.
      scheduleCtfVoteTimer(ctx, gameId);
    }
    if (after === 'over' && before !== 'over') {
      await broadcastCtfGameOverView(ctx, game, session);
    } else {
      await broadcastGameView(
        db,
        broadcast,
        game.groupChatId,
        session.playerIds,
        (map) => ctfPlayView(session, game, map)
      );
    }
  }, ms);
  registerTimer(ctx, gameId, handle);
}

/**
 * Player id → display identity for a game broadcast. In anonymous rooms every
 * player is shown by their stable room-scoped anon name (the same names
 * messages use). In non-anonymous rooms each player is shown by their
 * username. Keys cover the ids in the payload so callers only need to pass
 * the game's participants.
 */
async function playerIdentityMap(
  db: DB,
  groupChatId: number,
  participantIds: Iterable<string>
): Promise<Map<string, string>> {
  const ids = [...participantIds];
  if (await roomIsAnonymous(db, groupChatId)) {
    const names = await Promise.all(
      ids.map((playerId) => getAnonName(db, Number(playerId), groupChatId))
    );
    return new Map(ids.map((playerId, i) => [playerId, names[i]]));
  }
  // Non-anonymous: resolve usernames in one bulk query.
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT id, username FROM users WHERE id IN (${placeholders})`,
    ids.map(Number)
  );
  const byId = new Map<number, string>(rows.map((r) => [Number(r.id), r.username]));
  return new Map(ids.map((id) => [id, byId.get(Number(id)) ?? id]));
}

/**
 * Build a game view with the right identity map and broadcast it to the
 * game's room. `playerIds` should be the ids that can appear in the payload
 * (the session's players for play views, the roster's for state views) so
 * every id is mapped in anonymous rooms.
 */
async function broadcastGameView(
  db: DB,
  broadcast: Realtime['broadcast'],
  groupChatId: number,
  playerIds: Iterable<string>,
  build: (map: Map<string, string>) => Record<string, unknown>
): Promise<void> {
  const map = await playerIdentityMap(db, groupChatId, playerIds);
  broadcast(build(map), groupChatId);
}

/** Map a player id to its display identity. Falls back to the raw id. */
function mapId(map: Map<string, string>, playerId: string): string {
  return map.get(playerId) ?? playerId;
}

/** Public Impostor play view — roles/word stay private until the "over" phase. */
function impostorPlayView(
  session: ImpostorSession,
  game: Game,
  map: Map<string, string>
): Record<string, unknown> {
  const hints: Record<string, string> = {};
  for (const [playerId, hint] of Object.entries(session.hints)) {
    hints[mapId(map, playerId)] = hint;
  }
  const hintsByRound: Record<string, Record<string, string>> = {};
  for (const [round, roundHints] of Object.entries(session.hintsByRound)) {
    const mapped: Record<string, string> = {};
    for (const [playerId, hint] of Object.entries(roundHints)) {
      mapped[mapId(map, playerId)] = hint;
    }
    hintsByRound[round] = mapped;
  }
  const choices: Record<string, "continue" | "vote"> = {};
  for (const [playerId, choice] of Object.entries(session.choices)) {
    choices[mapId(map, playerId)] = choice;
  }
  const votes: Record<string, string> = {};
  for (const [voter, votedFor] of Object.entries(session.votes)) {
    votes[mapId(map, voter)] = mapId(map, votedFor);
  }
  return {
    type: 'gamePlay',
    gameId: game.gameId,
    game: 'impostor',
    status: game.status,
    round: session.round,
    phase: session.phase.kind,
    turnPlayerId:
      session.phase.kind === 'hint' ? mapId(map, session.phase.turnPlayerId) : null,
    wordViewUntil:
      session.phase.kind === 'hint' ? session.phase.wordViewUntil : null,
    hintDeadline:
      session.phase.kind === 'hint' ? session.phase.hintDeadline : null,
    hints,
    hintsByRound,
    choices,
    votes,
    votedOutId: session.votedOutId ? mapId(map, session.votedOutId) : null,
    outcome: session.phase.kind === 'over' ? session.phase.outcome : null,
    // Reveal who the impostor(s) were + the secret word once the game is
    // over. Safe because finishGame() deletes the session right after.
    ...(session.phase.kind === 'over'
      ? {
          impostorIds: Object.entries(session.roleByPlayerId)
            .filter(([, r]) => r === 'impostor')
            .map(([id]) => mapId(map, id)),
          secretWord: session.secretWord,
        }
      : {}),
  };
}

/** Public Complete the Funny play view — answers hidden until voting. */
function ctfPlayView(
  session: CtfSession,
  game: Game,
  map: Map<string, string>
): Record<string, unknown> {
  const prompts: Record<string, string[]> = {};
  const answered: Record<string, number> = {};
  for (const [playerId, answers] of Object.entries(session.answersByPlayer)) {
    prompts[mapId(map, playerId)] = answers.map((a) => a.prompt);
    answered[mapId(map, playerId)] = answers.filter((a) => a.text !== '').length;
  }
  const phases =
    session.phase.kind === 'voting'
      ? session.phase.phases.map((m) => {
          const voteCounts = new Map<string, number>();
          for (const answerId of Object.values(m.votes)) {
            voteCounts.set(answerId, (voteCounts.get(answerId) ?? 0) + 1);
          }
          return {
            prompt: m.prompt,
            answers: m.answers.map((a) => ({
              id: a.id,
              playerId: mapId(map, a.playerId),
              text: a.text,
              voteCount: voteCounts.get(a.id) ?? 0,
            })),
            voteDeadline: m.voteDeadline ?? null,
          };
        })
      : null;
  const scores: Record<string, number> = {};
  for (const [playerId, score] of Object.entries(session.scores)) {
    if (score > 0) scores[mapId(map, playerId)] = score;
  }
  const leaderboard: Record<string, number> | null =
    session.phase.kind === 'over'
      ? Object.fromEntries(
          Object.entries(session.phase.leaderboard).map(([pid, score]) => [
            mapId(map, pid),
            score,
          ])
        )
      : null;
  return {
    type: 'gamePlay',
    gameId: game.gameId,
    game: 'complete-the-funny',
    status: game.status,
    round: session.round,
    phase: session.phase.kind,
    deadline: session.phase.kind === 'answering' ? session.phase.deadline : null,
    prompts,
    answered,
    scores,
    phases,
    currentMatchup:
      session.phase.kind === 'voting' ? session.phase.current : undefined,
    voteDeadline:
      session.phase.kind === 'voting'
        ? (session.phase.phases[session.phase.current]?.voteDeadline ?? null)
        : null,
    leaderboard,
  };
}

/**
 * Resolve the frame's gameId and enforce the room-membership rule: game
 * actions require being a member of the room the game lives in. Sends the
 * appropriate error frame and returns null when the frame must be dropped.
 */
async function resolveGameForPlayer(
  ws: WebSocket,
  session: Session,
  db: DB,
  games: GameManager,
  gameId: unknown
): Promise<Game | null> {
  if (typeof gameId !== 'string') {
    wsError(ws, 'Invalid game id');
    return null;
  }
  const game = games.getGame(gameId);
  if (!game) {
    wsError(ws, 'game not found or has ended');
    return null;
  }
  if (!(await isRoomMember(db, session.userId, game.groupChatId))) {
    wsError(ws, 'Join this room before playing this game');
    return null;
  }
  return game;
}

function gameStatePayload(
  game: Game,
  map: Map<string, string>
): Record<string, unknown> {
  return {
    type: 'gameState',
    gameId: game.gameId,
    gameType: game.gameType,
    hostId: mapId(map, game.hostId),
    groupChatId: game.groupChatId,
    status: game.status,
    participantIds: game.participantIds.map((id) => mapId(map, id)),
    inactivePlayerIds: game.inactivePlayerIds.map((id) => mapId(map, id)),
  };
}
