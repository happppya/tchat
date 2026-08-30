/** localStorage persistence for saved group chats and local room groups. */
import type { SavedGC, LocalGroup } from "../types";

const STORAGE_KEYS = {
  SAVED_GC_LIST: "savedGCList",
  DISPLAY_NAME: "displayName",
  LOCAL_GROUPS: "tchat:local-groups",
  LAST_READ_IDS: "tchat:last-read-ids",
  ROOM_NOTIF_COUNTS: "tchat:room-notif-counts",
  MUTED_ROOMS: "tchat:muted-rooms",
} as const;

/** Per-room counts of background messages since the user last visited. */
export interface RoomNotifCounts {
  general: number;
  important: number;
}

export type RoomNotifMap = Record<number, RoomNotifCounts>;

// ---------------------------------------------------------------------------
// Notification settings — persisted toggles.
// ---------------------------------------------------------------------------

export interface NotifSettings {
  /** Show unread general badges on sidebar rooms. */
  showGeneralBadges: boolean;
  /** Show unread important badges on sidebar rooms. */
  showImportantBadges: boolean;
  /** Show general toast notifications. */
  generalToasts: boolean;
  /** Show important (ping) toast notifications. */
  importantToasts: boolean;
  /** Fire OS-level desktop notifications for general messages in background rooms. */
  desktopGeneral: boolean;
  /** Fire OS-level desktop notifications for pings & @everyone. */
  desktopImportant: boolean;
}

const DEFAULT_NOTIF_SETTINGS: NotifSettings = {
  showGeneralBadges: true,
  showImportantBadges: true,
  generalToasts: true,
  importantToasts: true,
  desktopGeneral: false,
  desktopImportant: false,
};

/** Fired on this window whenever the saved-GC list changes. */
export const GCS_CHANGED_EVENT = "tchat:gcs-changed";

/** Fired when a room is renamed (WS echo), with `{ id, name }` detail. */
export const ROOM_RENAMED_EVENT = "tchat:room-renamed";

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

/** Update a saved room's name in place (keeps its position in the list). */
export function renameSavedGC(id: number, name: string): void {
  saveGCList(getSavedGCs().map((gc) => (gc.id === id ? { ...gc, name } : gc)));
}

/** Clear all saved group chats */
export function clearAllGCs(): void {
  localStorage.removeItem(STORAGE_KEYS.SAVED_GC_LIST);
  notifyGCsChanged();
}

// ---------------------------------------------------------------------------
// Persisted unread markers — per-room lastReadId survives page reloads.
// ---------------------------------------------------------------------------

type LastReadMap = Record<number, number>;

function readLastReadMap(): LastReadMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LAST_READ_IDS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeLastReadMap(map: LastReadMap): void {
  try {
    localStorage.setItem(STORAGE_KEYS.LAST_READ_IDS, JSON.stringify(map));
  } catch {
    // localStorage may be unavailable
  }
}

/** Get the persisted last-read message id for a room. */
export function getLastReadId(gcId: number): number {
  return readLastReadMap()[gcId] ?? 0;
}

/** Persist the last-read message id for a room. */
export function setLastReadId(gcId: number, id: number): void {
  const map = readLastReadMap();
  map[gcId] = id;
  writeLastReadMap(map);
}

/** Remove persisted read state for a room (e.g. on leave). */
export function clearLastReadId(gcId: number): void {
  const map = readLastReadMap();
  delete map[gcId];
  writeLastReadMap(map);
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

// ---------------------------------------------------------------------------
// Local groups (my rooms tab) — client-side only
// ---------------------------------------------------------------------------

/** Get local groups from localStorage. */
export function getLocalGroups(): LocalGroup[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_GROUPS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Save local groups to localStorage. */
export function saveLocalGroups(groups: LocalGroup[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.LOCAL_GROUPS, JSON.stringify(groups));
    notifyGCsChanged();
  } catch {
    // localStorage may be unavailable
  }
}

/** Create a new local group and return it. */
export function createLocalGroup(name: string): LocalGroup {
  const groups = getLocalGroups();
  const group: LocalGroup = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: name.trim() || "New Group",
    roomIds: [],
  };
  groups.push(group);
  saveLocalGroups(groups);
  return group;
}

/** Rename a local group and persist it. */
export function renameLocalGroup(id: string, name: string): void {
  const groups = getLocalGroups();
  const g = groups.find((g) => g.id === id);
  if (g) {
    g.name = name.trim() || g.name;
    saveLocalGroups(groups);
  }
}

/** Delete a local group; its rooms spill to top level. */
export function deleteLocalGroup(id: string): void {
  saveLocalGroups(getLocalGroups().filter((g) => g.id !== id));
}

/** Add a room to a local group (removes from any other group first). */
export function addRoomToLocalGroup(roomId: number, groupId: string): void {
  const groups = getLocalGroups();
  for (const g of groups) g.roomIds = g.roomIds.filter((r) => r !== roomId);
  const target = groups.find((g) => g.id === groupId);
  if (target) target.roomIds.push(roomId);
  saveLocalGroups(groups);
  notifyGCsChanged();
}

/** Remove a room from its local group (spills to top level). */
export function removeRoomFromLocalGroup(roomId: number): void {
  const groups = getLocalGroups();
  for (const g of groups) g.roomIds = g.roomIds.filter((r) => r !== roomId);
  saveLocalGroups(groups);
  notifyGCsChanged();
}

/**
 * Move a room next to a target room (reorder or move between scopes).
 *
 * Covers every drop-on-room case for the "my rooms" tab:
 * - both rooms top-level → reorder the saved list
 * - both rooms in the same group → reorder within that group
 * - dragged is in a group, target is top-level → spill dragged to top level
 * - dragged is top-level, target is in a group → pull dragged into the group
 *
 * `targetGroupId` is the id of the group containing the target room, or null
 * when the target is a top-level room.
 */
export function moveLocalRoom(
  draggedId: number,
  targetId: number,
  targetGroupId: string | null
): void {
  // Remove the dragged room from every group first.
  const groups = getLocalGroups();
  for (const g of groups) g.roomIds = g.roomIds.filter((r) => r !== draggedId);

  // If the target lives in a group, insert the dragged room at its position.
  const targetGroup = targetGroupId
    ? groups.find((g) => g.id === targetGroupId)
    : undefined;
  if (targetGroup) {
    const idx = targetGroup.roomIds.indexOf(targetId);
    if (idx >= 0) targetGroup.roomIds.splice(idx, 0, draggedId);
    else targetGroup.roomIds.push(draggedId);
  }
  saveLocalGroups(groups);

  // Reorder the master saved list so the dragged room sits at the target's
  // position (this is what drives top-level display order).
  const list = getSavedGCs();
  const fromIdx = list.findIndex((g) => g.id === draggedId);
  const toIdx = list.findIndex((g) => g.id === targetId);
  if (fromIdx >= 0 && toIdx >= 0) {
    const [moved] = list.splice(fromIdx, 1);
    const insertAt = list.findIndex((g) => g.id === targetId);
    list.splice(insertAt, 0, moved);
    saveGCList(list);
  }
}

/** Reorder local groups to match the given id order. */
export function reorderLocalGroups(ids: string[]): void {
  const groups = getLocalGroups();
  const map = new Map(groups.map((g) => [g.id, g]));
  const reordered: LocalGroup[] = [];
  for (const id of ids) {
    const g = map.get(id);
    if (g) reordered.push(g);
  }
  // Append any groups not in the id list
  for (const g of groups) {
    if (!ids.includes(g.id)) reordered.push(g);
  }
  saveLocalGroups(reordered);
  notifyGCsChanged();
}

/** Move a room to the very start of the top-level saved list. */
export function moveRoomToStart(draggedId: number): void {
  const list = getSavedGCs();
  const fromIdx = list.findIndex((g) => g.id === draggedId);
  if (fromIdx < 0) return;
  const [moved] = list.splice(fromIdx, 1);
  list.unshift(moved);
  saveGCList(list);
}

/** Move a room to the very end of the top-level saved list. */
export function moveRoomToEnd(draggedId: number): void {
  const list = getSavedGCs();
  const fromIdx = list.findIndex((g) => g.id === draggedId);
  if (fromIdx < 0) return;
  const [moved] = list.splice(fromIdx, 1);
  list.push(moved);
  saveGCList(list);
}

// ---------------------------------------------------------------------------
// Per-room notification counts
// ---------------------------------------------------------------------------

function readNotifMap(): RoomNotifMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ROOM_NOTIF_COUNTS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeNotifMap(map: RoomNotifMap): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ROOM_NOTIF_COUNTS, JSON.stringify(map));
  } catch {
    // localStorage may be unavailable
  }
}

/** Get the notification counts for a room. */
export function getRoomNotifCounts(gcId: number): RoomNotifCounts {
  return readNotifMap()[gcId] ?? { general: 0, important: 0 };
}

/** Increment a room's notification counter and return the new counts. */
export function incrementRoomNotif(gcId: number, important: boolean): RoomNotifCounts {
  const map = readNotifMap();
  const cur = map[gcId] ?? { general: 0, important: 0 };
  const next: RoomNotifCounts = important
    ? { ...cur, important: cur.important + 1 }
    : { ...cur, general: cur.general + 1 };
  map[gcId] = next;
  writeNotifMap(map);
  return next;
}

/** Reset notification counters for a room (when the user opens it). */
export function resetRoomNotif(gcId: number): void {
  const map = readNotifMap();
  delete map[gcId];
  writeNotifMap(map);
}

/** Get all notification counts as a flat map. */
export function getAllNotifCounts(): RoomNotifMap {
  return readNotifMap();
}

// ---------------------------------------------------------------------------
// Notification settings
// ---------------------------------------------------------------------------

const NOTIF_SETTINGS_KEY = "tchat:notif-settings";

/** Read persisted notification settings, falling back to defaults. */
export function getNotifSettings(): NotifSettings {
  try {
    const raw = localStorage.getItem(NOTIF_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_NOTIF_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_NOTIF_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_NOTIF_SETTINGS };
  }
}

/** Persist notification settings. */
export function saveNotifSettings(settings: NotifSettings): void {
  try {
    localStorage.setItem(NOTIF_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // localStorage may be unavailable
  }
}

// ---------------------------------------------------------------------------
// Muted rooms — per-room suppression of all notifications.
// ---------------------------------------------------------------------------

/** Read the set of muted room IDs from localStorage. */
export function getMutedRooms(): Set<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.MUTED_ROOMS);
    if (!raw) return new Set();
    const arr: number[] = JSON.parse(raw);
    return new Set(arr.filter((n) => typeof n === "number"));
  } catch {
    return new Set();
  }
}

/** Save muted room set to localStorage. */
function saveMutedRooms(muted: Set<number>): void {
  try {
    localStorage.setItem(
      STORAGE_KEYS.MUTED_ROOMS,
      JSON.stringify([...muted]),
    );
  } catch {
    // localStorage may be unavailable
  }
}

/** Check if a room is muted. */
export function isRoomMuted(gcId: number): boolean {
  return getMutedRooms().has(gcId);
}

/**
 * Toggle the muted state of a room. Returns the new `Set` so callers can
 * use it directly for `setState`.
 */
export function toggleMuteRoom(gcId: number): Set<number> {
  const muted = getMutedRooms();
  if (muted.has(gcId)) {
    muted.delete(gcId);
  } else {
    muted.add(gcId);
  }
  saveMutedRooms(muted);
  return muted;
}
