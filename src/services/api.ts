import type {
  GroupChat,
  Message,
  GiphyResponse,
  AuthUser,
  UserProfile,
  Reaction,
} from "../types";
import { MESSAGES_PAGE_SIZE } from "../constants";

const API_BASE = "/api";

/**
 * Shared JSON request helper: every endpoint parses the JSON body and, on a
 * non-2xx response, throws the server's `error` message (falling back to a
 * generic message). This removes the repeated fetch/parse/throw boilerplate
 * that used to live in every endpoint function.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, options);
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
  before?: { sentAt: string; id: number } | null
): Promise<Message[]> {
  const params = new URLSearchParams({
    groupChatId: String(groupChatId),
    limit: String(limit),
  });
  if (before) {
    params.set("beforeSentAt", before.sentAt);
    params.set("beforeId", String(before.id));
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
    `${API_BASE}/getGCInfo?groupChatId=${groupChatId}`
  );
  return res.json();
}

/** Create a new group chat. */
export async function createGroupChat(
  id: number,
  name: string,
  isPublic = false
): Promise<void> {
  await request("/createGC", jsonBody({ id, name, isPublic }));
}

/** Delete a group chat. Only the room owner may do this. */
export async function deleteGroupChat(groupChatId: number): Promise<void> {
  await request("/deleteGC", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupChatId }),
  });
}

/** Fetch discoverable public rooms for the rooms tab. */
export async function fetchPublicRooms(): Promise<GroupChat[]> {
  return request<GroupChat[]>("/publicRooms");
}

/** Fetch the rooms the current user is a member of (server-side record). */
export async function fetchMyRooms(): Promise<GroupChat[]> {
  return request<GroupChat[]>("/myRooms");
}

/** Add the current user to a room's member list (idempotent). */
export async function joinRoom(groupChatId: number): Promise<void> {
  await request("/joinRoom", jsonBody({ groupChatId }));
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

/** Fetch a user's public profile. */
export async function getProfile(username: string): Promise<UserProfile> {
  return request<UserProfile>(`/profile/${encodeURIComponent(username)}`);
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
    res = await fetch(`${API_BASE}/me`);
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
