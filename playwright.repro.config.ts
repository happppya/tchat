import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3001",
    headless: true,
  },
  webServer: [
    {
      command:
        "npm run build && npm run build:server && cross-env DATABASE_PATH=./test-database.db PORT=3001 EMPTY_ROOM_TTL_MS=2000 CLEANUP_INTERVAL_MS=500 RATE_LIMIT_AUTH_MAX=5000 RATE_LIMIT_UPLOAD_MAX=5000 RATE_LIMIT_GIF_MAX=5000 node dist-server/server.js",
      url: "http://127.0.0.1:3001/api/health",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});