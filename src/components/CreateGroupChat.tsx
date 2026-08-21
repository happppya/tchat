import { useState } from "react";
import { createGroupChat } from "../services/api";
import { saveGC } from "../services/storage";

interface Props {
  onCreated: (id: number) => void;
}

export default function CreateGroupChat({ onCreated }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    const gcId = parseInt(id, 10);
    if (!gcId || !name.trim()) return;

    setBusy(true);
    try {
      await createGroupChat(gcId, name.trim());
      saveGC(gcId, name.trim());
      setId("");
      setName("");
      setIsOpen(false);
      onCreated(gcId);
    } catch (err) {
      console.error("Failed to create group chat:", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => setIsOpen(!isOpen)}
        data-testid="create-gc-toggle"
        className="inline-flex items-center gap-4 cursor-pointer border-none bg-transparent text-[var(--text-secondary)] px-2 py-2 text-sm"
      >
        Create Group Chat
        <span
          className={`inline-block border-[5px] border-transparent transition-transform ${
            isOpen
              ? "border-t-[var(--text-secondary)] translate-y-0.5"
              : "border-l-[var(--text-secondary)] -translate-y-px"
          }`}
        />
      </button>

      {isOpen && (
        <div className="flex flex-col gap-1.5 px-2 pb-2">
          <input
            type="number"
            placeholder="id"
            value={id}
            onChange={(e) => setId(e.target.value)}
            data-testid="create-gc-id"
            className="w-full border border-[var(--border-primary)] rounded-lg px-2 py-1.5 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-sm outline-none placeholder:text-gray-500"
          />
          <input
            type="text"
            placeholder="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="create-gc-name"
            className="w-full border border-[var(--border-primary)] rounded-lg px-2 py-1.5 bg-[var(--bg-tertiary)] text-[var(--text-secondary)] text-sm outline-none placeholder:text-gray-500"
          />
          <button
            onClick={handleCreate}
            disabled={busy}
            data-testid="create-gc-submit"
            className="cursor-pointer border border-[var(--accent-light)] bg-[var(--accent-light)] text-[#2a2a35] rounded-lg px-2 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {busy ? "Creating..." : "Create"}
          </button>
        </div>
      )}
    </div>
  );
}