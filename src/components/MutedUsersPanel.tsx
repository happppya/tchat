import { useEffect, useState } from "react";
import { fetchRoomMutes } from "../services/api";
import type { RoomMuteEntry } from "../services/api";

interface Props {
  roomId: number;
  /** Unmute a user. Should resolve once the server has processed it. */
  onUnmuteUser: (username: string) => void | Promise<void>;
}

/**
 * A mute icon button in the chat window header (staff only). On click, opens
 * a popover listing every muted user in the room with an [ unmute ] action
 * per row. The list is refetched each time the panel opens, and after an
 * unmute, so it always reflects the server's current state.
 */
export default function MutedUsersPanel({ roomId, onUnmuteUser }: Props) {
  const [open, setOpen] = useState(false);
  const [mutes, setMutes] = useState<RoomMuteEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setMutes(await fetchRoomMutes(roomId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load muted users");
    } finally {
      setLoading(false);
    }
  };

  // Load once on mount so the header badge shows the current mute count.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void load();
  };

  const unmute = async (username: string) => {
    await onUnmuteUser(username);
    void load();
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        data-testid="muted-users-toggle"
        title={
          mutes.length
            ? `${mutes.length} muted user${mutes.length === 1 ? "" : "s"}`
            : "Muted users"
        }
        className={`text-xs border px-1.5 py-0.5 transition-colors cursor-pointer ${
          mutes.length
            ? "text-[var(--accent-light)] border-[var(--accent)]/60 hover:border-[var(--accent)]"
            : "text-[var(--text-muted)] border-[var(--border-primary)] hover:text-[var(--text-primary)]"
        }`}
      >
        🔇{mutes.length ? ` ${mutes.length}` : ""}
      </button>

      {open && (
        <>
          {/* Backdrop to close on outside click */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            data-testid="muted-users-popover"
            className="absolute top-full right-0 z-40 mt-1 w-72 max-h-64 overflow-y-auto border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl"
          >
            <div className="px-2 py-1.5 text-xs text-[var(--text-muted)] border-b border-[var(--border-primary)] flex items-center justify-between">
              <span>Muted users</span>
              <button
                onClick={() => setOpen(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs border-none bg-transparent cursor-pointer"
              >
                ✕
              </button>
            </div>
            {error ? (
              <div className="px-3 py-2 text-xs text-[var(--error)]">{error}</div>
            ) : loading ? (
              <div className="px-3 py-2 text-xs text-[var(--text-muted)]">
                $ loading…
              </div>
            ) : mutes.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--text-muted)]">
                No muted users in this room.
              </div>
            ) : (
              mutes.map((m) => (
                <div
                  key={m.user_id}
                  data-testid="muted-user-row"
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs border-b border-[var(--border-primary)]/50 last:border-b-0"
                >
                  <span className="flex-1 min-w-0 truncate text-[var(--text-primary)]">
                    {m.username}
                  </span>
                  <span className="shrink-0 text-[var(--text-muted)]">
                    {m.muted_at.slice(5, 16)}
                  </span>
                  <button
                    onClick={() => void unmute(m.username)}
                    data-testid={`unmute-${m.username}`}
                    className="shrink-0 text-[var(--accent-light)] border border-[var(--accent)]/40 px-1.5 py-0.5 hover:bg-[var(--accent)]/10 cursor-pointer bg-transparent transition-colors"
                  >
                    [ unmute ]
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
