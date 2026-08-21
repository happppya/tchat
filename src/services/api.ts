import type { GroupChat, Message, GiphyResponse } from "../types";

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
  if (!res.ok) {
    throw new Error("Failed to create group chat");
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