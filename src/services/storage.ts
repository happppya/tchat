import type { SavedGC } from "../types";

const STORAGE_KEYS = {
  SAVED_GC_LIST: "savedGCList",
  DISPLAY_NAME: "displayName",
} as const;

/** Fired on this window whenever the saved-GC list changes. */
export const GCS_CHANGED_EVENT = "termchat:gcs-changed";

function notifyGCsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(GCS_CHANGED_EVENT));
  }
}

/** Get saved group chats from localStorage */
export function getSavedGCs(): SavedGC[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SAVED_GC_LIST);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Replace the saved-GC list wholesale (used to sync server rooms into the cache). */
export function saveGCList(list: SavedGC[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SAVED_GC_LIST, JSON.stringify(list));
    notifyGCsChanged();
  } catch {
    // localStorage may be unavailable
  }
}

/**
 * Merge two saved-GC lists by id, keeping `primary` first (server rooms) and
 * appending `fallback` entries (local cache) that aren't already present.
 */
export function mergeSavedGCs(primary: SavedGC[], fallback: SavedGC[]): SavedGC[] {
  const seen = new Set<number>();
  const merged: SavedGC[] = [];
  for (const gc of [...primary, ...fallback]) {
    if (seen.has(gc.id)) continue;
    seen.add(gc.id);
    merged.push(gc);
  }
  return merged;
}

/** Save a group chat to localStorage (moves to top if already exists) */
export function saveGC(id: number, name: string): void {
  const list = getSavedGCs();
  const filtered = list.filter((gc) => gc.id !== id);
  filtered.push({ id, name });
  localStorage.setItem(STORAGE_KEYS.SAVED_GC_LIST, JSON.stringify(filtered));
  notifyGCsChanged();
}

/** Remove a group chat from localStorage */
export function removeGC(id: number): void {
  const list = getSavedGCs().filter((gc) => gc.id !== id);
  localStorage.setItem(STORAGE_KEYS.SAVED_GC_LIST, JSON.stringify(list));
  notifyGCsChanged();
}

/** Clear all saved group chats */
export function clearAllGCs(): void {
  localStorage.removeItem(STORAGE_KEYS.SAVED_GC_LIST);
  notifyGCsChanged();
}

/** Get the saved display name */
export function getDisplayName(): string {
  try {
    return (localStorage.getItem(STORAGE_KEYS.DISPLAY_NAME) ?? "").slice(0, 30);
  } catch {
    return "";
  }
}

/** Save the display name */
export function setDisplayName(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.DISPLAY_NAME, name.slice(0, 30));
  } catch {
    // localStorage may be unavailable
  }
}