/** Maximum number of digits allowed in a room code (also enforced server-side). */
export const MAX_GC_ID_DIGITS = 6;

/** Number of messages fetched per page (chat open + scroll-up pagination). */
export const MESSAGES_PAGE_SIZE = 50;

/** Maximum characters allowed in a single chat message (mirrors the server). */
export const MAX_MESSAGE_LENGTH = 4000;

/** Largest attachment size the client will attempt to upload (2 MB). */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
