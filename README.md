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

## Testing

```bash
npm run typecheck
npm run test      # Playwright end-to-end suite
```

The test suite starts the server against `./test-database.db` with short empty-room cleanup settings, so it doesn't touch a running development database.

## API overview

See `AGENTS.md` for the full endpoint and WebSocket reference.
