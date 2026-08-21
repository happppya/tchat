# tchat

A real-time group chat application.

- **Frontend:** React + TypeScript + Tailwind CSS (Vite)
- **Backend:** Express + SQLite + WebSockets (`ws`)
- **Real-time:** a single `/ws` connection broadcasts messages, edits, deletes, and reactions

## Features

- **Accounts** — sign up / log in with scrypt-hashed passwords and session cookies.
- **Rooms** — public rooms are discoverable in the **rooms** tab; private rooms are joined by their numeric code. Owners can delete rooms; members can leave.
- **Membership** — room membership is stored server-side, so it follows you across devices. Fully-empty rooms are deleted after a grace period.
- **Messages** — real-time text with Markdown and fenced code blocks, plus small file uploads (2 MB cap).
- **Message power tools** — edit or delete your own messages (edited messages show `(edited)`), reply with a quote, and react with emojis.
- **Profiles** — a bio and optional picture URL, shown as avatars in chat and viewable by clicking an author.
- **History** — cursor-based pagination with infinite scroll for large chats.
- **Themes** — switch color themes via the command palette (press `` ` ``).

## Prerequisites

- Node.js 18+
- A [GIPHY API key](https://developers.giphy.com/) (only needed for GIF search)

## Setup

```bash
npm install
```

Create a `.env` file for optional configuration:

```bash
# Required only for GIF search
GIPHY_API_KEY="your_key_here"
```

| Variable              | Default         | Purpose                                  |
| --------------------- | --------------- | ---------------------------------------- |
| `PORT`                | `3000`          | HTTP/WebSocket port                      |
| `DATABASE_PATH`       | `./database.db` | SQLite file location                     |
| `GIPHY_API_KEY`       | —               | GIPHY search key                         |
| `EMPTY_ROOM_TTL_MS`   | `86400000`      | How long an empty room lives (1 day)     |
| `CLEANUP_INTERVAL_MS` | `300000`        | How often empty rooms are reaped (5 min) |

## Development

Run the backend and the Vite dev server in two terminals:

```bash
# Terminal 1 — Express backend (port 3000)
npm start

# Terminal 2 — Vite dev server (port 5173)
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` and `/ws` to the backend.

## Production

```bash
npm run build   # typecheck + build the frontend into dist/
npm start       # compile the server (dist-server/) and serve the SPA
```

## Split hosting (Appwrite + Render)

You can host the SPA on Appwrite and the API on Render. Because they are
different origins, cookies and CORS need explicit configuration.

**Backend (Render)** — set the frontend origin(s):

```bash
# One or more comma-separated origins are supported:
FRONTEND_ORIGINS=https://<your-app>.appwrite.global,https://<staging>.appwrite.global
# …or allow any origin:
FRONTEND_ORIGINS=*
```

(The legacy single-value `FRONTEND_ORIGIN` still works.) This enables CORS
with credentials for those origins and marks the session cookie
`SameSite=None; Secure` so the Appwrite-hosted SPA can send it cross-origin.
(Render serves HTTPS, which `Secure` requires.)

**Frontend (Appwrite)** — set the API/WebSocket URLs at build time:

```bash
VITE_API_URL=https://<your-backend>.onrender.com/api
VITE_WS_URL=wss://<your-backend>.onrender.com/ws   # optional; derived from VITE_API_URL
```

Then run `npm run build` and deploy `dist/` to Appwrite.

## Testing

```bash
npm run typecheck
npm run test      # Playwright end-to-end suite
npm run test:unit # Vitest unit tests (mocked fetch)
```

The test suite starts the server against `./test-database.db` with short empty-room cleanup settings, so it doesn't touch a running development database.

## API overview

See `AGENTS.md` for the full endpoint and WebSocket reference.
