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
│   ├── CreateGroupChat.tsx# New-room form (code, name, type toggles)
│   ├── GifPicker.tsx      # GIPHY search overlay
│   ├── Markdown.tsx       # Safe markdown renderer (code blocks, links, room links)
│   ├── MessageBubble.tsx  # Message groups: quotes, reactions, edit/delete, staff menu
│   ├── MessageComposer.tsx# Input + upload/GIF + reply preview + slash popover
│   ├── ProfileModal.tsx   # View/edit profiles (shows admin/owner badges)
│   └── Sidebar.tsx        # My Rooms / Board tabs, groups, drag-and-drop, join input
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
│   └── storage.ts         # localStorage helpers for cached rooms + local groups
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

| Method | Path                         | Auth | Description                                  |
| ------ | ---------------------------- | ---- | -------------------------------------------- |
| GET    | `/api/health`                | no   | Liveness check                               |
| POST   | `/api/signup`                | no   | Create account + session (auto-joins Room 0) |
| POST   | `/api/login`                 | no   | Create session (auto-joins Room 0)           |
| POST   | `/api/logout`                | no   | Destroy session                              |
| GET    | `/api/me`                    | yes  | Current user (id, username, isAdmin, bio, pic)|
| GET    | `/api/profile/:username`     | yes  | Public profile (isAdmin, isRoomOwner badges) |
| PUT    | `/api/profile`               | yes  | Update own bio + picture                     |
| POST   | `/api/createGC`              | yes  | Create room (admin only). Body: `id`, `name`, `isHidden`, `password`, `isReadonly`, `isAnonymous`, `isTransparent`, `isPublic` |
| GET    | `/api/getGCInfo`             | yes  | Room info by `groupChatId`. Includes `viewer_is_staff`. Strips `password_hash` from non-admins. |
| DELETE | `/api/deleteGC`              | yes  | Delete room (owner or admin). Admins can delete Room 0. Broadcasts `deleteRoom`. |
| GET    | `/api/myRooms`               | yes  | Rooms the current user is a member of        |
| GET    | `/api/publicRooms`           | yes  | Public rooms (`is_public = 1`) for the board |
| POST   | `/api/joinRoom`              | yes  | Join room by `groupChatId` + optional `password`. Idempotent. Admins bypass ban/password. |
| POST   | `/api/leaveRoom`             | yes  | Leave room (not Room 0)                      |
| GET    | `/api/getMessages`           | yes  | Paged messages (cursor-based). Anon rooms strip `user_id` for non-admins. |
| PUT    | `/api/editMessage`           | yes  | Edit own message (admin can edit any)        |
| DELETE | `/api/deleteMessage`         | yes  | Delete own message (admin can delete any)    |
| POST   | `/api/reactToMessage`        | yes  | Toggle emoji reaction                        |
| POST   | `/api/roomCommand`           | yes  | Moderation: `kick`, `ban`, `unban`, `mute`, `unmute`, `mod`, `demod` with `targetUsername` (site admins may moderate Room 0; commands are idempotent) |
| GET    | `/api/roomUserStatus`        | yes  | Live `muted`/`isMod` status of a user in a room (staff only), for the name context menu |
| GET    | `/api/roomMutes`             | yes  | List muted users in a room (staff only), for the mute-list panel |
| GET    | `/api/roomBans`              | yes  | List banned users in a room (staff only), for the ban-list panel |
| POST   | `/api/upload`                | yes  | Upload a small file (base64 data URL)        |
| GET    | `/api/searchGifs`            | yes  | GIPHY search                                 |
| GET    | `/api/boardGroups`           | yes  | Board groups with room ids                   |
| POST   | `/api/boardGroups`           | yes  | Create board group (admin only)              |
| PUT    | `/api/boardGroups/:id`       | yes  | Rename board group (admin only)              |
| DELETE | `/api/boardGroups/:id`       | yes  | Delete board group (admin only)              |
| POST   | `/api/boardGroups/reorder`   | yes  | Reorder board groups (admin only)            |
| POST   | `/api/boardGroups/:id/rooms` | yes  | Add room to board group (admin only)         |
| DELETE | `/api/boardGroups/rooms/:roomId` | yes | Remove room from board group (admin only) |
| POST   | `/api/boardGroups/:id/reorder-rooms` | yes | Reorder rooms within a group (admin only) |

`GET /api/getMessages` query params: `groupChatId`, `limit` (1–100, default
50), and optional `beforeSentAt` + `beforeId` (must be supplied together) for
the previous page.

## Room types

Rooms have non-exclusive flags set at creation time (admin only):

| Flag           | Column           | Effect                                              |
| -------------- | ---------------- | --------------------------------------------------- |
| Hidden         | `is_hidden`      | Requires a password (`>8` chars) to join            |
| Readonly       | `is_readonly`    | Only admins can speak (muted for everyone else)     |
| Anonymous      | `is_anonymous`   | Random display names, profiles hidden, userId stripped for non-admins |
| Transparent    | `is_transparent` | Standard names (default behavior)                   |
| Public         | `is_public`      | Appears on the board tab; private rooms are code-only |

Hidden rooms are excluded from `/publicRooms` regardless of `is_public`.

Room rows in the sidebar show shorthand type tags derived from `roomTypeTags`
(`src/utils/roomTypes.ts`): `[A]` anonymous, `[H]` hidden, `[R]` readonly,
`[T]` transparent, `[P]` public. The active room's chat header shows the full
names ("anonymous", "readonly", …). The shorthand never changes without the
header name — both come from the same ordered list.

Rooms can be renamed by the room owner or any admin (mirrored client-side by
`canRenameRoom` in `src/utils/roomPerms.ts`): an ✎ button appears on hover in
both the sidebar and the chat header. PUT `/renameRoom` broadcasts a
`renameRoom` WS message; clients update the saved list (`renameSavedGC`),
the chat header, and the board list.

## Cloud Run deployment (persistent SQLite)

The app is deployed with `gcloud run deploy tchat --source .`. Cloud Run
instances are stateless — `database.db` on the container's ephemeral disk is
wiped on every deploy/cold start. To make it survive redeploys, mount a Cloud
Storage bucket as a volume:

```bash
# 1. Bucket (same region as the service)
gcloud storage buckets create gs://tchat-data --location=<REGION>

# 2. Let the Cloud Run runtime service account write to it
#    (default: <PROJECT_NUMBER>-compute@developer.gserviceaccount.com)
gcloud storage buckets add-iam-policy-binding gs://tchat-data \
  --member=serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com \
  --role=roles/storage.objectAdmin

# 3. Deploy with the volume mounted, pinned to ONE instance, and SQLite in
#    journal_mode=delete
#
#    Cloud Storage FUSE provides NO real file locking, so WAL mode (which
#    relies on -wal/-shm lock files) can corrupt the DB there. The safe combo
#    is a single instance + non-WAL journal mode.
gcloud run deploy tchat --source . \
  --region=<REGION> \
  --max-instances=1 \
  --add-volume=name=data,type=cloud-storage,bucket=tchat-data \
  --add-volume-mount=volume=data,mount-path=/data \
  --set-env-vars=DATABASE_PATH=/data/database.db,SQLITE_JOURNAL_MODE=delete,UPLOAD_DIR=/data/uploads \
  --update-env-vars=ADMIN_SECRET=<your-secret>
```

Carrying over an existing database (stop the local server first so the WAL
is checkpointed):

```bash
gcloud storage cp database.db gs://tchat-data/database.db
gcloud storage cp -r uploads gs://tchat-data/uploads
```

The server opens `SQLITE_JOURNAL_MODE` (default `wal`) and `UPLOAD_DIR`
(default `./uploads`) at startup; both are read in `openDatabase()` and
`server.ts`/`routes.ts` respectively. On FUSE mounts, expect slower first
writes (object-store latency) — fine for low-traffic apps.

## Role system

- **Site admins** — `users.is_admin = 1`. Set manually via SQL. Immune to all
  room-level moderation. Can create rooms, delete any room, edit/delete any
  message, see userIds in anonymous rooms, manage board groups.
- **Room owners** — `group_chats.owner_user_id`. Created the room. Can delete
  it, promote/demote moderators.
- **Room moderators** — `room_moderators` table. Elevated by owners/admins.
  Can kick, ban, mute. Cannot promote/demote others.
- **Admins + owners + mods** = "room staff" (`viewer_is_staff` in `getGCInfo`).

## Groups (sidebar)

Two independent group systems:

- **Local groups** ("my rooms" tab) — stored in `localStorage` under
  `tchat:local-groups`. Created with Shift+G or `[ +group ]`. Drag rooms
  in/out, reorder rooms and groups, rename, delete (rooms spill to top
  level). Folds with ▸/▾ toggle. Rooms are removed from the list via a
  hover delete button (✕) — there is no right-click delete.
- **Board groups** ("board" tab) — stored server-side in `board_groups` +
  `board_group_rooms`. Admin-only mutations via the board group API. Same
  drag-and-drop UX as local groups. Creating a board group has no keyboard
  shortcut.

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

- `message` — a stored message (includes real `id`, `userId`, `username`,
  `displayNameText`, `avatarUrl`, `timestamp`, `speaker`, and reply fields)
- `editMessage` — `{ groupChatId, messageId, messageText, editedAt }`
- `deleteMessage` — `{ groupChatId, messageId }`
- `deleteRoom` — `{ groupChatId }` (broadcast when a room is deleted)
- `kicked` — `{ groupChatId, message }` (sent to the kicked user only)
- `banned` — `{ groupChatId, message }` (sent to the banned user only)
- `messageReactions` — `{ groupChatId, messageId, reactions: [{ emoji, count, me }] }`
- `error` — `{ message: string }`
- `pong`

`speaker` is `null` for normal users and `"sys"` for system messages (e.g.
`/help` output). The client renders a verified badge for non-null speakers.

Client → server additions:

- `{ type: "help", groupChatId, page }` — requests paged command help from the system bot
