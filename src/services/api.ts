import type { GroupChat, Message, GiphyResponse, AuthUser } from "../types";

const API_BASE = "/api";

/** Fetch recent messages for a group chat */
export async function fetchMessages(
  groupChatId: number,
  numMessages = 20
): Promise<Message[]> {
  const res = await fetch(
    `${API_BASE}/getMessages?groupChatId=${groupChatId}&numMessages=${numMessages}`
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to fetch messages");
  }
  return res.json();
}

/** Fetch info for a group chat */
export async function fetchGCInfo(
  groupChatId: number
): Promise<GroupChat & { error?: string }> {
  const res = await fetch(
    `${API_BASE}/getGCInfo?groupChatId=${groupChatId}`
  );
  return res.json();
}

/** Create a new group chat */
export async function createGroupChat(
  id: number,
  name: string
): Promise<void> {
  const res = await fetch(`${API_BASE}/createGC`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, name }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to create group chat");
  }
}

/** Delete a group chat. Only the room owner may do this. */
export async function deleteGroupChat(groupChatId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/deleteGC`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupChatId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to delete room");
  }
}

/** Search GIPHY for GIFs */
export async function searchGifs(query: string): Promise<GiphyResponse> {
  const res = await fetch(
    `${API_BASE}/searchGifs?query=${encodeURIComponent(query)}`
  );
  if (!res.ok) {
    throw new Error("Failed to search GIFs");
  }
  return res.json();
}

/**
 * Sign up a new user. On success the server sets a session cookie, so the
 * caller is logged in immediately.
 */
export async function signup(
  username: string,
  password: string
): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? "Signup failed");
  }
  return body.user;
}

/** Log in an existing user. Sets a session cookie on success. */
export async function login(
  username: string,
  password: string
): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? "Login failed");
  }
  return body.user;
}

/** Log out — clears the server session and browser cookie. */
export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/logout`, { method: "POST" });
}

/** Fetch the current user from the session cookie. Returns null if logged out. */
export async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch(`${API_BASE}/me`);
  if (res.status === 401) return null;
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  return body ? body.user : null;
}