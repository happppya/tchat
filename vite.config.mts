import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
    // The backend writes volatile artifacts into the project root while the
    // dev server runs (SQLite WAL sidecars on every message since WAL mode,
    // uploads, logs). Without these ignores, each write makes Vite broadcast
    // a full-reload and the browser refreshes mid-chat.
    watch: {
      ignored: [
        "**/uploads/**",
        "**/*.db",
        "**/*.db-shm",
        "**/*.db-journal",
        "**/*.db-wal",
        "**/*.log",
        "**/dist/**",
        "**/dist-server/**",
        "**/test-results/**",
        "**/playwright-report/**",
      ],
    },
  },
  build: {
    outDir: "dist",
  },
});