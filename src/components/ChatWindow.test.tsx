// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ChatWindow from "./ChatWindow";
import type { Message } from "../types";

/**
 * Renders the real ChatWindow with its subcomponents mocked out, so the
 * header (room name + full room-type names) can be asserted directly.
 */

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, username: "alice", isAdmin: false } }),
}));
vi.mock("../services/api", () => ({
  uploadFile: vi.fn(),
}));
vi.mock("./MessageBubble", () => ({
  default: () => <div data-testid="mock-bubble" />,
}));
vi.mock("./MessageComposer", () => ({
  default: () => <div data-testid="mock-composer" />,
}));
vi.mock("./GifPicker", () => ({
  default: () => null,
}));

// jsdom doesn't implement scrollIntoView; stub it so the scroll effect runs.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// This project's vitest config doesn't enable `globals`, so testing-library's
// auto-cleanup never runs; unmount between tests to avoid DOM bleed.
afterEach(() => cleanup());

const noop = () => {};

function renderWindow(overrides: Partial<React.ComponentProps<typeof ChatWindow>> = {}) {
  return render(
    <ChatWindow
      messages={[] as Message[]}
      gcName="Secret Room"
      error=""
      isOwner={false}
      viewerIsStaff={false}
      viewerIsAdmin={false}
      hasMore={false}
      loadingOlder={false}
      onSendMessage={noop}
      onDeleteRoom={noop}
      onLeaveRoom={noop}
      onViewProfile={noop}
      onLoadOlder={noop}
      onSlashCommand={noop}
      onJoinRoom={noop}
      onModAction={noop}
      onRenameRoom={noop}
      roomTypeNames={[]}
      currentUserId={1}
      onEditMessage={noop}
      onDeleteMessage={noop}
      onToggleReaction={noop}
      lastReadId={0}
      onMarkAllRead={noop}
      highlightedMessageIds={new Set()}
      onPinMessage={noop}
      onUnpinMessage={noop}
      onJumpToMessage={noop}
      groupChatId={1}
      {...overrides}
    />
  );
}

describe("ChatWindow header room types", () => {
  it("shows the full room type names next to the room name", () => {
    renderWindow({ roomTypeNames: ["anonymous", "readonly"] });
    expect(screen.getAllByText("Secret Room").length).toBeGreaterThan(0);
    expect(screen.getByText("anonymous")).toBeTruthy();
    expect(screen.getByText("readonly")).toBeTruthy();
  });

  it("shows no type badge for a plain room", () => {
    renderWindow({ roomTypeNames: [] });
    expect(screen.getAllByText("Secret Room").length).toBeGreaterThan(0);
    expect(screen.queryByText("anonymous")).toBeNull();
  });

  it("reveals the rename button for the room owner", () => {
    renderWindow({ isOwner: true });
    expect(screen.getByTitle("Rename room")).toBeTruthy();
  });

  it("hides the rename button for non-owner, non-admin viewers", () => {
    renderWindow({ isOwner: false, viewerIsAdmin: false });
    expect(screen.queryByTitle("Rename room")).toBeNull();
  });

  it("shows the rename button for admins even when not the owner", () => {
    renderWindow({ isOwner: false, viewerIsAdmin: true });
    expect(screen.getByTitle("Rename room")).toBeTruthy();
  });
});