import type {
  GroupChat,
  Message,
  ForumPost,
  GiphyResponse,
  AuthUser,
  UserProfile,
  Reaction,
  BoardGroup,
} from "../types";
import { API_BASE, MESSAGES_PAGE_SIZE } from "../constants";

/**
 * Header required by localtunnel to skip its interstitial reminder page.
 * Sent on every request so tunneled traffic reaches the app directly.
 */
const TUNNEL_HEADERS = { "Bypass-Tunnel-Reminder": "true" } as const;

/**
 * Shared JSON request helper: every endpoint parses the JSON body and, on a
 * non-2xx response, throws the server's `error` message (falling back to a
 * generic message). This removes the repeated fetch/parse/throw boilerplate
 * that used to live in every endpoint function.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        ...TUNNEL_HEADERS,
        ...(options.headers ?? {}),
      },
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const serverError = (body as { error?: string } | null)?.error;
    if (serverError) throw new Error(serverError);
    console.error(
      `[api] ${path} -> ${res.status} (${res.headers.get("content-type") || "no content-type"})`
    );
    throw new Error(
      res.status >= 500
        ? `Server error (${res.status}). Please try again.`
        : `Request failed (${res.status}).`
    );
  }
  if (body == null) {
    console.error(`[api] ${path} -> ${res.status} with an empty/non-JSON body`);
    throw new Error("The server returned an unexpected response. Please try again.");
  }
  return body as T;
}

/** JSON-POST body shorthand used by most mutating endpoints. */
function jsonBody(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * Extract the `user` object from a `{ user }` envelope, throwing a clear
 * message when the response is malformed. A null envelope here is what used to
 * surface as the cryptic "Cannot read properties of null (reading 'user')".
 */
function extractUser(body: unknown): AuthUser {
  const user = (body as { user?: AuthUser } | null)?.user;
  if (!user) {
    throw new Error("The server returned an unexpected response. Please try again.");
  }
  return user;
}

/**
 * Fetch a page of messages for a group chat, newest first (server ordering).
 * Pass `before` to fetch the page strictly older than that cursor for
 * scroll-up pagination.
 */
export async function fetchMessages(
  groupChatId: number,
  limit = MESSAGES_PAGE_SIZE,
  before?: { sentAt: string; id: number } | null,
  forumPostId?: number | null
): Promise<Message[]> {
  const params = new URLSearchParams({
    groupChatId: String(groupChatId),
    limit: String(limit),
  });
  if (before) {
    params.set("beforeSentAt", before.sentAt);
    params.set("beforeId", String(before.id));
  }
  if (forumPostId != null) {
    params.set("forumPostId", String(forumPostId));
  }
  return request<Message[]>(`/getMessages?${params.toString()}`);
}

/**
 * Fetch info for a group chat. Kept non-throwing on error statuses so callers
 * can distinguish an "invalid room" body from a network failure.
 */
export async function fetchGCInfo(
  groupChatId: number
): Promise<GroupChat & { error?: string }> {
  const res = await fetch(
    `${API_BASE}/getGCInfo?groupChatId=${groupChatId}`,
    { credentials: "include", headers: { ...TUNNEL_HEADERS } }
  );
  return res.json();
}

/** Create a new group chat (admin only). */
export async function createGroupChat(
  id: number,
  name: string,
  opts: {
    isHidden?: boolean;
    password?: string;
    isReadonly?: boolean;
    isAnonymous?: boolean;
    isTransparent?: boolean;
    isPublic?: boolean;
    isForum?: boolean;
  } = {}
): Promise<void> {
  await request(
    "/createGC",
    jsonBody({ id, name, ...opts })
  );
}

/** Rename a room (owner or admin). */
export async function renameRoom(groupChatId: number, name: string): Promise<{ name: string }> {
  return request("/renameRoom", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupChatId, name }),
  });
}

/** Delete a group chat. Only the room owner may do this. */
export async function deleteGroupChat(groupChatId: number): Promise<void> {
  await request("/deleteGC", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupChatId }),
  });
}

/** Fetch public rooms for the board tab. */
export async function fetchPublicRooms(): Promise<GroupChat[]> {
  return request<GroupChat[]>("/publicRooms");
}

/** Fetch the rooms the current user is a member of (server-side record). */
export async function fetchMyRooms(): Promise<GroupChat[]> {
  return request<GroupChat[]>("/myRooms");
}

/** Add the current user to a room's member list (idempotent). */
export async function joinRoom(
  groupChatId: number,
  password?: string
): Promise<{ message: string; anonName?: string | null }> {
  return request("/joinRoom", jsonBody({ groupChatId, password }));
}

/** Remove the current user from a room's member list. */
export async function leaveRoom(groupChatId: number): Promise<void> {
  await request("/leaveRoom", jsonBody({ groupChatId }));
}

/** Edit the body of one of your own messages. Returns the updated row. */
export async function editMessage(
  messageId: number,
  messageText: string
): Promise<Message> {
  return request<Message>("/editMessage", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId, messageText }),
  });
}

/** Delete one of your own messages. */
export async function deleteMessage(messageId: number): Promise<void> {
  await request("/deleteMessage", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messageId }),
  });
}

/** Toggle an emoji reaction on a message; returns the updated aggregate. */
export async function reactToMessage(
  messageId: number,
  emoji: string
): Promise<Reaction[]> {
  const body = await request<{ reactions: Reaction[] }>(
    "/reactToMessage",
    jsonBody({ messageId, emoji })
  );
  return body.reactions ?? [];
}

// ---------------------------------------------------------------------------
// Forum
// ---------------------------------------------------------------------------

/** Create a new forum post and return it. */
export async function createForumPost(
  groupChatId: number,
  title: string,
  content: string
): Promise<ForumPost> {
  return request<ForumPost>("/createForumPost", jsonBody({ groupChatId, title, content }));
}

/** List forum posts for a room. */
export async function fetchForumPosts(
  groupChatId: number,
  sort: 'recent' | 'date' | 'alpha' = 'recent',
  offset: number = 0
): Promise<ForumPost[]> {
  const qs = new URLSearchParams({
    groupChatId: String(groupChatId),
    sort,
    offset: String(offset),
  });
  return request<ForumPost[]>(`/getForumPosts?${qs.toString()}`);
}

/** Search forum posts by title/content. */
export async function searchForumPosts(
  groupChatId: number,
  query: string
): Promise<ForumPost[]> {
  const qs = new URLSearchParams({ groupChatId: String(groupChatId), query });
  return request<ForumPost[]>(`/searchForumPosts?${qs.toString()}`);
}

/** Get a single forum post by id. */
export async function getForumPost(postId: number): Promise<ForumPost> {
  return request<ForumPost>(`/getForumPost?postId=${postId}`);
}

/** Edit a forum post (author, owner, or admin). */
export async function editForumPost(
  postId: number,
  title: string,
  content: string
): Promise<ForumPost> {
  return request<ForumPost>("/editForumPost", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postId, title, content }),
  });
}

/** Delete a forum post and all its thread messages (author, owner, or admin). */
export async function deleteForumPost(postId: number): Promise<void> {
  await request("/deleteForumPost", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postId }),
  });
}

/** Pin a message (owner, mod, or admin only). */
export async function pinMessage(
  messageId: number
): Promise<{ pinned: number }> {
  return request("/pinMessage", jsonBody({ messageId }));
}

/** Unpin a message (owner, mod, or admin only). */
export async function unpinMessage(
  messageId: number
): Promise<{ pinned: number }> {
  return request("/unpinMessage", jsonBody({ messageId }));
}

/** Fetch pinned messages for a room. */
export async function fetchPinnedMessages(groupChatId: number): Promise<Message[]> {
  return request<Message[]>(`/getPinnedMessages?groupChatId=${groupChatId}`);
}

/** Upload response: the served URL plus display metadata. */
export interface UploadedFile {
  url: string;
  fileName: string;
  fileType: string;
  size: number;
}

/** Upload a small file (as a base64 data URL) and return its served URL. */
export async function uploadFile(
  fileName: string,
  dataUrl: string
): Promise<UploadedFile> {
  return request<UploadedFile>("/upload", jsonBody({ fileName, dataUrl }));
}

/** Fetch a user's public profile, optionally scoped to a room. */
export async function getProfile(username: string, groupChatId?: number | null): Promise<UserProfile> {
  const qs = groupChatId ? `?groupChatId=${groupChatId}` : '';
  return request<UserProfile>(`/profile/${encodeURIComponent(username)}${qs}`);
}

/** Update the current user's bio and optional profile picture. */
export async function updateProfile(
  bio: string,
  pictureUrl: string
): Promise<AuthUser> {
  const body = await request<{ user: AuthUser }>(
    "/profile",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bio, pictureUrl }),
    }
  );
  return extractUser(body);
}

/** Search GIPHY for GIFs. */
export async function searchGifs(query: string): Promise<GiphyResponse> {
  return request<GiphyResponse>(`/searchGifs?query=${encodeURIComponent(query)}`);
}

/**
 * Sign up a new user. On success the server sets a session cookie, so the
 * caller is logged in immediately.
 */
export async function signup(
  username: string,
  password: string
): Promise<AuthUser> {
  const body = await request<{ user: AuthUser }>(
    "/signup",
    jsonBody({ username, password })
  );
  return extractUser(body);
}

/** Log in an existing user. Sets a session cookie on success. */
export async function login(
  username: string,
  password: string
): Promise<AuthUser> {
  const body = await request<{ user: AuthUser }>(
    "/login",
    jsonBody({ username, password })
  );
  return extractUser(body);
}

/** Log out — clears the server session and browser cookie. */
export async function logout(): Promise<void> {
  await request("/logout", { method: "POST" });
}

/**
 * Fetch the current user from the session cookie. Returns null when there is
 * no valid session (401); throws on network failures or server errors so
 * callers can tell "logged out" apart from "can't check right now".
 */
export async function fetchMe(): Promise<AuthUser | null> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/me`, {
      credentials: "include",
      headers: { ...TUNNEL_HEADERS },
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(`Failed to load your account (${res.status}).`);
  }
  const body = await res.json().catch(() => null);
  return body ? body.user : null;
}

/** Executes a room moderation command (kick, ban, mute, mod, etc.). */
export async function roomCommand(
  groupChatId: number,
  command: string,
  targetUsername: string
): Promise<{ message: string }> {
  return request(
    "/roomCommand",
    jsonBody({ groupChatId, command, targetUsername })
  );
}

/** Live mute/mod status of a user in a room (for the staff name menu). */
export async function fetchRoomUserStatus(
  groupChatId: number,
  username: string
): Promise<{ muted: boolean; isMod: boolean }> {
  const s = await request<{ username: string; muted: boolean; isMod: boolean }>(
    `/roomUserStatus?groupChatId=${groupChatId}&username=${encodeURIComponent(username)}`
  );
  return { muted: s.muted, isMod: s.isMod };
}

/** A muted user in a room, as returned by /roomMutes. */
export interface RoomMuteEntry {
  user_id: number;
  username: string;
  muted_at: string;
}

/** List muted users in a room (staff only). */
export async function fetchRoomMutes(
  groupChatId: number
): Promise<RoomMuteEntry[]> {
  const res = await request<{ mutes: RoomMuteEntry[] }>(
    `/roomMutes?groupChatId=${groupChatId}`
  );
  return res.mutes;
}

/** A banned user in a room, as returned by /roomBans. */
export interface RoomBanEntry {
  user_id: number;
  username: string;
  banned_at: string;
}

/** List banned users in a room (staff only). */
export async function fetchRoomBans(
  groupChatId: number
): Promise<RoomBanEntry[]> {
  const res = await request<{ bans: RoomBanEntry[] }>(
    `/roomBans?groupChatId=${groupChatId}`
  );
  return res.bans;
}

// ---------------------------------------------------------------------------
// Board groups — admin-only mutations, anyone can read
// ---------------------------------------------------------------------------

/** Fetch board groups with their room ids. */
export async function fetchBoardGroups(): Promise<BoardGroup[]> {
  return request<BoardGroup[]>("/boardGroups");
}

/** Create a board group (admin only). */
export async function createBoardGroup(name: string): Promise<BoardGroup> {
  return request<BoardGroup>("/boardGroups", jsonBody({ name }));
}

/** Rename a board group (admin only). */
export async function renameBoardGroup(id: number, name: string): Promise<void> {
  await request(`/boardGroups/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

/** Delete a board group (admin only). */
export async function deleteBoardGroup(id: number): Promise<void> {
  await request(`/boardGroups/${id}`, { method: "DELETE" });
}

/** Reorder board groups (admin only). */
export async function reorderBoardGroups(ids: number[]): Promise<void> {
  await request("/boardGroups/reorder", jsonBody({ ids }));
}

/** Add a room to a board group (admin only). */
export async function addRoomToBoardGroup(groupId: number, roomId: number): Promise<void> {
  await request(`/boardGroups/${groupId}/rooms`, jsonBody({ roomId }));
}

/** Remove a room from its board group (admin only). */
export async function removeRoomFromBoardGroup(roomId: number): Promise<void> {
  await request(`/boardGroups/rooms/${roomId}`, { method: "DELETE" });
}

/** Reorder rooms within a board group (admin only). */
export async function reorderBoardGroupRooms(groupId: number, roomIds: number[]): Promise<void> {
  await request(`/boardGroups/${groupId}/reorder-rooms`, jsonBody({ roomIds }));
}
