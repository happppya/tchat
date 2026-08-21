/** A message from the database */
export interface Message {
  id: number;
  group_chat_id: number;
  display_name: string | null;
  message_text: string | null;
  gif_url: string | null;
  sent_at: string;
}

/** A group chat */
export interface GroupChat {
  id: number;
  name: string;
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

/** Selected GIF state */
export interface SelectedGif {
  id: string;
  url: string;
}