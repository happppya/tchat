/** A message from the database */
export interface Message {
  id: number;
  group_chat_id: number;
  display_name: string | null;
  /** Real username (for moderation in anonymous rooms). */
  username?: string | null;
  message_text: string | null;
  gif_url: string | null;
  sent_at: string;
  /** Authenticated author id, used to authorize edit/delete. Null for legacy rows. */
  user_id?: number | null;
  /** Timestamp of the most recent edit, if any. */
  edited_at?: string | null;
  /** Speaker tag: null for normal users, "sys" for system messages. */
  speaker?: string | null;
  /** Denormalized author avatar URL captured when the message was sent. */
  avatar_url?: string | null;
  /** Uploaded attachment (served URL + display metadata), when present. */
  file_url?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  /** Message being replied to (denormalized at reply time). */
  reply_to_id?: number | null;
  reply_quote?: string | null;
  reply_author?: string | null;
  /** Emoji reactions attached to this message. */
  reactions?: Reaction[];
  /** forum_post_id links this message to a forum thread. Null for regular chat. */
  forum_post_id?: number | null;
  /** Whether this message has been pinned by an owner, mod, or admin. */
  pinned?: number | null;
}

/** Aggregate emoji reaction on a message. */
export interface Reaction {
  emoji: string;
  count: number;
  /** Whether the current viewer has reacted with this emoji. */
  me: boolean;
}

/** A message the user is currently composing a reply to. */
export interface ReplyTarget {
  id: number;
  quote: string;
  author: string;
}

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

/** Incoming WebSocket message */
export interface WSMessage {
  type:
    | "message"
    | "editMessage"
    | "deleteMessage"
    | "deleteRoom"
    | "renameRoom"
    | "kicked"
    | "banned"
    | "messageReactions"
    | "pinMessage"
    | "unpinMessage"
    | "error"
    | "pong";
  message?: string;
  groupChatId: number;
  /** Real DB id echoed back on send and on edit/delete events. */
  id?: number;
  /** Author user id echoed back on send. */
  userId?: number;
  /** Target message id for editMessage/deleteMessage events. */
  messageId?: number;
  /** New body for editMessage events. */
  messageText?: string;
  /** Edit timestamp for editMessage events. */
  editedAt?: string;
  /** Reply metadata echoed back on a sent message. */
  replyToId?: number | null;
  replyQuote?: string | null;
  replyAuthor?: string | null;
  /** Reaction aggregate for messageReactions events. */
  reactions?: Reaction[];
  displayNameText?: string;
  /** New room name for renameRoom events. */
  name?: string;
  /** Real username (not display name) — for admin mod actions in anon rooms. */
  username?: string;
  /** Speaker tag: null for normal users, "sys" for system messages. */
  speaker?: string | null;
  gifUrl?: string | null;
  timestamp?: string;
  avatarUrl?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
  /** forum post id for scoping messages to a thread. */
  forumPostId?: number | null;
}

/** GIPHY image variants */
export interface GiphyImage {
  url: string;
  width: string;
  height: string;
}

/** A single GIPHY result */
export interface GiphyResult {
  id: string;
  title: string;
  images: {
    fixed_width_small: GiphyImage;
    original: GiphyImage;
  };
}

/** GIPHY search API response */
export interface GiphyResponse {
  data: GiphyResult[];
}

/** API error response */
export interface ApiError {
  error: string;
}

/** Authenticated user returned by /api/signup, /api/login, /api/me */
export interface AuthUser {
  id: number;
  username: string;
  isAdmin?: boolean;
  bio?: string | null;
  picture_url?: string | null;
}

/** Public profile returned by /api/profile/:username */
export interface UserProfile {
  username: string;
  bio: string | null;
  picture_url: string | null;
  isAdmin?: boolean;
  isRoomOwner?: boolean;
}

/** A file attachment attached to an outgoing message. */
export interface FileAttachment {
  url: string;
  name: string;
  type: string;
}/** Selected GIF state */
export interface SelectedGif {
  id: string;
  url: string;
}

/** A forum post / thread. */
export interface ForumPost {
  id: number;
  group_chat_id: number;
  title: string;
  content: string;
  author_id: number;
  display_name: string;
  created_at: string;
  updated_at: string;
  reply_count?: number;
}
