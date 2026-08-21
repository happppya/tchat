import { useState, useRef, useCallback, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import GifPicker from "./GifPicker";

interface Props {
  onSend: (text: string, gifUrl: string | null) => void;
}

export default function MessageComposer({ onSend }: Props) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // The display name is the authenticated username — the server enforces this,
  // so clients cannot spoof another user's identity.
  const promptName = user?.username ?? "guest";

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && !gifUrl) return;
    onSend(trimmed, gifUrl);
    setText("");
    setGifUrl(null);
    setError("");
  }, [text, gifUrl, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Autosize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "40px";
    el.style.height = Math.min(el.scrollHeight + 2, 200) + "px";
  }, [text]);

  const clearError = useCallback(() => setError(""), []);

  return (
    <div className="relative border-t border-[var(--border-primary)] pt-2 px-1">
      {/* Top bar with error + username badge */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[var(--error)] text-xs ml-auto">{error}</span>
        <span className="text-[var(--text-muted)] text-[10px] uppercase tracking-widest">
          user
        </span>
        <span
          data-testid="display-name-input"
          className="text-xs text-[var(--accent)] border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 select-none"
        >
          {promptName}
        </span>
      </div>

      {/* Composer row with prompt */}
      <div className="flex gap-2 items-end">
        <span className="text-[var(--accent)] glow text-sm pt-2 select-none whitespace-nowrap">
          {promptName}${"$"}
        </span>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={clearError}
          placeholder="type a message…"
          data-testid="message-input"
          className="flex-1 min-h-10 max-h-[200px] box-border px-2 py-2 border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm leading-snug resize-none overflow-y-auto outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
        />
      </div>

      {/* Selected GIF preview */}
      {gifUrl && (
        <div className="mt-1.5">
          <img
            src={gifUrl}
            alt="Selected GIF"
            className="w-16 h-12 object-cover border border-[var(--border-primary)] cursor-pointer"
            onClick={() => setGifUrl(null)}
            title="Click to remove GIF"
          />
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-2 py-2">
        <button className="flex-1 h-7 box-border border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-xs cursor-pointer hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors">
          [ upload ]
        </button>
        <button
          onClick={() => setGifPickerOpen((p) => !p)}
          className="flex-1 h-7 box-border border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-xs cursor-pointer hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
        >
          [ gifs ]
        </button>
      </div>

      {/* GIF Picker */}
      <GifPicker
        isOpen={gifPickerOpen}
        onClose={() => setGifPickerOpen(false)}
        onSelectGif={(url) => {
          setGifUrl(url);
          textareaRef.current?.focus();
        }}
      />
    </div>
  );
}
