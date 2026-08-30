/** Modal prompting for a room password when joining a hidden room. */
import { useRef } from "react";

interface Props {
  gcId: number;
  error?: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export default function PasswordPrompt({ gcId, error, onSubmit, onCancel }: Props) {
  const passwordRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex-1 flex items-center justify-center">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const pw = passwordRef.current?.value ?? "";
          onSubmit(pw);
          if (passwordRef.current) passwordRef.current.value = "";
        }}
        className="term-panel p-6 max-w-sm w-full border border-[var(--border-primary)] text-sm"
      >
        <div className="text-[var(--text-primary)] mb-1 font-semibold">
          Room #{gcId} requires a password
        </div>
        <div className="text-[var(--text-muted)] text-xs mb-3">
          Enter the password to join this hidden room.
        </div>
        <input
          ref={passwordRef}
          type="password"
          autoFocus
          placeholder="room password"
          className="w-full border border-[var(--border-primary)] px-3 py-2 bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm outline-none focus:border-[var(--accent)] mb-3"
        />
        {error && (
          <div className="text-[var(--error)] text-xs mb-3">{error}</div>
        )}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="text-[var(--text-muted)] text-xs border border-[var(--border-primary)] px-3 py-1.5 bg-transparent cursor-pointer hover:text-[var(--text-primary)] transition-colors"
          >
            cancel
          </button>
          <button
            type="submit"
            className="text-[var(--accent)] text-xs border border-[var(--accent)] px-3 py-1.5 bg-transparent cursor-pointer hover:bg-[var(--accent)]/10 transition-colors"
          >
            join
          </button>
        </div>
      </form>
    </div>
  );
}