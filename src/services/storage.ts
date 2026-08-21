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