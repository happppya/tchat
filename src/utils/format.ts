import type { Message } from "../types";

/**
 * Format an SQLite timestamp string into a localized, human-readable form.
 */
export function formatTimestamp(timestampStr: string | null | undefined): string {
  const ms = parseTimestampMs(timestampStr ?? "");
  if (ms === null) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(ms));
}

/**
 * Strip non-ASCII characters from a string.
 */
export function stripNonAscii(str: string): string {
  return str.replace(/[^\x00-\x7F]/g, "");
}

/**
 * Truncate a string to maxLen, appending "..." if truncated.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "...";
}

/**
 * A short human-readable preview of a message for reply quotes: the body text,
 * an attachment name, or "GIF" for gif-only messages.
 */
export function messagePreview(message: Message): string {
  if (message.message_text) return message.message_text;
  if (message.file_url) return `📎 ${message.file_name || "attachment"}`;
  if (message.gif_url) return "GIF";
  return "";
}

/**
 * Maximum gap (ms) between two messages from the same author before they are
 * split into separate groups. Messages within this window are collapsed into a
 * single "block" with a shared header.
 */
export const GROUP_GAP_MS = 5 * 60 * 1000; // 5 minutes

export interface MessageGroup {
  /** Stable key for the group — author + first message id. */
  key: string;
  displayName: string;
  /** Real username (may differ from displayName in anonymous rooms). */
  username: string | null;
  /** Author avatar captured on the first message of the group. */
  avatarUrl: string | null;
  /** The first timestamp in the group (for the header). */
  firstSentAt: string;
  messages: Message[];
}

/**
 * Group an ordered (oldest→newest) message list into consecutive runs from the
 * same author. A run ends when the author changes or the gap between messages
 * exceeds GROUP_GAP_MS.
 */
export function groupMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let prev: Message | null = null;
  let prevTs: number | null = null;

  for (const msg of messages) {
    const author = msg.display_name || "unknown";
    const ts = parseTimestampMs(msg.sent_at);
    const sameAuthor = prev && (prev.display_name || "unknown") === author;
    const withinGap = prevTs !== null && ts !== null && ts - prevTs <= GROUP_GAP_MS;

    if (sameAuthor && withinGap && groups.length > 0) {
      groups[groups.length - 1].messages.push(msg);
    } else {
      groups.push({
        key: `${author}-${msg.id}`,
        displayName: author,
        username: msg.username ?? null,
        avatarUrl: msg.avatar_url ?? null,
        firstSentAt: msg.sent_at,
        messages: [msg],
      });
    }
    prev = msg;
    prevTs = ts;
  }
  return groups;
}

/** Parse a (possibly SQLite-style) timestamp into epoch ms. */
function parseTimestampMs(s: string): number | null {
  if (!s) return null;
  const utc = s.includes("T") ? `${s}Z` : `${s.replace(" ", "T")}Z`;
  const d = new Date(utc);
  return isNaN(d.getTime()) ? null : d.getTime();
}

/**
 * Compact time label for a message group header.
 */
export function formatGroupTime(s: string): string {
  const ms = parseTimestampMs(s);
  if (ms === null) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}