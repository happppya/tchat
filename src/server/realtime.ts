import { WebSocketServer, WebSocket } from 'ws';
import type { Session } from './auth';
import { MAX_MESSAGE_LENGTH } from './constants';
import { sqliteNow, validateGCID, addMessageToTable, type DB } from './db';

interface Realtime {
  wss: WebSocketServer;
  broadcast: (payload: unknown) => void;
}

type AuthedSocket = WebSocket & { session?: Session };

/**
 * Create the WebSocket server plus its broadcast helper. Both are returned
 * together so the route layer and the message handler share the same wss.
 */
export function createRealtime(): Realtime {
  const wss = new WebSocketServer({ noServer: true });

  function broadcast(payload: unknown): void {
    const data = JSON.stringify(payload);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
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
  broadcast: (payload: unknown) => void;
}): void {
  wss.on('connection', (rawWs: WebSocket) => {
    const ws = rawWs as AuthedSocket;
    const session = ws.session;
    if (!session) {
      ws.close(1008, 'Authentication required');
      return;
    }
    console.log(`Client connected: ${session.username}`);

    ws.on('message', async (message) => {
      const messageString = message.toString();
      console.log(`Received: ${messageString}`);

      // The dynamic shape is validated field-by-field below.
      const messageJSON: Record<string, any> = JSON.parse(messageString);
      const returnJSON: Record<string, any> = {};
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
        returnJSON.type = 'pong';
        ws.send(JSON.stringify(returnJSON));
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

      console.log('Message: ' + messageText, 'Display Name: ' + displayNameText);

      // Attach the sender's current profile picture so live recipients can
      // render the avatar without another lookup.
      const sender = await db.get('SELECT picture_url FROM users WHERE id = ?', [
        session.userId,
      ]);
      const avatarUrl = sender ? sender.picture_url : null;

      const sqliteTextTimestamp = sqliteNow();
      messageJSON.timestamp = sqliteTextTimestamp;
      messageJSON.type = 'message';
      messageJSON.displayNameText = displayNameText;
      messageJSON.avatarUrl = avatarUrl;
      messageJSON.fileUrl = fileUrl;
      messageJSON.fileName = fileName;
      messageJSON.fileType = fileType;
      messageJSON.replyToId = replyToIdValue;
      messageJSON.replyQuote = replyQuote;
      messageJSON.replyAuthor = replyAuthor;

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
      messageJSON.id = messageId;
      messageJSON.userId = session.userId;
      broadcast(messageJSON);
    });

    ws.on('close', () => {
      console.log('Client has disconnected');
    });
  });
}
