// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useAuth } from "./useAuth";

/**
 * When the browser refuses to store the session cookie (incognito with
 * third-party cookies blocked, strict cookie settings), the account itself was
 * still created server-side. Signup/login must succeed and adopt the returned
 * user, flagging that persistence failed instead of dead-ending the flow.
 */

vi.mock("../services/api", () => ({
  fetchMe: vi.fn(),
  login: vi.fn(),
  signup: vi.fn(),
  logout: vi.fn(),
}));

import {
  fetchMe,
  login as apiLogin,
  signup as apiSignup,
  logout as apiLogout,
} from "../services/api";

const alice = { id: 1, username: "alice", bio: "", picture_url: null };

const mockedSignup = apiSignup as ReturnType<typeof vi.fn>;
const mockedLogin = apiLogin as ReturnType<typeof vi.fn>;
const mockedFetchMe = fetchMe as ReturnType<typeof vi.fn>;
const mockedLogout = apiLogout as ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.clearAllMocks();
  // Safe defaults BEFORE any render: the module-level ensureInit runs its
  // one-time /api/me check on the very first mount below.
  mockedFetchMe.mockResolvedValue(null);
  mockedLogout.mockResolvedValue(undefined);

  // Reset the module-level auth store between tests.
  const { result } = renderHook(() => useAuth());
  await act(async () => {
    await result.current.logout();
  });
});

describe("useAuth when the session cookie cannot be saved", () => {
  it("signup succeeds and adopts the user even though verification fails", async () => {
    mockedSignup.mockResolvedValue(alice);
    mockedFetchMe.mockResolvedValue(null); // 401 → cookie was dropped

    const { result } = renderHook(() => useAuth());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.signup("alice", "password123");
    });

    expect(returned).toEqual(alice); // did NOT throw
    expect(result.current.user).toEqual(alice);
    expect(result.current.persistWarning).toBeTruthy();
  });

  it("login succeeds gracefully too", async () => {
    mockedLogin.mockResolvedValue(alice);
    mockedFetchMe.mockResolvedValue(null);

    const { result } = renderHook(() => useAuth());
    let returned: unknown;
    await act(async () => {
      returned = await result.current.login("alice", "password123");
    });

    expect(returned).toEqual(alice);
    expect(result.current.user).toEqual(alice);
    expect(result.current.persistWarning).toBeTruthy();
  });

  it("does not warn when the session verifies normally", async () => {
    mockedLogin.mockResolvedValue(alice);
    mockedFetchMe.mockResolvedValue(alice);

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await result.current.login("alice", "password123");
    });

    expect(result.current.user).toEqual(alice);
    expect(result.current.persistWarning).toBeNull();
  });

  it("still throws on real failures like bad credentials", async () => {
    mockedLogin.mockRejectedValue(
      new Error("Invalid username or password")
    );

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await expect(
        result.current.login("alice", "wrongpassword")
      ).rejects.toThrow("Invalid username or password");
    });

    expect(result.current.user).toBeNull();
  });
});
