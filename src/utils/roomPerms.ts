/**
 * Whether the sidebar may offer a rename control for a room. Server-side,
 * PUT /renameRoom allows the room owner or any site admin; the client mirrors
 * that rule so the button only appears for users who can actually rename.
 */
export interface CanRenameRoomArgs {
  tab: "myrooms" | "board";
  /** Whether the current user is a site admin. */
  isAdmin: boolean;
  /** The room's creator id from the server, when known. */
  roomOwnerId: number | null | undefined;
  /** The current user's id (null when logged out). */
  userId: number | null;
}

export function canRenameRoom({
  tab,
  isAdmin,
  roomOwnerId,
  userId,
}: CanRenameRoomArgs): boolean {
  if (isAdmin) return true;
  // Non-admins cannot mutate the board tab at all.
  if (tab === "board") return false;
  return (
    userId !== null &&
    roomOwnerId !== null &&
    roomOwnerId !== undefined &&
    roomOwnerId === userId
  );
}