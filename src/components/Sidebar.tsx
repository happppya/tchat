import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { SavedGC } from "../types";
import { getSavedGCs, removeGC, GCS_CHANGED_EVENT } from "../services/storage";
import { useAuth } from "../hooks/useAuth";
import CreateGroupChat from "./CreateGroupChat";
import { MAX_GC_ID_DIGITS } from "../constants";

interface Props {
  activeGCId: number | null;
  onSelectGC: (id: number) => void;
  className?: string;
}

export default function Sidebar({ activeGCId, onSelectGC, className }: Props) {
  const [savedGCs, setSavedGCs] = useState<SavedGC[]>(getSavedGCs());
  const [roomCode, setRoomCode] = useState("");
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
          termchat
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

      {/* Room list */}
      <div className="px-3 pt-1 pb-2">
        <label className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest block mb-1">
          channels
        </label>
      </div>
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

      {/* User + logout footer */}
      <div className="border-t border-[var(--border-primary)] px-3 py-2 flex items-center gap-2">
        <span className="text-[var(--text-muted)] text-[10px] uppercase tracking-widest">
          usr
        </span>
        <span className="text-[var(--accent)] text-xs flex-1 truncate" data-testid="current-user">
          {user?.username ?? "—"}
        </span>
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
