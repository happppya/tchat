/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute base URL of the REST API (e.g. https://api.example.com/api). */
  readonly VITE_API_URL?: string;
  /** Absolute WebSocket URL (e.g. wss://api.example.com/ws). Optional. */
  readonly VITE_WS_URL?: string;
}
