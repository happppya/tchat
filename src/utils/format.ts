/**
 * Format an SQLite timestamp string into a localized, human-readable form.
 */
export function formatTimestamp(timestampStr: string | null | undefined): string {
  if (!timestampStr) return "";

  const utcTimestamp = timestampStr.includes("T")
    ? `${timestampStr}Z`
    : `${timestampStr.replace(" ", "T")}Z`;

  const date = new Date(utcTimestamp);

  if (isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
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