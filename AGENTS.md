# tchat — Agent Guide

A real-time group chat application.

| Layer       | Technology                          |
| ----------- | ----------------------------------- |
| Frontend    | React 19, TypeScript, Tailwind CSS  |
| Build       | Vite                                |
| Routing     | React Router                        |
| Backend     | Express 5, Node.js                  |
| Real-time   | WebSocket (`ws`)                    |
| Database    | SQLite (via `sqlite` + `sqlite3`)   |
| GIFs        | GIPHY API                           |
| Tests       | Playwright                          |

## Project Structure

```
src/
├── components/            # Reusable UI components
│   ├── Avatar.tsx         # Picture image with initials fallback
│   ├── ChatWindow.tsx     # Chat area: header, list, composer, reply state
│   ├── CommandPalette.tsx # Backtick-launched command menu (themes, actions)
│   ├── CreateGroupChat.tsx# New-room form (code, name, public/private)
│   ├── GifPicker.tsx      # GIPHY search overlay
│   ├── Markdown.tsx       # Safe markdown renderer (code blocks, links)
│   ├── MessageBubble.tsx  # Message groups: quotes, reactions, edit/delete
│   ├── MessageComposer.tsx# Input + upload/GIF + reply preview
│   ├── ProfileModal.tsx   # View/edit profiles
│   └── Sidebar.tsx        # Channels/rooms tabs + join input
├── hooks/                 # Custom React hooks
│   ├── useAuth.ts         # Global auth store (session check, login/logout)
│   ├── useGifSearch.ts    # GIF search state
│   ├── useMessages.ts     # Message fetch, pagination, edit/delete/reactions
│   └── useWebSocket.ts    # Single reconnectable /ws connection
├── pages/                 # Route-level components
│   ├── ChatPage.tsx       # Main chat layout orchestration
│   ├── LoginPage.tsx      # Login form
│   └── SignupPage.tsx     # Signup form
├── server/
│   ├── auth.ts            # scrypt hashing + SQLite sessions + middleware
│   ├── constants.ts       # Shared limits (room code, message length, TTLs)
│   ├── db.ts              # SQLite open + migrations + data-access helpers
│   ├── realtime.ts        # WebSocket server, broadcast, message handler
│   ├── routes.ts          # Express API router factory
│   └── cli.ts             # Readline admin CLI
├── services/
│   ├── api.ts             # Typed REST client (shared request helper)
│   └── storage.ts         # localStorage helpers for cached rooms
├── themes/
│   ├── themes.ts          # Theme definitions
│   └── useTheme.ts        # Theme store + CSS-variable application
├── types/index.ts         # Shared TypeScript types
├── utils/
│   ├── format.ts          # Timestamps, grouping, previews
│   └── markdown.ts        # XSS-safe markdown-to-React transform
├── constants.ts           # Shared limits (room code, page size, message length)
├── App.tsx                # Routing + auth guards
└── main.tsx               # React entry point

server.ts                  # Entry point: HTTP app, static serving, module wiring
```

## Commands

```bash
npm install
npm run dev        # Vite dev server (proxies /api and /ws to :3000)
npm start          # Express server
npm run build        # typecheck + build the frontend into dist/
npm run build:server # compile the backend to dist-server/
npm start            # build:server + run dist-server/server.js
npm run typecheck    # typecheck both the frontend and the backend
npm run test         # Playwright suite (self-hosted on :3000)
npm run test:unit    # Vitest unit tests (src/**/*.test.ts, mocked fetch)
```

The backend is TypeScript compiled to CommonJS into `dist-server/` via
`tsconfig.server.json`. The Playwright config builds both and starts
`dist-server/server.js` against `./test-database.db` with
`EMPTY_ROOM_TTL_MS=2000 CLEANUP_INTERVAL_MS=500`.

## Backend conventions

- **Migrations** live in `src/server/db.ts` as idempotent helpers (`ensure*`)
  that `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS` based on `PRAGMA
  table_info`, and are invoked by `runMigrations()` (called from
  `openDatabase()`). Follow that pattern for new columns/tables.
- **Data access** helpers in `db.ts` take the `db` handle as their first
  argument (e.g. `validateGCID(db, id)`) rather than closing over a global.
- **Room codes** are 1–6 digit positive integers. Use `parseRoomCode(value)`
  (in `routes.ts`) for validation; it returns `null` when invalid.
- **Message ids** are positive integers. Use `parseMessageId(value)` (in
  `routes.ts`).
- **Message ordering** is `sent_at DESC, id DESC`; pagination uses a keyset
  cursor `(beforeSentAt, beforeId)` against the
  `idx_messages_gc_sent_id (group_chat_id, sent_at, id)` index — never OFFSET.
- **Ownership** checks use the `user_id` column on messages and
  `owner_user_id` on rooms; never trust `display_name` for identity.
- **WebSocket** clients are authenticated during the HTTP upgrade via the
  session cookie (`readSession`), and the session is stashed on `ws.session`.
- **Broadcasts** go through `broadcast(payload)`; every client filters events by
  `groupChatId`.

## API Endpoints

| Method | Path                    | Auth | Description                          |
| ------ | ----------------------- | ---- | ------------------------------------ |
| GET    | `/api/health`           | no   | Liveness check                       |
| POST   | `/api/signup`           | no   | Create account + session             |
| POST   | `/api/login`            | no   | Create session                       |
| POST   | `/api/logout`           | no   | Destroy session                      |
| GET    | `/api/me`               | yes  | Current user (id, username, bio, pic)|
| GET    | `/api/profile/:username`| yes  | Public profile                       |
| PUT    | `/api/profile`          | yes  | Update own bio + picture             |
| POST   | `/api/createGC`         | yes  | Create room (`id`, `name`, `isPublic`)|
| GET    | `/api/getGCInfo`        | yes  | Room info by `groupChatId`           |
| DELETE | `/api/deleteGC`         | yes  | Delete room (owner only)             |
| GET    | `/api/myRooms`          | yes  | Rooms the current user is in         |
| GET    | `/api/publicRooms`      | yes  | Discoverable public rooms            |
| POST   | `/api/joinRoom`         | yes  | Join room by `groupChatId` (idempotent)|
| POST   | `/api/leaveRoom`        | yes  | Leave room                           |
| GET    | `/api/getMessages`      | yes  | Paged messages (cursor-based)        |
| PUT    | `/api/editMessage`      | yes  | Edit own message text                |
| DELETE | `/api/deleteMessage`    | yes  | Delete own message                   |
| POST   | `/api/reactToMessage`   | yes  | Toggle emoji reaction                |
| POST   | `/api/upload`           | yes  | Upload a small file (base64 data URL)|
| GET    | `/api/searchGifs`       | yes  | GIPHY search                         |

`GET /api/getMessages` query params: `groupChatId`, `limit` (1–100, default
50), and optional `beforeSentAt` + `beforeId` (must be supplied together) for
the previous page.

## WebSocket protocol

Connect to `/ws`. The client sends JSON frames; the server broadcasts JSON
frames to every connected client.

Client → server:

```json
{ "type": "message", "groupChatId": 1234, "messageText": "hi",
  "gifUrl": null, "fileUrl": null, "fileName": null, "fileType": null,
  "replyToId": null }
```

`{ "type": "ping" }` is answered with `{ "type": "pong" }`.

Server → client:

- `message` — a stored message (includes real `id`, `userId`, `displayNameText`,
  `avatarUrl`, `timestamp`, and reply fields)
- `editMessage` — `{ messageId, messageText, editedAt }`
- `deleteMessage` — `{ messageId }`
- `messageReactions` — `{ messageId, reactions: [{ emoji, count, me }] }`
- `error` — `{ messageText }`
- `pong`
