import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  signup,
  login,
  updateProfile,
  fetchMe,
  reactToMessage,
  fetchMessages,
  fetchGCInfo,
} from "./api";
import type { AuthUser, Reaction } from "../types";

const USER: AuthUser = {
  id: 7,
  username: "alice",
  bio: "hello",
  picture_url: null,
};

/** Build a JSON Response with a given status. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Build a non-JSON (HTML) Response, e.g. from a misconfigured proxy. */
function html(status = 200): Response {
  return new Response("<html><body>gateway</body></html>", {
    status,
    headers: { "Content-Type": "text/html" },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  // request() logs on non-2xx / non-JSON responses; keep test output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetchMock.mockReset();
});

describe("signup / login envelope handling", () => {
  it("signup posts to /api/signup and returns the user", async () => {
    fetchMock.mockResolvedValue(json({ user: USER }, 201));

    await expect(signup("alice", "password123")).resolves.toEqual(USER);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/signup");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
  });

  it("sends the localtunnel bypass header on every request", async () => {
    fetchMock.mockResolvedValue(json({ user: USER }, 201));

    await signup("alice", "password123");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { "Bypass-Tunnel-Reminder": "true" },
    });
  });

  it("login returns the user from the envelope", async () => {
    fetchMock.mockResolvedValue(json({ user: USER }));

    await expect(login("alice", "password123")).resolves.toEqual(USER);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/login");
  });

  it("throws a clear error when the envelope is missing user", async () => {
    fetchMock.mockResolvedValue(json({ ok: true }));

    await expect(login("alice", "password123")).rejects.toThrow(
      "unexpected response"
    );
  });
});

describe("request error handling", () => {
  it("surfaces a friendly network-failure message", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(signup("alice", "password123")).rejects.toThrow(
      "Can't reach the server"
    );
  });

  it("surfaces the server-provided error message", async () => {
    fetchMock.mockResolvedValue(json({ error: "Invalid username or password" }, 401));

    await expect(login("alice", "wrong")).rejects.toThrow(
      "Invalid username or password"
    );
  });

  it("surfaces a generic server error with its status", async () => {
    fetchMock.mockResolvedValue(json({}, 500));

    await expect(signup("alice", "password123")).rejects.toThrow(
      "Server error (500)"
    );
  });

  it("surfaces a generic request failure with its status", async () => {
    fetchMock.mockResolvedValue(json({}, 404));

    await expect(signup("alice", "password123")).rejects.toThrow(
      "Request failed (404)"
    );
  });

  it("throws a friendly error for a non-JSON 2xx body", async () => {
    fetchMock.mockResolvedValue(html(200));

    await expect(signup("alice", "password123")).rejects.toThrow(
      "unexpected response"
    );
  });
});

describe("updateProfile", () => {
  it("returns the user from the envelope", async () => {
    fetchMock.mockResolvedValue(json({ user: USER }));

    await expect(updateProfile("bio", "https://example.com/a.png")).resolves.toEqual(
      USER
    );
    expect(fetchMock.mock.calls[0][0]).toBe("/api/profile");
  });

  it("throws when the envelope is missing user", async () => {
    fetchMock.mockResolvedValue(json({}));

    await expect(updateProfile("bio", "")).rejects.toThrow("unexpected response");
  });
});

describe("fetchMe", () => {
  it("returns null for a 401 (logged out)", async () => {
    fetchMock.mockResolvedValue(json({ error: "Not authenticated" }, 401));

    await expect(fetchMe()).resolves.toBeNull();
  });

  it("returns the user on success", async () => {
    fetchMock.mockResolvedValue(json({ user: USER }));

    await expect(fetchMe()).resolves.toEqual(USER);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/me");
  });

  it("includes the localtunnel bypass header", async () => {
    fetchMock.mockResolvedValue(json({ user: USER }));

    await fetchMe();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { "Bypass-Tunnel-Reminder": "true" },
    });
  });

  it("throws on a server error", async () => {
    fetchMock.mockResolvedValue(json({}, 500));

    await expect(fetchMe()).rejects.toThrow("Failed to load your account (500)");
  });

  it("throws on a network failure", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(fetchMe()).rejects.toThrow("Can't reach the server");
  });
});

describe("reactToMessage", () => {
  it("returns the reactions array from the envelope", async () => {
    const reactions: Reaction[] = [{ emoji: "👍", count: 1, me: true }];
    fetchMock.mockResolvedValue(json({ reactions }));

    await expect(reactToMessage(5, "👍")).resolves.toEqual(reactions);
  });

  it("defaults to an empty array when reactions are missing", async () => {
    fetchMock.mockResolvedValue(json({}));

    await expect(reactToMessage(5, "👍")).resolves.toEqual([]);
  });
});

describe("fetchMessages", () => {
  it("requests the page with the limit and returns the array", async () => {
    const messages = [{ id: 1, group_chat_id: 42 }];
    fetchMock.mockResolvedValue(json(messages));

    await expect(fetchMessages(42, 10)).resolves.toEqual(messages);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/getMessages?groupChatId=42&limit=10"
    );
  });
});

describe("fetchGCInfo", () => {
  it("parses the response JSON", async () => {
    fetchMock.mockResolvedValue(json({ id: 7, name: "room" }));

    await expect(fetchGCInfo(7)).resolves.toEqual({ id: 7, name: "room" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/getGCInfo?groupChatId=7");
  });
});
