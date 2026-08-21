import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    // Use 127.0.0.1 (IPv4) so the health check matches the server's IPv4
    // listener. Node resolves "localhost" to "::1" (IPv6) first on some
    // systems, causing spurious ECONNREFUSED ::1 during webServer startup.
    baseURL: "http://127.0.0.1:3000",
    headless: true,
  },
  webServer: [
    {
      // Build the React app, then start the Express backend against a test DB.
      // Both run in a single webServer entry so the build is guaranteed to
      // finish (dist/ fully written) before the server starts listening —
      // otherwise Playwright starts the two entries in parallel and the server
      // serves a half-built dist/, producing wrong MIME types / 404s for the
      // JS/CSS assets (the app never mounts).
      command:
        "npm run build && npm run build:server && cross-env DATABASE_PATH=./test-database.db PORT=3000 EMPTY_ROOM_TTL_MS=2000 CLEANUP_INTERVAL_MS=500 node dist-server/server.js",
      url: "http://127.0.0.1:3000/api/health",
      // PORT=3000 is set explicitly so an ambient PORT (e.g. PORT=0 leaked into
      // the shell) doesn't make the server bind a random port.
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
