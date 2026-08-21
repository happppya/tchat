import { useState } from "react";
import { createGroupChat } from "../services/api";
import { saveGC } from "../services/storage";
import { MAX_GC_ID_DIGITS } from "../constants";

interface Props {
  onCreated: (id: number) => void;
}

export default function CreateGroupChat({ onCreated }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Keep only digits and cap the code at the shared max length.
  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setId(e.target.value.replace(/\D/g, "").slice(0, MAX_GC_ID_DIGITS));
  };

  const handleCreate = async () => {
    const gcId = parseInt(id, 10);
    if (!gcId || !name.trim()) return;

    setBusy(true);
    setError("");
    try {
      await createGroupChat(gcId, name.trim(), isPublic);
      saveGC(gcId, name.trim());
      setId("");
      setName("");
      setIsPublic(false);
      setIsOpen(false);
      onCreated(gcId);
    } catch (err) {
      // Surface the server's message (e.g. "already exists") to the user.
      setError(err instanceof Error ? err.message : "Failed to create group chat");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-3 pt-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        data-testid="create-gc-toggle"
        className="inline-flex items-center gap-2 cursor-pointer border-none bg-transparent text-[var(--text-secondary)] text-sm hover:text-[var(--text-primary)] transition-colors"
      >
        new channel
      </button>

      {isOpen && (
        <div className="flex flex-col gap-1.5 pt-2">
          <input
            type="number"
            placeholder={`id (1–${MAX_GC_ID_DIGITS} digits)`}
            value={id}
            onChange={handleIdChange}
            maxLength={MAX_GC_ID_DIGITS}
            data-testid="create-gc-id"
            className="w-full border border-[var(--border-primary)] px-2 py-1.5 bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
          />
          <input
            type="text"
            placeholder="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
            data-testid="create-gc-name"
            className="w-full border border-[var(--border-primary)] px-2 py-1.5 bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
          />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">
              visibility
            </span>
            <button
              type="button"
              onClick={() => setIsPublic(false)}
              data-testid="visibility-private"
              className={`text-xs border px-2 py-1 cursor-pointer transition-colors ${
                !isPublic
                  ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border-primary)] text-[var(--text-secondary)] bg-[var(--bg-secondary)]"
              }`}
            >
              private
            </button>
            <button
              type="button"
              onClick={() => setIsPublic(true)}
              data-testid="visibility-public"
              className={`text-xs border px-2 py-1 cursor-pointer transition-colors ${
                isPublic
                  ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border-primary)] text-[var(--text-secondary)] bg-[var(--bg-secondary)]"
              }`}
            >
              public
            </button>
          </div>
          {error && (
            <div
              data-testid="create-gc-error"
              className="text-[var(--error)] text-xs"
            >
              err: {error}
            </div>
          )}
          <button
            onClick={handleCreate}
            disabled={busy}
            data-testid="create-gc-submit"
            className="cursor-pointer border border-[var(--accent)] text-[var(--accent)] px-2 py-1.5 text-sm hover:bg-[var(--accent)]/10 transition-colors disabled:opacity-50"
          >
            {busy ? "[ creating… ]" : "[ create ]"}
          </button>
        </div>
      )}
    </div>
  );
}
