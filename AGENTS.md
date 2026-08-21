# Chat App

A real-time group chat application with GIF support, built with React + TypeScript + Tailwind CSS on the frontend and Express + SQLite + WebSocket on the backend.

## Tech Stack

| Layer       | Technology                          |
| ----------- | ----------------------------------- |
| Frontend    | React 19, TypeScript, Tailwind CSS  |
| Build       | Vite                                |
| Routing     | React Router                        |
| Backend     | Express 5, Node.js                  |
| Real-time   | WebSocket (ws)                      |
| Database    | SQLite (via `sqlite` + `sqlite3`)   |
| GIFs        | GIPHY API                           |

## Project Structure

```
src/
├── components/        # Reusable UI components
│   ├── ChatWindow.tsx       # Main chat area with messages + composer
│   ├── CreateGroupChat.tsx  # Form to create new group chats
│   ├── GifPicker.tsx        # GIPHY search and selection modal
│   ├── MessageBubble.tsx    # Single message display
│   ├── MessageComposer.tsx  # Text input, GIF button, display name
│   └── Sidebar.tsx          # Navigation sidebar with saved GCs
├── hooks/             # Custom React hooks
│   ├── useGifSearch.ts      # GIF search state
│   ├── useMessages.ts       # Message fetch + real-time updates
│   └── useWebSocket.ts      # WebSocket connection management
├── pages/             # Route-level page components
│   ├── ChatPage.tsx         # Main chat page (orchestrates layout)
│   ├── LoginPage.tsx        # Login form
│   └── SignupPage.tsx       # Sign up form
├── services/          # API + storage abstraction
│   ├── api.ts               # REST API calls
│   └── storage.ts           # localStorage helpers
├── types/             # TypeScript type definitions
│   └── index.ts
├── utils/             # Pure utility functions
│   └── format.ts            # Date formatting, string utils
├── App.tsx            # Root component with routing
├── main.tsx           # React entry point
└── index.css          # Global styles + Tailwind
```

## Getting Started

### Prerequisites

- Node.js 18+
- A [GIPHY API key](https://developers.giphy.com/)

### Setup

```bash
# Clone and install
git clone <repo-url>
cd chat-app-thing
npm install

# Create .env with your GIPHY API key
echo 'GIPHY_API_KEY="your_key_here"' > .env
```

### Development

Run both the Express backend and Vite dev server:

```bash
# Terminal 1: Start the backend (port 3000)
npm start

# Terminal 2: Start the frontend dev server (port 5173)
npm run dev
```

The Vite dev server proxies `/api` and `/ws` requests to the Express backend. Open `http://localhost:5173` in your browser.

### Production Build

```bash
# Build the React app
npm run build

# Start the server (serves built files from dist/)
npm start
```

The Express server will serve the React SPA from `dist/` and fall back to `index.html` for client-side routing.

### Type Checking

```bash
npm run typecheck
```

## API Endpoints

| Method | Path             | Description                |
| ------ | ---------------- | -------------------------- |
| GET    | `/api/getMessages` | Fetch messages for a GC   |
| GET    | `/api/getGCInfo`   | Get group chat info       |
| POST   | `/api/createGC`    | Create a new group chat   |
| GET    | `/api/searchGifs`  | Search GIPHY              |

## WebSocket

Connect to `/ws`. Messages use JSON with the following shape:

```json
{
  "type": "message",
  "groupChatId": 1234,
  "messageText": "Hello!",
  "displayNameText": "Alice",
  "gifUrl": null
}
```

## Chrome Extension

`popup.html` and `manifest.json` provide Chrome extension support. Update `popup.html`'s iframe `src` to point to your deployed URL.