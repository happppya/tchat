import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
  },
  webServer: [
    {
      // Build the React app first so dist/ is available
      command: "npm run build",
      port: 0, // runs to completion, no port check
      reuseExistingServer: false,
    },
    {
      // Start the Express backend against a separate test DB
      // cross-env sets DATABASE_PATH portably across Windows/macOS/Linux
      command: "cross-env DATABASE_PATH=./test-database.db node server.js",
      url: "http://localhost:3000/api/health",
      reuseExistingServer: false,
      timeout: 10_000,
    },
  ],
});