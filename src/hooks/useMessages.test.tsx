// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";

import { useMessages } from "./useMessages";

/**
 * Room switching must be last-request-wins: a slow history response for room A
 * that lands after the user already switched to room B must never be applied.
 */

vi.mock("../services/api", () => ({
  fetchMessages: vi.fn(),
  fetchGCInfo: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  reactToMessage: vi.fn(),
}));

import {
  fetchMessages,
  fetchGCInfo,
} from "../services/api";

/** A stored thunk that resolves its associated fetch promise when called. */
type Deferred = () => void;

const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useMessages room-switch race", () => {
  it("ignores a stale response when the user has moved to another room", async () => {
    const messagesA = [
      { id: 1, group_chat_id: 111, message_text: "old A message", sent_at: "t" },
    ];
    const messagesB = [
      { id: 2, group_chat_id: 222, message_text: "fresh B message", sent_at: "t" },
    ];
    const info = (name: string) => ({
      id: name === "Room B" ? 222 : 111,
      name,
      is_public: 0,
    });

    const msgDeferrals = new Map<number, Deferred>();
    const infoDeferrals = new Map<number, Deferred>();
    (fetchMessages as ReturnType<typeof vi.fn>).mockImplementation(
      (gcId: number) =>
        new Promise((resolve) => {
          msgDeferrals.set(gcId, () =>
            resolve(gcId === 111 ? messagesA : messagesB)
          );
        })
    );
    (fetchGCInfo as ReturnType<typeof vi.fn>).mockImplementation(
      (gcId: number) =>
        new Promise((resolve) => {
          infoDeferrals.set(gcId, () => resolve(info(gcId === 111 ? "Room A" : "Room B")));
        })
    );

    const { result, rerender } = renderHook(
      ({ id }: { id: number | null }) => useMessages(id),
      { wrapper, initialProps: { id: null as number | null } }
    );

    // Open room A (its fetches hang), then quickly switch to room B.
    await act(async () => rerender({ id: 111 }));
    await act(async () => rerender({ id: 222 }));

    // Room B's data arrives first and must be shown.
    await act(async () => {
      msgDeferrals.get(222)?.();
      infoDeferrals.get(222)?.();
    });
    await waitFor(() => expect(result.current.gcName).toBe("Room B"));

    // Now room A's slow response finally lands…
    await act(async () => {
      msgDeferrals.get(111)?.();
      infoDeferrals.get(111)?.();
    });

    // …and must NOT overwrite room B's state.
    expect(result.current.messages).toEqual(messagesB);
    expect(result.current.gcName).toBe("Room B");
  });
});
