// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import MessageComposer from "./MessageComposer";
import * as apiModule from "../../services/api";

// jsdom doesn't implement scrollIntoView
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

vi.mock("../../services/api", () => ({
  uploadFile: vi.fn(),
}));

afterEach(() => cleanup());

const noop = () => {};

function renderComposer(overrides: Partial<React.ComponentProps<typeof MessageComposer>> = {}) {
  return render(
    <MessageComposer
      onSend={noop}
      onSlashCommand={overrides.onSlashCommand ?? noop}
      memberNames={overrides.memberNames ?? []}
      viewerIsStaff={overrides.viewerIsStaff ?? false}
      viewerIsAdmin={overrides.viewerIsAdmin ?? false}
    />
  );
}

function typeInComposer(text: string) {
  const input = screen.getByTestId("message-input");
  fireEvent.change(input, { target: { value: text } });
  return input;
}

function pressKey(input: HTMLElement, key: string, shiftKey = false) {
  fireEvent.keyDown(input, { key, shiftKey });
}

describe("MessageComposer slash commands", () => {
  it("executes a complete slash command on Enter when popover is open", async () => {
    const onSlashCommand = vi.fn();
    renderComposer({ onSlashCommand, memberNames: ["bob"] });

    // Type "/join " — complete command with hint
    const input = typeInComposer("/join ");

    // Popover should appear with the hint
    expect(screen.getByText("#roomcode")).toBeTruthy();

    // Press Enter — should execute the command
    pressKey(input, "Enter");
    expect(onSlashCommand).toHaveBeenCalledWith("join", "#");
  });

  it("executes a mod command with target on Enter when popover is open", async () => {
    const onSlashCommand = vi.fn();
    renderComposer({ onSlashCommand, memberNames: ["bob"], viewerIsStaff: true });

    // Type "/kick @b" — complete command selecting a target
    const input = typeInComposer("/kick @b");

    // Popover should show bob
    expect(screen.getByText("bob")).toBeTruthy();

    // Press Enter — should execute the command
    pressKey(input, "Enter");
    expect(onSlashCommand).toHaveBeenCalledWith("kick", "@bob");
  });

  it("completes command name on Enter when command is not fully typed", async () => {
    const onSlashCommand = vi.fn();
    renderComposer({ onSlashCommand });

    // Type "/jo" — partial command
    const input = typeInComposer("/jo");

    // Popover should show matching commands
    expect(screen.getByText("/join")).toBeTruthy();

    // Press Enter — should complete to "/join " but NOT send
    pressKey(input, "Enter");
    expect(onSlashCommand).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe("/join ");
  });
});

describe("MessageComposer command permission filtering", () => {
  it("hides staff-only commands from non-staff users", () => {
    renderComposer({ viewerIsStaff: false });

    // Type "/" — should show available commands
    const input = typeInComposer("/");

    // Non-staff should not see moderation commands
    expect(screen.queryByText("/kick")).toBeNull();
    expect(screen.queryByText("/ban")).toBeNull();
    expect(screen.queryByText("/mod")).toBeNull();

    // But should see public commands
    expect(screen.getByText("/join")).toBeTruthy();
    expect(screen.getByText("/leave")).toBeTruthy();
    expect(screen.getByText("/help")).toBeTruthy();
  });

  it("shows staff-only commands to staff users", () => {
    renderComposer({ viewerIsStaff: true });

    const input = typeInComposer("/");

    // Staff should see all commands
    expect(screen.getByText("/kick")).toBeTruthy();
    expect(screen.getByText("/ban")).toBeTruthy();
    expect(screen.getByText("/mod")).toBeTruthy();
  });

  it("does not autocomplete staff commands for non-staff", () => {
    renderComposer({ viewerIsStaff: false });

    // Type a partial mod command
    typeInComposer("/ki");

    // Should not match /kick at all
    expect(screen.queryByText("/kick")).toBeNull();
  });

  it("does not show @username autocomplete for non-existent commands in non-staff", () => {
    const onSlashCommand = vi.fn();
    renderComposer({ onSlashCommand, viewerIsStaff: false, memberNames: ["bob"] });

    // Type "/kick @b" — /kick should not be recognized for non-staff
    const input = typeInComposer("/kick @b");

    // No popover should appear because /kick doesn't exist for this user
    expect(screen.queryByText("bob")).toBeNull();

    // Press Enter — should send as regular text (via onSend), not slash command
    pressKey(input, "Enter");
    expect(onSlashCommand).not.toHaveBeenCalled();
  });
});