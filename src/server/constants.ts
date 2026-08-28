import path from 'path';

/**
 * Shared server constants. Env-tunable values are read at require time, so the
 * entry point (server.ts) must load dotenv before these modules are imported.
 */

// Room codes are numeric IDs. Cap their length so codes stay short and
// greppable (matches the 6-digit codes the tests generate).
export const MAX_GC_ID_DIGITS = 6;

// A room with no members is "empty". Give it a grace period, then delete it
// (and its messages) in the background. Both knobs are env-tunable for tests.
export const EMPTY_ROOM_TTL_MS =
  Number(process.env.EMPTY_ROOM_TTL_MS) || 24 * 60 * 60 * 1000;
export const CLEANUP_INTERVAL_MS =
  Number(process.env.CLEANUP_INTERVAL_MS) || 5 * 60 * 1000;

/** Split a comma-separated env string into trimmed, normalized origins. */
function parseOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => origin.replace(/\/+$/, ''));
}

/**
 * Origins of separately-hosted frontends (e.g. Appwrite deployments). When any
 * are configured, the server enables CORS for those origins and marks the
 * session cookie SameSite=None so cross-origin requests carry it.
 *
 * Read from FRONTEND_ORIGINS as a comma-separated list; the legacy single-value
 * FRONTEND_ORIGIN is still accepted as a fallback. A lone `*` entry means
 * "allow any origin". Empty = same-origin deploy.
 */
export const FRONTEND_ORIGINS = parseOrigins(
  process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || ''
);

/** True when `*` is configured: accept requests from any origin. */
export const ALLOW_ALL_ORIGINS = FRONTEND_ORIGINS.includes('*');

/** Session cookie SameSite policy: cross-site when a separate frontend origin is configured. */
export const COOKIE_SAME_SITE: 'Lax' | 'None' =
  FRONTEND_ORIGINS.length > 0 ? 'None' : 'Lax';

/** True when `origin` is one of the configured frontend origins (for CORS). */
export function isConfiguredFrontendOrigin(
  origin: string | undefined
): boolean {
  if (ALLOW_ALL_ORIGINS) return !!origin;
  return !!origin && FRONTEND_ORIGINS.includes(origin);
}

/**
 * Whether a WebSocket handshake may come from `origin`. When no origins are
 * configured there is no restriction; non-browser clients that send no Origin
 * header are always allowed.
 */
export function isAllowedWsOrigin(origin: string | undefined): boolean {
  if (ALLOW_ALL_ORIGINS) return true;
  if (FRONTEND_ORIGINS.length === 0) return true;
  if (!origin) return true;
  return FRONTEND_ORIGINS.includes(origin);
}

// Hard cap on message text (mirrored client-side in src/constants.ts). Kept
// small so a single client can't flood a room with giant bodies. Files are
// capped separately to protect the disk.
export const MAX_MESSAGE_LENGTH = 250;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB

// WebSocket frames are tiny (≤250-char text + metadata). Capping the frame
// size keeps one malicious client from making the server buffer ~100 MiB
// frames (the ws library's default maxPayload) and rebroadcasting them.
export const MAX_WS_FRAME_BYTES = 64 * 1024;

/**
 * Upload MIME allowlist. Everything else is rejected outright: types that can
 * execute script when served same-origin (SVG, HTML) must never be stored,
 * even though uploaded filenames are randomized.
 */
export const ALLOWED_UPLOAD_MIMES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/json",
  "application/zip",
  "application/x-zip-compressed",
]);

// Rate limiting. Login/signup burn real CPU (scrypt), uploads write disk, and
// gif search spends GIPHY quota — each gets its own request bucket per client
// IP. All knobs are env-tunable (the Playwright suite raises them so e2e
// traffic from a single 127.0.0.1 address never trips the limits).
export const RATE_LIMIT_WINDOW_MS =
  Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
export const RATE_LIMIT_AUTH_MAX = Number(process.env.RATE_LIMIT_AUTH_MAX) || 30;
export const RATE_LIMIT_UPLOAD_MAX =
  Number(process.env.RATE_LIMIT_UPLOAD_MAX) || 60;
export const RATE_LIMIT_GIF_MAX = Number(process.env.RATE_LIMIT_GIF_MAX) || 120;

/**
 * Absolute path to the project root. The compiled server lives in
 * dist-server/src/server/constants.js, so three levels up is the repo root
 * (where dist/, uploads/, and index.html live). Centralized here so other
 * modules don't each guess a `__dirname`-relative depth.
 */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
