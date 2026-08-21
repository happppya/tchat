/** A message from the database */
export interface Message {
  id: number;
  group_chat_id: number;
  display_name: string | null;
  message_text: string | null;
  gif_url: string | null;
  sent_at: string;
  /** Denormalized author avatar URL captured when the message was sent. */
  avatar_url?: string | null;
  /** Uploaded attachment (served URL + display metadata), when present. */
  file_url?: string | null;
  file_name?: string | null;
  file_type?: string | null;
}

/** A group chat */
export interface GroupChat {
  id: number;
  name: string;
  /** User id of the room's creator, when known. Null for legacy rooms. */
  owner_user_id?: number | null;
}

/** Saved group chat in local storage */
export interface SavedGC {
  id: number;
  name: string;
}

/** Incoming WebSocket message */
export interface WSMessage {
  type: "message" | "error" | "pong";
  groupChatId: number;
  messageText?: string;
  displayNameText?: string;
  gifUrl?: string | null;
  timestamp?: string;
  avatarUrl?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileType?: string | null;
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
  bio?: string | null;
  picture_url?: string | null;
}

/** Public profile returned by /api/profile/:username */
export interface UserProfile {
  username: string;
  bio: string | null;
  picture_url: string | null;
}

/** A file attachment attached to an outgoing message. */
export interface FileAttachment {
  url: string;
  name: string;
  type: string;
}

/** Selected GIF state */
export interface SelectedGif {
  id: string;
  url: string;
}