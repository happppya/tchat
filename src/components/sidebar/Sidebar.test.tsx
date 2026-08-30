// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import Sidebar from "./Sidebar";
import type { GroupChat, BoardGroup } from "../../types";

// ── Mock react-router-dom ──────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

// ── Default mocked user (overridden per-test) ───────────────────────────
let mockUser: { id: number; username: string; isAdmin: boolean } = {
  id: 1,
  username: "alice",
  isAdmin: false,
};

vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockUser,
    logout: vi.fn().mockResolvedValue(undefined),
    persistWarning: null,
  }),
}));

// ── Mock API ────────────────────────────────────────────────────────────
const mockAddRoomToBoardGroup = vi.fn().mockResolvedValue(undefined);
const mockRemoveRoomFromBoardGroup = vi.fn().mockResolvedValue(undefined);
const mockReorderBoardGroups = vi.fn().mockResolvedValue(undefined);
const mockReorderBoardGroupRooms = vi.fn().mockResolvedValue(undefined);

vi.mock("../../services/api", () => ({
  fetchMyRooms: vi.fn().mockResolvedValue([]),
  fetchPublicRooms: vi
    .fn()
    .mockResolvedValue([
      { id: 10, name: "General", is_public: 1 },
      { id: 20, name: "Random", is_public: 1 },
      { id: 30, name: "Announcements", is_public: 1 },
    ] as GroupChat[]),
  fetchBoardGroups: vi
    .fn()
    .mockResolvedValue([
      { id: 1, name: "Community", roomIds: [10], position: 0 } as BoardGroup,
      { id: 2, name: "Off Topic", roomIds: [20], position: 1 } as BoardGroup,
    ] as BoardGroup[]),
  createBoardGroup: vi.fn(),
  renameBoardGroup: vi.fn(),
  deleteBoardGroup: vi.fn(),
  addRoomToBoardGroup: (...args: unknown[]) =>
    mockAddRoomToBoardGroup(...args),
  removeRoomFromBoardGroup: (...args: unknown[]) =>
    mockRemoveRoomFromBoardGroup(...args),
  reorderBoardGroups: (...args: unknown[]) =>
    mockReorderBoardGroups(...args),
  reorderBoardGroupRooms: (...args: unknown[]) =>
    mockReorderBoardGroupRooms(...args),
  renameRoom: vi.fn(),
}));

// ── Mock CreateGroupChat (irrelevant for DnD tests) ─────────────────────
vi.mock("./CreateGroupChat", () => ({
  default: () => null,
}));

// ── Mock storage helpers ────────────────────────────────────────────────
vi.mock("../../services/storage", () => ({
  getSavedGCs: vi.fn(() => []),
  removeGC: vi.fn(),
  saveGCList: vi.fn(),
  mergeSavedGCs: vi.fn((_serverRooms: unknown, local: unknown) => local),
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

// jsdom doesn't implement scrollIntoView; stub it.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockUser = { id: 1, username: "alice", isAdmin: false };
});

// ── Helpers ─────────────────────────────────────────────────────────────

const noop = () => {};

function renderSidebar() {
  return render(
    <Sidebar
      activeGCId={null}
      onSelectGC={noop}
      onEditProfile={noop}
      onOpenSettings={noop}
      onToggleSidebar={noop}
    />,
  );
}

async function switchToBoardTab() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("tab-board"));
  });
}

/**
 * Build a fake dataTransfer payload and fire a drag-related event.
 * Returns an object with the dataTransfer proxy so callers can inspect
 * `getData`, `effectAllowed`, and `dropEffect` after the handler runs.
 */
function fireDragEvent(
  el: Element,
  type: string,
  data: Record<string, string> = {},
): {
  /** The faked dataTransfer object. Read .getData(), .effectAllowed, etc. */
  dt: ReturnType<typeof makeDataTransfer>;
  /** Whether preventDefault was called during dispatch. */
  prevented: boolean;
} {
  const dt = makeDataTransfer(data);

  const evt = new Event(type, { bubbles: true, cancelable: true });
  let prevented = false;
  const origPD = evt.preventDefault.bind(evt);
  evt.preventDefault = () => {
    prevented = true;
    origPD();
  };
  Object.defineProperty(evt, "dataTransfer", {
    value: dt,
    writable: false,
  });

  fireEvent(el, evt);
  return { dt, prevented };
}

function makeDataTransfer(data: Record<string, string> = {}) {
  const store = new Map(Object.entries(data));
  return {
    _store: store,
    setData(format: string, value: string) {
      store.set(format, value);
    },
    getData(format: string) {
      return store.get(format) ?? "";
    },
    clearData() {
      store.clear();
    },
    effectAllowed: "none" as string,
    dropEffect: "none" as string,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe("Board tab drag-and-drop — non-admin", () => {
  beforeEach(async () => {
    mockUser = { id: 1, username: "alice", isAdmin: false };
    renderSidebar();
  });

  it("board tab room buttons are not draggable for non-admins", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByTestId("public-room-10")).toBeTruthy();
    });

    const btn = screen.getByTestId("public-room-10");
    expect(btn.getAttribute("draggable")).toBe("false");
  });

  it("dragStart on a board room does not set drag data for non-admins", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByTestId("public-room-20")).toBeTruthy();
    });

    const btn = screen.getByTestId("public-room-20");
    const { dt } = fireDragEvent(btn, "dragstart");

    // canReorder is false → handler bails before calling setData.
    expect(dt.getData("text/plain")).toBe("");
    expect(dt.effectAllowed).toBe("none");
  });

  it("dragOver on a board room does NOT call preventDefault for non-admins", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByTestId("public-room-10")).toBeTruthy();
    });

    const btn = screen.getByTestId("public-room-10");
    const { prevented } = fireDragEvent(btn, "dragover");

    expect(prevented).toBe(false);
  });

  it("drop on a board room does NOT trigger board operations for non-admins", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByTestId("public-room-30")).toBeTruthy();
    });

    const btn = screen.getByTestId("public-room-30");
    fireDragEvent(btn, "drop", { "text/plain": "10" });

    expect(mockAddRoomToBoardGroup).not.toHaveBeenCalled();
    expect(mockRemoveRoomFromBoardGroup).not.toHaveBeenCalled();
    expect(mockReorderBoardGroupRooms).not.toHaveBeenCalled();
  });

  it("board group headers are not draggable for non-admins", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByText("Community")).toBeTruthy();
    });

    const groups = document.querySelectorAll('[draggable="false"]');
    let found = false;
    groups.forEach((el) => {
      if (el.textContent?.includes("Community")) found = true;
    });
    expect(found).toBe(true);
  });

  it("dragStart on a board group does NOT set drag data for non-admins", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByText("Community")).toBeTruthy();
    });

    const headers = Array.from(
      document.querySelectorAll('[draggable="false"]'),
    ).filter((el) => el.textContent?.includes("Community"));
    expect(headers.length).toBeGreaterThan(0);

    const { dt } = fireDragEvent(headers[0], "dragstart");
    expect(dt.getData("application/group-id")).toBe("");
  });

  it("dragOver on a board group does NOT call preventDefault for non-admins", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByText("Off Topic")).toBeTruthy();
    });

    const headers = Array.from(
      document.querySelectorAll('[draggable="false"]'),
    ).filter((el) => el.textContent?.includes("Off Topic"));
    expect(headers.length).toBeGreaterThan(0);

    const { prevented } = fireDragEvent(headers[0], "dragover");
    expect(prevented).toBe(false);
  });

  it("drop on a board group does NOT trigger board operations for non-admins", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByText("Community")).toBeTruthy();
    });

    const headers = Array.from(
      document.querySelectorAll('[draggable="false"]'),
    ).filter((el) => el.textContent?.includes("Community"));
    expect(headers.length).toBeGreaterThan(0);

    fireDragEvent(headers[0], "drop", { "text/plain": "30" });

    expect(mockAddRoomToBoardGroup).not.toHaveBeenCalled();
    expect(mockReorderBoardGroups).not.toHaveBeenCalled();
  });

  it("dragOver on the top-level drop zone does NOT call preventDefault for non-admins", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByTestId("public-room-10")).toBeTruthy();
    });

    // Find the room list container (the element with onDragOver={handleDragOverTop})
    const containers = document.querySelectorAll(".overflow-y-auto");
    let listContainer: Element | null = null;
    containers.forEach((c) => {
      if (c.textContent?.includes("Community")) listContainer = c;
    });
    expect(listContainer).not.toBeNull();

    const { prevented } = fireDragEvent(listContainer!, "dragover");
    expect(prevented).toBe(false);
  });

  it("drop on the top-level zone does NOT remove from board group for non-admins", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByTestId("public-room-10")).toBeTruthy();
    });

    const containers = document.querySelectorAll(".overflow-y-auto");
    let listContainer: Element | null = null;
    containers.forEach((c) => {
      if (c.textContent?.includes("Community")) listContainer = c;
    });
    expect(listContainer).not.toBeNull();

    fireDragEvent(listContainer!, "drop", { "text/plain": "10" });

    expect(mockRemoveRoomFromBoardGroup).not.toHaveBeenCalled();
  });
});

describe("Board tab drag-and-drop — admin", () => {
  beforeEach(async () => {
    mockUser = { id: 1, username: "admin", isAdmin: true };
    renderSidebar();
  });

  it("board tab room buttons are draggable for admins", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByTestId("public-room-10")).toBeTruthy();
    });

    const btn = screen.getByTestId("public-room-10");
    expect(btn.getAttribute("draggable")).toBe("true");
  });

  it("dragStart on a board room sets text/plain data for admins", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByTestId("public-room-20")).toBeTruthy();
    });

    const btn = screen.getByTestId("public-room-20");
    const { dt } = fireDragEvent(btn, "dragstart");

    expect(dt.getData("text/plain")).toBe("20");
    expect(dt.effectAllowed).toBe("move");
  });

  it("dragOver on a board room calls preventDefault for admins", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByTestId("public-room-10")).toBeTruthy();
    });

    const btn = screen.getByTestId("public-room-10");
    const { prevented } = fireDragEvent(btn, "dragover");

    expect(prevented).toBe(true);
  });

  it("dragOver on a board room sets dropEffect to move for admins", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByTestId("public-room-10")).toBeTruthy();
    });

    const btn = screen.getByTestId("public-room-10");
    const { dt } = fireDragEvent(btn, "dragover");

    expect(dt.dropEffect).toBe("move");
  });

  it("drop a room onto another room reorders within the same group", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByTestId("public-room-20")).toBeTruthy();
    });

    // Drag room 30 onto room 20 (which is in "Off Topic" group, id=2).
    const target = screen.getByTestId("public-room-20");
    fireDragEvent(target, "drop", { "text/plain": "30" });

    await waitFor(() => {
      expect(mockAddRoomToBoardGroup).toHaveBeenCalledWith(2, 30);
      expect(mockReorderBoardGroupRooms).toHaveBeenCalled();
    });
  });

  it("drop a room onto a board group adds the room to that group", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByText("Community")).toBeTruthy();
    });

    // Find the group header that contains "Community"
    const headers = Array.from(
      document.querySelectorAll('[draggable="true"]'),
    ).filter((el) => el.textContent?.includes("Community"));
    expect(headers.length).toBeGreaterThan(0);

    fireDragEvent(headers[0], "drop", { "text/plain": "30" });

    await waitFor(() => {
      expect(mockAddRoomToBoardGroup).toHaveBeenCalledWith(1, 30);
    });
  });

  it("drop a board group onto another board group reorders groups", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByText("Community")).toBeTruthy();
    });

    const headers = Array.from(
      document.querySelectorAll('[draggable="true"]'),
    ).filter((el) => el.textContent?.includes("Community"));
    expect(headers.length).toBeGreaterThan(0);

    fireDragEvent(headers[0], "drop", { "application/group-id": "2" });

    await waitFor(() => {
      expect(mockReorderBoardGroups).toHaveBeenCalled();
    });
  });

  it("drop a room onto the top-level zone removes it from board groups", async () => {
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByTestId("public-room-10")).toBeTruthy();
    });

    const containers = document.querySelectorAll(".overflow-y-auto");
    let listContainer: Element | null = null;
    containers.forEach((c) => {
      if (c.textContent?.includes("Community")) listContainer = c;
    });
    expect(listContainer).not.toBeNull();

    fireDragEvent(listContainer!, "drop", { "text/plain": "10" });

    await waitFor(() => {
      expect(mockRemoveRoomFromBoardGroup).toHaveBeenCalledWith(10);
    });
  });
});

describe("Drag-and-drop with no drag data (no-op scenarios)", () => {
  beforeEach(async () => {
    mockUser = { id: 1, username: "admin", isAdmin: true };
    renderSidebar();
    await switchToBoardTab();
    await waitFor(() => {
      expect(screen.getByTestId("public-room-10")).toBeTruthy();
    });
  });

  it("drop on a room with empty text/plain does nothing", () => {
    const btn = screen.getByTestId("public-room-20");
    fireDragEvent(btn, "drop", {});

    expect(mockAddRoomToBoardGroup).not.toHaveBeenCalled();
    expect(mockReorderBoardGroupRooms).not.toHaveBeenCalled();
  });

  it("drop on a room with the same room ID does nothing", () => {
    const btn = screen.getByTestId("public-room-20");
    fireDragEvent(btn, "drop", { "text/plain": "20" });

    // targetRoomId === draggedId → should bail early
    expect(mockAddRoomToBoardGroup).not.toHaveBeenCalled();
  });
});