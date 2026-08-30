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
