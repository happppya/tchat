/** A group chat */
export interface GroupChat {
  id: number;
  name: string;
  /** User id of the room's creator, when known. Null for legacy rooms. */
  owner_user_id?: number | null;
  is_hidden?: number | null;
  password_hash?: string | null;
  is_readonly?: number | null;
  is_anonymous?: number | null;
  is_transparent?: number | null;
  is_public?: number | null;
  is_forum?: number | null;
}

/** Saved group chat in local storage */
export interface SavedGC {
  id: number;
  name: string;
}

/** A local group that contains rooms (my rooms tab). */
export interface LocalGroup {
  id: string;
  name: string;
  roomIds: number[];
}

/** A board group from the server (board tab). */
export interface BoardGroup {
  id: number;
  name: string;
  roomIds: number[];
  position: number;
}
