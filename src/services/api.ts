import type { GroupChat, Message, GiphyResponse, AuthUser, UserProfile } from "../types";
import { MESSAGES_PAGE_SIZE } from "../constants";

const API_BASE = "/api";

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
  const res = await fetch(`${API_BASE}/getMessages?${params.toString()}`);
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

/** Fetch the rooms the current user is a member of (server-side record). */
export async function fetchMyRooms(): Promise<GroupChat[]> {
  const res = await fetch(`${API_BASE}/myRooms`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to load rooms");
  }
  return body;
}

/** Add the current user to a room's member list (idempotent). */
export async function joinRoom(groupChatId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/joinRoom`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupChatId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to join room");
  }
}

/** Remove the current user from a room's member list. */
export async function leaveRoom(groupChatId: number): Promise<void> {
  const res = await fetch(`${API_BASE}/leaveRoom`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupChatId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to leave room");
  }
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
  const res = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, dataUrl }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to upload file");
  }
  return body;
}

/** Fetch a user's public profile. */
export async function getProfile(username: string): Promise<UserProfile> {
  const res = await fetch(`${API_BASE}/profile/${encodeURIComponent(username)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to load profile");
  }
  return body;
}

/** Update the current user's bio and optional profile picture. */
export async function updateProfile(
  bio: string,
  pictureUrl: string
): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/profile`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bio, pictureUrl }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? "Failed to save profile");
  }
  return body.user;
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