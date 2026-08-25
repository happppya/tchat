import { useState } from "react";
import { createGroupChat } from "../services/api";
import { saveGC } from "../services/storage";
import { useAuth } from "../hooks/useAuth";
import { MAX_GC_ID_DIGITS } from "../constants";

interface Props {
  onCreated: (id: number) => void;
}

export default function CreateGroupChat({ onCreated }: Props) {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [isHidden, setIsHidden] = useState(false);
  const [password, setPassword] = useState("");
  const [isReadonly, setIsReadonly] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isTransparent, setIsTransparent] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [isForum, setIsForum] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Only admins can create rooms.
  if (!user?.isAdmin) return null;

  const handleIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setId(e.target.value.replace(/\D/g, "").slice(0, MAX_GC_ID_DIGITS));
  };

  const handleCreate = async () => {
    const gcId = parseInt(id, 10);
    if (!gcId || !name.trim()) return;

    setBusy(true);
    setError("");
    try {
      await createGroupChat(gcId, name.trim(), {
        isHidden,
        password: isHidden ? password : undefined,
        isReadonly,
        isAnonymous,
        isTransparent,
        isPublic,
        isForum,
      });
      saveGC(gcId, name.trim());
      setId("");
      setName("");
      setIsHidden(false);
      setPassword("");
      setIsReadonly(false);
      setIsAnonymous(false);
      setIsTransparent(false);
      setIsPublic(false);
      setIsForum(false);
      setIsOpen(false);
      onCreated(gcId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create group chat");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (
    label: string,
    value: boolean,
    setter: (v: boolean) => void
  ) => (
    <button
      type="button"
      onClick={() => setter(!value)}
      className={`text-xs border px-2 py-1 cursor-pointer transition-colors ${
        value
          ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
          : "border-[var(--border-primary)] text-[var(--text-secondary)] bg-[var(--bg-secondary)]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="px-3 pt-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        data-testid="create-gc-toggle"
        className="inline-flex items-center gap-2 cursor-pointer border-none bg-transparent text-[var(--text-secondary)] text-sm hover:text-[var(--text-primary)] transition-colors"
      >
        new room
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
          <div className="flex items-center gap-1.5 flex-wrap">
            {toggle("forum", isForum, setIsForum)}
            {toggle("hidden", isHidden, setIsHidden)}
            {toggle("readonly", isReadonly, setIsReadonly)}
            {toggle("anonymous", isAnonymous, setIsAnonymous)}
            {toggle("transparent", isTransparent, setIsTransparent)}
            {toggle("public", isPublic, setIsPublic)}
          </div>
          {isHidden && (
            <input
              type="password"
              placeholder="room password (>8 chars)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-[var(--border-primary)] px-2 py-1.5 bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
            />
          )}
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