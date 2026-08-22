import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { GroupChat, SavedGC } from "../types";
import {
  getSavedGCs,
  removeGC,
  saveGCList,
  mergeSavedGCs,
  GCS_CHANGED_EVENT,
} from "../services/storage";
import { fetchMyRooms, fetchPublicRooms } from "../services/api";
import { useAuth } from "../hooks/useAuth";
import CreateGroupChat from "./CreateGroupChat";
import { MAX_GC_ID_DIGITS } from "../constants";

/** Short label for room type flags (non-exclusive). */
function typeTags(room: GroupChat): string {
  const tags: string[] = [];
  if (room.is_hidden) tags.push("🔒");
  if (room.is_readonly) tags.push("🤫");
  if (room.is_anonymous) tags.push("👤");
  if (room.is_transparent) tags.push("👁");
  if (tags.length === 0) tags.push("📂");
  return tags.join("");
}

interface Props {
  activeGCId: number | null;
  onSelectGC: (id: number) => void;
  onEditProfile: () => void;
  className?: string;
}

export default function Sidebar({
  activeGCId,
  onSelectGC,
  onEditProfile,
  className,
}: Props) {
  const [savedGCs, setSavedGCs] = useState<SavedGC[]>(getSavedGCs());
  const [roomCode, setRoomCode] = useState("");
  const [tab, setTab] = useState<"channels" | "rooms">("channels");
  const [publicRooms, setPublicRooms] = useState<GroupChat[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState("");
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  const refresh = useCallback(() => {
    setSavedGCs(getSavedGCs());
  }, []);

  // Refresh on focus (in case storage changes externally) and whenever a
  // same-window write updates the saved-GC list.
  useEffect(() => {
    const onFocus = () => setSavedGCs(getSavedGCs());
    const onGCsChanged = () => setSavedGCs(getSavedGCs());
    window.addEventListener("focus", onFocus);
    window.addEventListener(GCS_CHANGED_EVENT, onGCsChanged);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(GCS_CHANGED_EVENT, onGCsChanged);
    };
  }, []);

  // Load the user's permanent room list from the server on mount and merge it
  // with the local cache. Server rooms come first; local-only entries stay so
  // a room appears instantly before its join request finishes.
  useEffect(() => {
    let cancelled = false;
    fetchMyRooms()
      .then((serverRooms) => {
        if (cancelled) return;
        const merged = mergeSavedGCs(
          serverRooms.map((g) => ({ id: g.id, name: g.name })),
          getSavedGCs()
        );
        setSavedGCs(merged);
        saveGCList(merged);
      })
      .catch(() => {
        // Fall back to the local cache if the server is unreachable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRemove = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    removeGC(id);
    refresh();
    if (activeGCId === id) onSelectGC(0);
  };

  const handleRoomCode = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const code = parseInt(roomCode, 10);
    if (!code) return;
    setRoomCode("");
    onSelectGC(code);
  };

  const handleRoomCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRoomCode(e.target.value.replace(/\D/g, "").slice(0, MAX_GC_ID_DIGITS));
  };

  const loadPublicRooms = useCallback(async () => {
    setRoomsLoading(true);
    setRoomsError("");
    try {
      setPublicRooms(await fetchPublicRooms());
    } catch (err) {
      setRoomsError(
        err instanceof Error ? err.message : "Failed to load rooms"
      );
    } finally {
      setRoomsLoading(false);
    }
  }, []);

  // Load the discoverable-room list whenever the rooms tab is opened.
  useEffect(() => {
    if (tab === "rooms") {
      loadPublicRooms();
    }
  }, [tab, loadPublicRooms]);

  const handleCreated = (id: number) => {
    refresh();
    onSelectGC(id);
  };

  const handleLogout = async () => {
    await logout();
    navigate("/login", { replace: true });
  };

  return (
    <div
      className={`term-panel flex flex-col m-1 overflow-hidden ${
        className ?? ""
      }`}
    >
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-[var(--border-primary)]">
        <h1 className="text-[var(--accent)] glow text-lg font-normal tracking-wide">
          tchat
        </h1>
        <span className="text-[var(--text-muted)] text-[10px]">
          v1.0.0
        </span>
      </div>

      <CreateGroupChat onCreated={handleCreated} />

      <div className="border-t border-[var(--border-primary)] my-2 mx-3" />

      {/* Room code input */}
      <div className="px-3 pb-2">
        <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest block mb-1">
          join room
        </label>
        <input
          type="number"
          placeholder={`code (1–${MAX_GC_ID_DIGITS} digits)`}
          value={roomCode}
          onChange={handleRoomCodeChange}
          onKeyDown={handleRoomCode}
          maxLength={MAX_GC_ID_DIGITS}
          data-testid="room-code-input"
          className="w-full border border-[var(--border-primary)] px-2 py-1.5 bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
      </div>

      {/* Channel / room tabs */}
      <div className="px-3 pt-1 pb-2 flex items-center gap-1">
        <button
          onClick={() => setTab("channels")}
          data-testid="tab-channels"
          className={`text-xs border px-2 py-1 cursor-pointer transition-colors ${
            tab === "channels"
              ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
              : "border-[var(--border-primary)] text-[var(--text-secondary)] bg-[var(--bg-secondary)]"
          }`}
        >
          channels
        </button>
        <button
          onClick={() => setTab("rooms")}
          data-testid="tab-rooms"
          className={`text-xs border px-2 py-1 cursor-pointer transition-colors ${
            tab === "rooms"
              ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
              : "border-[var(--border-primary)] text-[var(--text-secondary)] bg-[var(--bg-secondary)]"
          }`}
        >
          rooms
        </button>
        {tab === "rooms" && (
          <button
            onClick={loadPublicRooms}
            disabled={roomsLoading}
            data-testid="refresh-rooms"
            className="ml-auto text-[var(--text-muted)] text-xs border-none bg-transparent cursor-pointer hover:text-[var(--text-primary)]"
          >
            {roomsLoading ? "[ … ]" : "[ refresh ]"}
          </button>
        )}
      </div>

      {tab === "channels" ? (
        <ul className="list-none px-2 pb-2 flex-1 overflow-y-auto">
          {savedGCs.map((gc) => (
            <li key={gc.id}>
              <button
                onClick={() => onSelectGC(gc.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  handleRemove(e, gc.id);
                }}
                data-testid={`gc-button-${gc.id}`}
                className={`w-full text-left px-2 py-1.5 my-0.5 border-l-2 border-transparent text-[var(--text-secondary)] text-sm bg-transparent cursor-pointer hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors ${
                  activeGCId === gc.id
                    ? "!border-[var(--accent)] !text-[var(--text-primary)] !bg-[var(--bg-tertiary)]"
                    : ""
                }`}
              >
                <span className="text-[var(--accent)] mr-1">
                  {activeGCId === gc.id ? ">" : "·"}
                </span>
                {gc.name}
                <span className="pl-1 text-[10px] text-[var(--text-muted)]">
                  #{gc.id}
                </span>
              </button>
            </li>
          ))}
          {savedGCs.length === 0 && (
            <li className="text-center text-xs text-[var(--text-muted)] py-6 px-2">
              $ no channels joined
            </li>
          )}
        </ul>
      ) : (
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {roomsError && (
            <div className="text-[var(--error)] text-xs px-2 py-1">
              err: {roomsError}
            </div>
          )}
          {publicRooms.map((room) => (
            <button
              key={room.id}
              onClick={() => onSelectGC(room.id)}
              data-testid={`public-room-${room.id}`}
              className="w-full text-left px-2 py-1.5 my-0.5 border-l-2 border-transparent text-[var(--text-secondary)] text-sm bg-transparent cursor-pointer hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <span className="text-[var(--accent)] mr-1">§</span>
              {room.name}
              <span className="pl-1 text-[10px] text-[var(--text-muted)]">
                #{room.id}
              </span>
              <span className="ml-1" title="Room types">
                {typeTags(room)}
              </span>
            </button>
          ))}
          {!roomsLoading && !roomsError && publicRooms.length === 0 && (
            <div className="text-center text-xs text-[var(--text-muted)] py-6 px-2">
              $ no rooms
            </div>
          )}
        </div>
      )}

      {/* User + logout footer: the username is the profile button */}
      <div className="border-t border-[var(--border-primary)] px-3 py-2 flex items-center gap-2">
        <button
          onClick={onEditProfile}
          data-testid="profile-button"
          title="View / edit your profile"
          className="flex-1 min-w-0 flex items-center text-left border-none bg-transparent p-0 cursor-pointer group"
        >
          <span
            data-testid="current-user"
            className="text-[var(--accent)] text-xs break-all group-hover:text-[var(--accent-light)] transition-colors"
          >
            {user?.username ?? "—"}
          </span>
        </button>
        <button
          onClick={handleLogout}
          data-testid="logout-button"
          className="text-[var(--text-muted)] text-xs border border-[var(--border-primary)] px-2 py-1 hover:text-[var(--error)] hover:border-[var(--error)]/50 transition-colors cursor-pointer"
        >
          [ logout ]
        </button>
      </div>
    </div>
  );
}
