import { useEffect, useState } from "react";
import { fetchRoomBans } from "../services/api";
import type { RoomBanEntry } from "../services/api";

interface Props {
  roomId: number;
  /** Unban a user. Should resolve once the server has processed it. */
  onUnbanUser: (username: string) => void | Promise<void>;
}

/**
 * A ban icon button in the chat window header (staff only). On click, opens
 * a popover listing every banned user in the room with an [ unban ] action
 * per row. The list is refetched each time the panel opens, and after an
 * unban, so it always reflects the server's current state.
 */
export default function BannedUsersPanel({ roomId, onUnbanUser }: Props) {
  const [open, setOpen] = useState(false);
  const [bans, setBans] = useState<RoomBanEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      setBans(await fetchRoomBans(roomId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load banned users");
    } finally {
      setLoading(false);
    }
  };

  // Load once on mount so the header badge shows the current ban count.
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void load();
  };

  const unban = async (username: string) => {
    await onUnbanUser(username);
    void load();
  };

  return (
    <div className="relative">
      <button
        onClick={toggle}
        data-testid="banned-users-toggle"
        title={
          bans.length
            ? `${bans.length} banned user${bans.length === 1 ? "" : "s"}`
            : "Banned users"
        }
        className={`text-xs border px-1.5 py-0.5 transition-colors cursor-pointer ${
          bans.length
            ? "text-[var(--error)] border-[var(--error)]/50 hover:border-[var(--error)]"
            : "text-[var(--text-muted)] border-[var(--border-primary)] hover:text-[var(--text-primary)]"
        }`}
      >
        🔨{bans.length ? ` ${bans.length}` : ""}
      </button>

      {open && (
        <>
          {/* Backdrop to close on outside click */}
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            data-testid="banned-users-popover"
            className="absolute top-full right-0 z-40 mt-1 w-72 max-h-64 overflow-y-auto border border-[var(--border-primary)] bg-[var(--bg-primary)] shadow-xl"
          >
            <div className="px-2 py-1.5 text-xs text-[var(--text-muted)] border-b border-[var(--border-primary)] flex items-center justify-between">
              <span>Banned users</span>
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
            ) : bans.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--text-muted)]">
                No banned users in this room.
              </div>
            ) : (
              bans.map((b) => (
                <div
                  key={b.user_id}
                  data-testid="banned-user-row"
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs border-b border-[var(--border-primary)]/50 last:border-b-0"
                >
                  <span className="flex-1 min-w-0 truncate text-[var(--text-primary)]">
                    {b.username}
                  </span>
                  <span className="shrink-0 text-[var(--text-muted)]">
                    {b.banned_at.slice(5, 16)}
                  </span>
                  <button
                    onClick={() => void unban(b.username)}
                    data-testid={`unban-${b.username}`}
                    className="shrink-0 text-[var(--accent-light)] border border-[var(--accent)]/40 px-1.5 py-0.5 hover:bg-[var(--accent)]/10 cursor-pointer bg-transparent transition-colors"
                  >
                    [ unban ]
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
