import { WebSocketServer, WebSocket } from 'ws';
import type { Session } from './auth';
import { MAX_MESSAGE_LENGTH, MAX_WS_FRAME_BYTES } from './constants';
import {
  sqliteNow,
  validateGCID,
  isRoomMember,
  addMessageToTable,
  type DB,
} from './db';

interface Realtime {
  wss: WebSocketServer;
  broadcast: (payload: unknown, groupChatId?: number | null) => void;
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

  return { wss, broadcast };
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
export function attachMessageHandler({
  wss,
  db,
  broadcast,
}: {
  wss: WebSocketServer;
  db: DB;
  broadcast: (payload: unknown, groupChatId?: number | null) => void;
}): void {
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
        await handleFrame(message.toString(), { ws, session, db, broadcast });
      } catch (err) {
        console.error('[ws] failed to handle frame:', err);
        if (ws.readyState === WebSocket.OPEN) {
          wsError(ws, 'Message could not be processed');
        }
      }
    });

    ws.on('close', () => {
      console.log('Client has disconnected');
    });
  });
}

/**
 * Validate one client frame, store the message, and return the clean echo
 * payload to broadcast. Throws on invalid input; the connection handler turns
 * that into an error frame.
 */
async function handleFrame(
  messageString: string,
  ctx: { ws: WebSocket; session: Session; db: DB; broadcast: Realtime['broadcast'] }
): Promise<void> {
  const { ws, session, db, broadcast } = ctx;
  console.log(`Received: ${messageString}`);

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
  } = messageJSON;
  // The display name is always the authenticated username — clients cannot
  // spoof another user's identity.
  const displayNameText = session.username;

  if (type === 'ping') {
    ws.send(JSON.stringify({ type: 'pong' }));
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
    replyAuthor
  );

  // Broadcast a rebuilt payload instead of the raw parsed client object so no
  // extra properties a client smuggles into its frame are relayed verbatim to
  // every connected user. Scoped to the room's members only.
  broadcast(
    {
      type: 'message',
      id: messageId,
      userId: session.userId,
      groupChatId,
      messageText,
      gifUrl,
      displayNameText,
      avatarUrl,
      timestamp: sqliteTextTimestamp,
      fileUrl,
      fileName,
      fileType,
      replyToId: replyToIdValue,
      replyQuote,
      replyAuthor,
    },
    groupChatId
  );
}
