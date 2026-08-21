import { useState, useEffect, useCallback } from "react";
import type { SavedGC } from "../types";
import { getSavedGCs, removeGC } from "../services/storage";
import CreateGroupChat from "./CreateGroupChat";

interface Props {
  activeGCId: number | null;
  onSelectGC: (id: number) => void;
  className?: string;
}

export default function Sidebar({ activeGCId, onSelectGC, className }: Props) {
  const [savedGCs, setSavedGCs] = useState<SavedGC[]>(getSavedGCs());
  const [roomCode, setRoomCode] = useState("");

  const refresh = useCallback(() => {
    setSavedGCs(getSavedGCs());
  }, []);

  // Refresh on focus (in case storage changes externally)
  useEffect(() => {
    const onFocus = () => setSavedGCs(getSavedGCs());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const handleRemove = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    removeGC(id);
    refresh();
    if (activeGCId === id) onSelectGC(0); // no-op reselect
  };

  const handleRoomCode = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const code = parseInt(roomCode, 10);
    if (!code) return;
    setRoomCode("");
    onSelectGC(code);
  };

  const handleCreated = (id: number) => {
    refresh();
    onSelectGC(id);
  };

  return (
    <div
      className={`flex flex-col bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-xl m-2 overflow-hidden ${
        className ?? ""
      }`}
    >
      <h1 className="text-[var(--text-primary)] px-5 pt-5 text-3xl font-light font-[Rubik]">
        Chat
      </h1>

      <CreateGroupChat onCreated={handleCreated} />

      <hr className="border-none bg-[var(--bg-tertiary)] h-px w-[200px] mx-auto my-3" />

      <input
        type="number"
        placeholder="Room Code"
        value={roomCode}
        onChange={(e) => setRoomCode(e.target.value)}
        onKeyDown={handleRoomCode}
        className="mx-2 border border-[var(--border-primary)] rounded-lg px-2 py-1.5 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-sm outline-none placeholder:text-gray-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />

      <ul className="list-none p-3 flex-1 overflow-y-auto">
        {savedGCs.map((gc) => (
          <li key={gc.id}>
            <button
              onClick={() => onSelectGC(gc.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                handleRemove(e, gc.id);
              }}
              className={`w-full text-left px-2.5 py-1.5 my-1 border-none rounded-lg cursor-pointer text-[var(--text-secondary)] text-sm bg-[var(--bg-secondary)] hover:bg-[#595965] transition-colors ${
                activeGCId === gc.id ? "!bg-[#595965] font-bold" : ""
              }`}
            >
              {gc.name}
              <span className="pl-1 text-[11px] italic opacity-70">
                (#{gc.id})
              </span>
            </button>
          </li>
        ))}
        {savedGCs.length === 0 && (
          <li className="text-center text-sm text-[var(--text-muted)] py-8">
            No saved chats. Enter a Room Code above.
          </li>
        )}
      </ul>
    </div>
  );
}