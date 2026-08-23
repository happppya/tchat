import { describe, expect, it } from "vitest";
import { roomTypeTags, roomTypeFullNames } from "./roomTypes";
import type { GroupChat } from "../types";

const room = (flags: Partial<GroupChat>): GroupChat => ({
  id: 1,
  name: "Room",
  ...flags,
});

describe("roomTypeTags", () => {
  it("maps each flag to a shorthand code", () => {
    expect(
      roomTypeTags(
        room({ is_anonymous: 1, is_hidden: 1, is_readonly: 1, is_transparent: 1, is_public: 1 })
      )
    ).toEqual([
      { code: "[A]", full: "anonymous" },
      { code: "[H]", full: "hidden" },
      { code: "[R]", full: "readonly" },
      { code: "[T]", full: "transparent" },
      { code: "[P]", full: "public" },
    ]);
  });

  it("returns the anonymous shorthand for an anonymous room", () => {
    expect(roomTypeTags(room({ is_anonymous: 1 }))).toEqual([
      { code: "[A]", full: "anonymous" },
    ]);
  });

  it("returns no tags for a room with no type flags", () => {
    expect(roomTypeTags(room({}))).toEqual([]);
  });

  it("treats falsy/undefined flags as off", () => {
    expect(
      roomTypeTags({
        id: 1,
        name: "x",
        is_anonymous: 0,
        is_hidden: undefined,
      } as unknown as GroupChat)
    ).toEqual([]);
  });
});

describe("roomTypeFullNames", () => {
  it("returns the full names for the chat header", () => {
    expect(roomTypeFullNames(room({ is_anonymous: 1, is_readonly: 1 }))).toEqual([
      "anonymous",
      "readonly",
    ]);
  });

  it("returns an empty list for a plain room", () => {
    expect(roomTypeFullNames(room({}))).toEqual([]);
  });
});