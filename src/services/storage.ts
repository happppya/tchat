import type { SavedGC, LocalGroup } from "../types";

const STORAGE_KEYS = {
  SAVED_GC_LIST: "savedGCList",
  DISPLAY_NAME: "displayName",
  LOCAL_GROUPS: "tchat:local-groups",
} as const;

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
