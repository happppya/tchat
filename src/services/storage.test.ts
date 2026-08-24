import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSavedGCs,
  saveGCList,
  getLocalGroups,
  saveLocalGroups,
  renameLocalGroup,
  renameSavedGC,
  addRoomToLocalGroup,
  removeRoomFromLocalGroup,
  moveLocalRoom,
  reorderLocalGroups,
  getMutedRooms,
  toggleMuteRoom,
  isRoomMuted,
} from "./storage";

/** Minimal localStorage + window stub so storage helpers run in node. */
function makeEnv() {
  const store = new Map<string, string>();
  return {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
    window: { dispatchEvent: () => true },
  };
}

let env: ReturnType<typeof makeEnv>;

beforeEach(() => {
  env = makeEnv();
  vi.stubGlobal("localStorage", env.localStorage);
  vi.stubGlobal("window", env.window);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("moveLocalRoom", () => {
  it("reorders top-level rooms (drag 222 onto 111)", () => {
    saveGCList([
      { id: 111, name: "a" },
      { id: 222, name: "b" },
      { id: 333, name: "c" },
    ]);
    saveLocalGroups([]);

    moveLocalRoom(222, 111, null);

    expect(getSavedGCs().map((g) => g.id)).toEqual([222, 111, 333]);
  });

  it("reorders rooms within a group (drag 111 onto 333)", () => {
    saveGCList([
      { id: 111, name: "a" },
      { id: 222, name: "b" },
      { id: 333, name: "c" },
    ]);
    saveLocalGroups([{ id: "g1", name: "Group 1", roomIds: [333, 111] }]);

    moveLocalRoom(111, 333, "g1");

    expect(getLocalGroups()[0].roomIds).toEqual([111, 333]);
  });

  it("moves a top-level room into a group at the target's position", () => {
    saveGCList([
      { id: 111, name: "a" },
      { id: 222, name: "b" },
      { id: 333, name: "c" },
    ]);
    saveLocalGroups([{ id: "g1", name: "Group 1", roomIds: [333] }]);

    moveLocalRoom(111, 333, "g1");

    expect(getLocalGroups()[0].roomIds).toEqual([111, 333]);
  });

  it("moves a grouped room out to top level", () => {
    saveGCList([
      { id: 111, name: "a" },
      { id: 222, name: "b" },
      { id: 333, name: "c" },
    ]);
    saveLocalGroups([{ id: "g1", name: "Group 1", roomIds: [333, 111] }]);

    moveLocalRoom(111, 222, null);

    expect(getLocalGroups()[0].roomIds).toEqual([333]);
  });

  it("removes the dragged room from any other group when moving into a new one", () => {
    saveGCList([
      { id: 111, name: "a" },
      { id: 222, name: "b" },
      { id: 333, name: "c" },
    ]);
    saveLocalGroups([
      { id: "g1", name: "Group 1", roomIds: [111] },
      { id: "g2", name: "Group 2", roomIds: [333] },
    ]);

    moveLocalRoom(111, 333, "g2");

    expect(getLocalGroups()[0].roomIds).toEqual([]);
    expect(getLocalGroups()[1].roomIds).toEqual([111, 333]);
  });
});

describe("addRoomToLocalGroup / removeRoomFromLocalGroup", () => {
  it("adds a room to a group, removing it from any other group first", () => {
    saveLocalGroups([
      { id: "g1", name: "Group 1", roomIds: [111] },
      { id: "g2", name: "Group 2", roomIds: [] },
    ]);

    addRoomToLocalGroup(111, "g2");

    expect(getLocalGroups()[0].roomIds).toEqual([]);
    expect(getLocalGroups()[1].roomIds).toEqual([111]);
  });

  it("removes a room from its group (spills to top level)", () => {
    saveLocalGroups([{ id: "g1", name: "Group 1", roomIds: [111, 222] }]);

    removeRoomFromLocalGroup(111);

    expect(getLocalGroups()[0].roomIds).toEqual([222]);
  });
});

describe("reorderLocalGroups", () => {
  it("reorders groups to match the given id order, appending unknowns", () => {
    saveLocalGroups([
      { id: "g1", name: "Group 1", roomIds: [111] },
      { id: "g2", name: "Group 2", roomIds: [222] },
      { id: "g3", name: "Group 3", roomIds: [333] },
    ]);

    reorderLocalGroups(["g3", "g1"]);

    expect(getLocalGroups().map((g) => g.id)).toEqual(["g3", "g1", "g2"]);
  });
});

describe("renameLocalGroup", () => {
  it("persists the new group name", () => {
    saveLocalGroups([{ id: "g1", name: "Old Name", roomIds: [111] }]);

    renameLocalGroup("g1", "New Name");

    expect(getLocalGroups()[0].name).toBe("New Name");
  });

  it("keeps the original name when the new one is blank", () => {
    saveLocalGroups([{ id: "g1", name: "Old Name", roomIds: [111] }]);

    renameLocalGroup("g1", "   ");

    expect(getLocalGroups()[0].name).toBe("Old Name");
  });

  it("is a no-op for an unknown group id", () => {
    saveLocalGroups([{ id: "g1", name: "Old Name", roomIds: [111] }]);

    renameLocalGroup("nope", "New Name");

    expect(getLocalGroups()[0].name).toBe("Old Name");
  });
});

describe("renameSavedGC", () => {
  it("updates the room name in place and keeps the list order", () => {
    saveGCList([
      { id: 111, name: "Old One" },
      { id: 222, name: "Room Two" },
    ]);

    renameSavedGC(111, "New One");

    expect(getSavedGCs()).toEqual([
      { id: 111, name: "New One" },
      { id: 222, name: "Room Two" },
    ]);
  });

  it("is a no-op for a room not in the saved list", () => {
    saveGCList([{ id: 111, name: "Old One" }]);

    renameSavedGC(999, "Ghost");

    expect(getSavedGCs()).toEqual([{ id: 111, name: "Old One" }]);
  });
});

// ---------------------------------------------------------------------------
// Muted rooms
// ---------------------------------------------------------------------------

describe("muted rooms", () => {
  it("starts with no muted rooms", () => {
    expect(getMutedRooms().size).toBe(0);
    expect(isRoomMuted(1)).toBe(false);
    expect(isRoomMuted(42)).toBe(false);
  });

  it("mutes a room", () => {
    toggleMuteRoom(10);
    expect(isRoomMuted(10)).toBe(true);
    expect(getMutedRooms().has(10)).toBe(true);
    // Other rooms stay unmuted.
    expect(isRoomMuted(20)).toBe(false);
  });

  it("unmutes a previously muted room", () => {
    toggleMuteRoom(10);
    expect(isRoomMuted(10)).toBe(true);
    toggleMuteRoom(10);
    expect(isRoomMuted(10)).toBe(false);
    expect(getMutedRooms().has(10)).toBe(false);
  });

  it("mutes multiple rooms independently", () => {
    toggleMuteRoom(5);
    toggleMuteRoom(7);
    expect(isRoomMuted(5)).toBe(true);
    expect(isRoomMuted(7)).toBe(true);
    expect(isRoomMuted(9)).toBe(false);
    // Unmute one, the other stays muted.
    toggleMuteRoom(5);
    expect(isRoomMuted(5)).toBe(false);
    expect(isRoomMuted(7)).toBe(true);
  });

  it("survives localStorage round-trip", () => {
    toggleMuteRoom(100);
    toggleMuteRoom(200);

    // Simulate re-reading from storage (fresh call).
    const reloaded = getMutedRooms();
    expect(reloaded.has(100)).toBe(true);
    expect(reloaded.has(200)).toBe(true);
    expect(reloaded.has(300)).toBe(false);
  });
});
