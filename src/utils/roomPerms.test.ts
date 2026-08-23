import { describe, expect, it } from "vitest";
import { canRenameRoom } from "./roomPerms";

describe("canRenameRoom", () => {
  it("lets admins rename rooms on either tab", () => {
    expect(
      canRenameRoom({ tab: "myrooms", isAdmin: true, roomOwnerId: 5, userId: 5 })
    ).toBe(true);
    expect(
      canRenameRoom({ tab: "board", isAdmin: true, roomOwnerId: 5, userId: null })
    ).toBe(true);
  });

  it("lets the room owner rename their own room on the my rooms tab", () => {
    expect(
      canRenameRoom({ tab: "myrooms", isAdmin: false, roomOwnerId: 7, userId: 7 })
    ).toBe(true);
  });

  it("denies non-owners on the my rooms tab", () => {
    expect(
      canRenameRoom({ tab: "myrooms", isAdmin: false, roomOwnerId: 7, userId: 8 })
    ).toBe(false);
  });

  it("denies non-admins on the board tab even when they own the room", () => {
    expect(
      canRenameRoom({ tab: "board", isAdmin: false, roomOwnerId: 7, userId: 7 })
    ).toBe(false);
  });

  it("denies when the room owner is unknown", () => {
    expect(
      canRenameRoom({ tab: "myrooms", isAdmin: false, roomOwnerId: undefined, userId: 7 })
    ).toBe(false);
    expect(
      canRenameRoom({ tab: "myrooms", isAdmin: false, roomOwnerId: null, userId: 7 })
    ).toBe(false);
  });

  it("denies when the user is logged out", () => {
    expect(
      canRenameRoom({ tab: "myrooms", isAdmin: false, roomOwnerId: 7, userId: null })
    ).toBe(false);
  });
});