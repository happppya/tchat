/** Room type flags + human-readable type names (anonymous, readonly, ...). */
import type { GroupChat } from "../types";

/**
 * Room-type flags, shared by the sidebar and the chat header.
 *
 * The sidebar shows short bracket codes ([A], [H], …) on room rows because the
 * old emoji tags were cryptic; the active room's header shows the full names
 * ("anonymous", "hidden", …). Both are derived from the same ordered list so
 * they can never drift apart.
 */

export interface RoomTypeTag {
  /** Short code shown in the sidebar, e.g. "[A]". */
  code: string;
  /** Full lowercase name shown in the room header, e.g. "anonymous". */
  full: string;
}

type RoomTypeFlags = Pick<
  GroupChat,
  "is_anonymous" | "is_hidden" | "is_readonly" | "is_transparent" | "is_public" | "is_forum"
>;

/** A room's type flags in a fixed order, each with a code + full name. */
export function roomTypeTags(room: RoomTypeFlags): RoomTypeTag[] {
  const tags: RoomTypeTag[] = [];
  if (room.is_anonymous) tags.push({ code: "[A]", full: "anonymous" });
  if (room.is_hidden) tags.push({ code: "[H]", full: "hidden" });
  if (room.is_readonly) tags.push({ code: "[R]", full: "readonly" });
  if (room.is_transparent) tags.push({ code: "[T]", full: "transparent" });
  if (room.is_public) tags.push({ code: "[P]", full: "public" });
  if (room.is_forum) tags.push({ code: "[F]", full: "forum" });
  return tags;
}

/** Full names of a room's type flags, e.g. ["anonymous", "readonly"]. */
export function roomTypeFullNames(room: RoomTypeFlags): string[] {
  return roomTypeTags(room).map((t) => t.full);
}