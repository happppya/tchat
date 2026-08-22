import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Keep deploy-target overrides in .env from leaking into unit tests:
    // with VITE_API_URL set, api.ts would fetch absolute URLs against the
    // deployed backend instead of the relative /api paths tests assert on.
    env: {
      VITE_API_URL: "",
      VITE_WS_URL: "",
    },
  },
});
