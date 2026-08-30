// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import Sidebar from "./Sidebar";
import type { SavedGC, GroupChat, BoardGroup } from "../../types";

const {
  mockUser,
  storedList,
  mockMoveRoomToStart,
  mockMoveRoomToEnd,
  mockRemoveRoomFromLocalGroup,
  mockAddRoomToBoardGroup,
  mockRemoveRoomFromBoardGroup,
  mockReorderBoardGroupRooms,
  publicRooms,
} = vi.hoisted(() => ({
  mockUser: { id: 1, username: "alice", isAdmin: false } as {
    id: number;
    username: string;
    isAdmin: boolean;
  },
  storedList: [
    { id: 10, name: "Alpha" },
    { id: 20, name: "Beta" },
    { id: 30, name: "Gamma" },
  ] as SavedGC[],
  mockMoveRoomToStart: vi.fn(),
  mockMoveRoomToEnd: vi.fn(),
  mockRemoveRoomFromLocalGroup: vi.fn(),
  mockAddRoomToBoardGroup: vi.fn().mockResolvedValue(undefined),
  mockRemoveRoomFromBoardGroup: vi.fn().mockResolvedValue(undefined),
  mockReorderBoardGroupRooms: vi.fn().mockResolvedValue(undefined),
  publicRooms: [
    { id: 10, name: "Public A", is_public: 1 },
    { id: 20, name: "Public B", is_public: 1 },
    { id: 30, name: "Public C", is_public: 1 },
  ] as GroupChat[],
}));

// ── Mock react-router-dom ──────────────────────────────────────────────────
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

// ── Mock user ──────────────────────────────────────────────────────────────
vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockUser,
    logout: vi.fn().mockResolvedValue(undefined),
    persistWarning: null,
  }),
}));

// ── Storage ────────────────────────────────────────────────────────────────
vi.mock("../../services/storage", () => ({
  getSavedGCs: () => storedList,
  removeGC: vi.fn(),
  saveGCList: (list: SavedGC[]) => {
    storedList.length = 0;
    storedList.push(...list);
  },
  mergeSavedGCs: (_a: unknown, local: unknown) => local,
  renameSavedGC: vi.fn(),
  GCS_CHANGED_EVENT: "gcs-changed",
  ROOM_RENAMED_EVENT: "room-renamed",
  getLocalGroups: () => [],
  saveLocalGroups: vi.fn(),
  createLocalGroup: vi.fn(),
  renameLocalGroup: vi.fn(),
  deleteLocalGroup: vi.fn(),
  addRoomToLocalGroup: vi.fn(),
  removeRoomFromLocalGroup: mockRemoveRoomFromLocalGroup,
  moveLocalRoom: vi.fn(),
  moveRoomToStart: mockMoveRoomToStart,
  moveRoomToEnd: mockMoveRoomToEnd,
}));

// ── Mock API ───────────────────────────────────────────────────────────────
vi.mock("../../services/api", () => ({
  fetchMyRooms: vi.fn().mockResolvedValue([]),
  fetchPublicRooms: vi.fn().mockResolvedValue(publicRooms),
  fetchBoardGroups: vi.fn().mockResolvedValue([
    { id: 1, name: "Group X", roomIds: [10], position: 0 } as BoardGroup,
    { id: 2, name: "Group Y", roomIds: [20], position: 1 } as BoardGroup,
  ]),
  createBoardGroup: vi.fn(),
  renameBoardGroup: vi.fn(),
  deleteBoardGroup: vi.fn(),
  addRoomToBoardGroup: (...args: unknown[]) => mockAddRoomToBoardGroup(...args),
  removeRoomFromBoardGroup: (...args: unknown[]) =>
    mockRemoveRoomFromBoardGroup(...args),
  reorderBoardGroups: vi.fn().mockResolvedValue(undefined),
  reorderBoardGroupRooms: (...args: unknown[]) =>
    mockReorderBoardGroupRooms(...args),
  renameRoom: vi.fn(),
}));

// ── Mock CreateGroupChat ───────────────────────────────────────────────────
vi.mock("./CreateGroupChat", () => ({ default: () => null }));

// jsdom stubs
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// ── Helpers ────────────────────────────────────────────────────────────────

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockUser.id = 1;
  mockUser.username = "alice";
  mockUser.isAdmin = false;
  storedList.length = 0;
  storedList.push(
    { id: 10, name: "Alpha" },
    { id: 20, name: "Beta" },
    { id: 30, name: "Gamma" },
  );
});

const noop = () => {};

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  return render(
    <Sidebar
      activeGCId={null}
      onSelectGC={noop}
      onEditProfile={noop}
      onOpenSettings={noop}
      onToggleSidebar={noop}
      {...overrides}
    />,
  );
}

function makeDataTransfer(data: Record<string, string> = {}) {
  const store = new Map(Object.entries(data));
  return {
    setData(format: string, value: string) { store.set(format, value); },
    getData(format: string) { return store.get(format) ?? ""; },
    effectAllowed: "none" as string,
    dropEffect: "none" as string,
  };
}

function fireDragEvent(
  el: Element,
  type: string,
  data: Record<string, string> = {},
) {
  const dt = makeDataTransfer(data);
  const evt = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(evt, "dataTransfer", { value: dt, writable: false });
  fireEvent(el, evt);
}

async function waitForRooms() {
  await waitFor(() => {
    expect(screen.getByTestId("gc-button-10")).toBeTruthy();
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("End-zone drop areas (my rooms tab)", () => {
  beforeEach(async () => {
    renderSidebar();
    await waitForRooms();
  });

  it("shows start and end drop zones on the my-rooms tab", () => {
    expect(screen.getByTestId("drop-zone-start")).toBeTruthy();
    expect(screen.getByTestId("drop-zone-end")).toBeTruthy();
  });

  it("start zone calls preventDefault on dragover", () => {
    const zone = screen.getByTestId("drop-zone-start");
    const evt = new Event("dragover", { bubbles: true, cancelable: true });
    let prevented = false;
    const orig = evt.preventDefault.bind(evt);
    evt.preventDefault = () => { prevented = true; orig(); };
    Object.defineProperty(evt, "dataTransfer", {
      value: { dropEffect: "none" },
      writable: false,
    });
    fireEvent(zone, evt);
    expect(prevented).toBe(true);
  });

  it("dropping a room on the start zone moves it to the top", () => {
    fireDragEvent(screen.getByTestId("drop-zone-start"), "drop", {
      "text/plain": "30",
    });
    expect(mockRemoveRoomFromLocalGroup).toHaveBeenCalledWith(30);
    expect(mockMoveRoomToStart).toHaveBeenCalledWith(30);
  });

  it("dropping a room on the end zone moves it to the bottom", () => {
    fireDragEvent(screen.getByTestId("drop-zone-end"), "drop", {
      "text/plain": "10",
    });
    expect(mockRemoveRoomFromLocalGroup).toHaveBeenCalledWith(10);
    expect(mockMoveRoomToEnd).toHaveBeenCalledWith(10);
  });
});

describe("End-zone drop areas — non-admin on board tab", () => {
  it("hides start and end drop zones for non-admin on board tab", async () => {
    mockUser.isAdmin = false;
    renderSidebar();

    fireEvent.click(screen.getByTestId("tab-board"));
    await waitFor(() => {
      expect(screen.getByTestId("public-room-30")).toBeTruthy();
    });

    expect(screen.queryByTestId("drop-zone-start")).toBeNull();
    expect(screen.queryByTestId("drop-zone-end")).toBeNull();
  });

  it("shows start and end drop zones for admin on board tab", async () => {
    mockUser.isAdmin = true;
    renderSidebar();

    fireEvent.click(screen.getByTestId("tab-board"));
    await waitFor(() => {
      expect(screen.getByTestId("public-room-30")).toBeTruthy();
    });

    expect(screen.getByTestId("drop-zone-start")).toBeTruthy();
    expect(screen.getByTestId("drop-zone-end")).toBeTruthy();
  });
});

describe("Board tab — top-level room reordering", () => {
  beforeEach(async () => {
    mockUser.isAdmin = true;
    renderSidebar();
    fireEvent.click(screen.getByTestId("tab-board"));
    await waitFor(() => {
      expect(screen.getByTestId("public-room-30")).toBeTruthy();
    });
  });

  it("dropping room 30 onto room 10 adds it to Group X and reorders", async () => {
    fireDragEvent(screen.getByTestId("public-room-10"), "drop", {
      "text/plain": "30",
    });

    await waitFor(() => {
      expect(mockAddRoomToBoardGroup).toHaveBeenCalledWith(1, 30);
      expect(mockReorderBoardGroupRooms).toHaveBeenCalled();
    });
  });
});