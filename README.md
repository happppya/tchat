# Chat App Thingy

## August 2026

Greetings Gitters and Hubbers! This repository is meant to hold the codes for our Chat app website thing with the most eloquent of posterities. The device of dine shall be most sufficient in running the fruits of our labors! We used the finest VS code to code most of it.
PLEASE BE ADVISED<<< some things are omitted for the sake of security and for other reasons. 

#GIFS WONT WORK WITHOUT AN API KEY
get a giphy api key and inside a folder named .env put in GIPHY_API_KEY="\<insert key\>"

login.html, signup.html, manifest.json, and popup.html are currently just hopes and dreams and aren't part of the site

## Usage

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