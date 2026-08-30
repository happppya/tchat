// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import Sidebar from "./Sidebar";
import type { SavedGC } from "../../types";

// ── Mock react-router-dom ──────────────────────────────────────────────
vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

// ── Default mocked user ─────────────────────────────────────────────────
const mockUser = { id: 1, username: "alice", isAdmin: false };

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockUser,
    logout: vi.fn().mockResolvedValue(undefined),
    persistWarning: null,
  }),
}));

// ── Mock API ────────────────────────────────────────────────────────────
vi.mock("../../services/api", () => ({
  fetchMyRooms: vi.fn().mockResolvedValue([]),
  fetchPublicRooms: vi.fn().mockResolvedValue([]),
  fetchBoardGroups: vi.fn().mockResolvedValue([]),
  createBoardGroup: vi.fn(),
  renameBoardGroup: vi.fn(),
  deleteBoardGroup: vi.fn(),
  addRoomToBoardGroup: vi.fn(),
  removeRoomFromBoardGroup: vi.fn(),
  reorderBoardGroups: vi.fn(),
  reorderBoardGroupRooms: vi.fn(),
  renameRoom: vi.fn(),
}));

// ── Mock CreateGroupChat ────────────────────────────────────────────────
vi.mock("./CreateGroupChat", () => ({
  default: () => null,
}));

// ── Storage: provide 3 saved rooms for the my-rooms tab ─────────────────
const ROOMS: SavedGC[] = [
  { id: 1, name: "general" },
  { id: 2, name: "random" },
  { id: 3, name: "announcements" },
];

vi.mock("../../services/storage", () => ({
  getSavedGCs: vi.fn(() => ROOMS),
  removeGC: vi.fn(),
  saveGCList: vi.fn(),
  mergeSavedGCs: vi.fn((_a: unknown, local: unknown) => local),
  renameSavedGC: vi.fn(),
  GCS_CHANGED_EVENT: "gcs-changed",
  ROOM_RENAMED_EVENT: "room-renamed",
  getLocalGroups: vi.fn(() => []),
  saveLocalGroups: vi.fn(),
  createLocalGroup: vi.fn(),
  renameLocalGroup: vi.fn(),
  deleteLocalGroup: vi.fn(),
  addRoomToLocalGroup: vi.fn(),
  removeRoomFromLocalGroup: vi.fn(),
  moveLocalRoom: vi.fn(),
}));

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Helpers ─────────────────────────────────────────────────────────────

const noop = () => {};

function renderSidebarWithMute(
  mutedRooms = new Set<number>(),
  onToggleMute = vi.fn<(gcId: number) => void>(),
) {
  return render(
    <Sidebar
      activeGCId={null}
      onSelectGC={noop}
      onEditProfile={noop}
      onOpenSettings={noop}
      onToggleSidebar={noop}
      mutedRooms={mutedRooms}
      onToggleMute={onToggleMute}
    />,
  );
}

/** Wait for the 3 rooms to render on the my-rooms tab. */
async function waitForRooms() {
  await waitFor(() => {
    expect(screen.getByTestId("gc-button-1")).toBeTruthy();
    expect(screen.getByTestId("gc-button-2")).toBeTruthy();
    expect(screen.getByTestId("gc-button-3")).toBeTruthy();
  });
}

/** Right-click a room button, opening the context menu. */
function rightClickRoom(roomId: number) {
  fireEvent.contextMenu(screen.getByTestId(`gc-button-${roomId}`));
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("Mute room context menu — unmuted room", () => {
  let toggleSpy = vi.fn<(gcId: number) => void>();

  beforeEach(async () => {
    toggleSpy = vi.fn();
    renderSidebarWithMute(new Set(), toggleSpy);
    await waitForRooms();
  });

  it("shows context menu with 'Mute room' on right-click", () => {
    rightClickRoom(1);
    expect(screen.getByText("🔇 Mute room")).toBeTruthy();
    expect(screen.queryByText("🔊 Unmute room")).toBeNull();
  });

  it("calls onToggleMute with the correct room ID", async () => {
    rightClickRoom(1);
    fireEvent.click(screen.getByText("🔇 Mute room"));

    expect(toggleSpy).toHaveBeenCalledWith(1);
  });

  it("dismisses the context menu when clicking outside", async () => {
    rightClickRoom(2);
    expect(screen.getByText("🔇 Mute room")).toBeTruthy();

    fireEvent.click(document.body);

    await waitFor(() => {
      expect(screen.queryByText("🔇 Mute room")).toBeNull();
    });
  });

  it("dismisses the context menu with Escape key", async () => {
    rightClickRoom(3);
    expect(screen.getByText("🔇 Mute room")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByText("🔇 Mute room")).toBeNull();
    });
  });

  it("keeps the context menu alive when clicking its own button", () => {
    rightClickRoom(1);
    const btn = screen.getByText("🔇 Mute room");
    fireEvent.click(btn);

    expect(toggleSpy).toHaveBeenCalledWith(1);
  });
});

describe("Mute room context menu — muted room", () => {
  let toggleSpy = vi.fn<(gcId: number) => void>();

  beforeEach(async () => {
    toggleSpy = vi.fn();
    // Room 3 is muted; rooms 1 and 2 are not.
    renderSidebarWithMute(new Set([3]), toggleSpy);
    await waitForRooms();
  });

  it("shows 'Unmute room' for a muted room", () => {
    rightClickRoom(3);
    expect(screen.getByText("🔊 Unmute room")).toBeTruthy();
    expect(screen.queryByText("🔇 Mute room")).toBeNull();
  });

  it("still shows 'Mute room' for unmuted rooms", () => {
    rightClickRoom(1);
    expect(screen.getByText("🔇 Mute room")).toBeTruthy();
    expect(screen.queryByText("🔊 Unmute room")).toBeNull();
  });

  it("calls onToggleMute when clicking 'Unmute room'", () => {
    rightClickRoom(3);
    fireEvent.click(screen.getByText("🔊 Unmute room"));

    expect(toggleSpy).toHaveBeenCalledWith(3);
  });
});

describe("Muted room indicator", () => {
  it("shows 🔇 on muted rooms, absent on unmuted rooms", async () => {
    renderSidebarWithMute(new Set([1, 3]));
    await waitForRooms();

    const btn1 = screen.getByTestId("gc-button-1");
    expect(btn1.textContent).toContain("🔇");

    const btn2 = screen.getByTestId("gc-button-2");
    expect(btn2.textContent).not.toContain("🔇");

    const btn3 = screen.getByTestId("gc-button-3");
    expect(btn3.textContent).toContain("🔇");
  });

  it("updates indicator when mutedRooms prop changes", async () => {
    const toggleSpy = vi.fn();
    const { rerender } = renderSidebarWithMute(new Set(), toggleSpy);
    await waitForRooms();

    expect(screen.getByTestId("gc-button-1").textContent).not.toContain("🔇");

    rerender(
      <Sidebar
        activeGCId={null}
        onSelectGC={noop}
        onEditProfile={noop}
        onOpenSettings={noop}
        onToggleSidebar={noop}
        mutedRooms={new Set([1])}
        onToggleMute={toggleSpy}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("gc-button-1").textContent).toContain("🔇");
    });
  });
});