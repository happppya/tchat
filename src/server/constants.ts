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

// Text messages can carry markdown/code blocks, so allow a roomier body than
// the old 300-char cap. Files are capped separately to protect the disk.
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Absolute path to the project root. The compiled server lives in
 * dist-server/src/server/constants.js, so three levels up is the repo root
 * (where dist/, uploads/, and index.html live). Centralized here so other
 * modules don't each guess a `__dirname`-relative depth.
 */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
