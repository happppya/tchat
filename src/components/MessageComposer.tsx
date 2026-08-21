import { useState, useRef, useCallback, useEffect } from "react";
import { stripNonAscii } from "../utils/format";
import { getDisplayName, setDisplayName } from "../services/storage";
import GifPicker from "./GifPicker";

interface Props {
  onSend: (text: string, gifUrl: string | null) => void;
}

export default function MessageComposer({ onSend }: Props) {
  const [text, setText] = useState("");
  const [displayName, setDisplayNameState] = useState(getDisplayName());
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Persist display name
  const handleDisplayNameChange = useCallback(
    (value: string) => {
      const cleaned = stripNonAscii(value).slice(0, 30);
      setDisplayNameState(cleaned);
      setDisplayName(cleaned);
    },
    []
  );

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
    <div className="relative">
      {/* Top bar with error + display name */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-red-500 text-xs ml-auto">{error}</span>
        <input
          type="text"
          placeholder="Display Name"
          maxLength={30}
          value={displayName}
          onChange={(e) => handleDisplayNameChange(e.target.value)}
          className="w-28 h-7 box-border text-xs text-[var(--text-secondary)] px-2.5 py-1 border border-[var(--border-primary)] rounded-lg bg-[var(--bg-secondary)] outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_2px_rgba(121,121,184,0.15)] placeholder:text-[var(--text-secondary)]"
        />
      </div>

      {/* Composer row */}
      <div className="flex gap-2.5 items-end">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={clearError}
          placeholder="Message..."
          className="flex-1 min-h-10 max-h-[200px] box-border px-3.5 py-2.5 border border-[var(--border-primary)] rounded-lg text-sm leading-snug bg-[var(--bg-secondary)] text-[var(--text-secondary)] resize-none overflow-y-auto outline-none focus:border-[var(--accent)] focus:shadow-[0_0_0_3px_rgba(121,121,184,0.15)] placeholder:text-[var(--text-secondary)]"
        />

        <div className="relative">
          {gifUrl && (
            <div className="mb-1.5">
              <img
                src={gifUrl}
                alt="Selected GIF"
                className="w-16 h-12 object-cover rounded-lg cursor-pointer"
                onClick={() => setGifUrl(null)}
                title="Click to remove GIF"
              />
            </div>
          )}
        </div>
      </div>

      {/* Buttons */}
      <div className="flex gap-2.5 justify-center py-2.5">
        <button className="w-full h-8 box-border border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] rounded-lg text-xs cursor-pointer hover:bg-[#595965] transition-colors">
          Upload files
        </button>
        <button
          onClick={() => setGifPickerOpen((p) => !p)}
          className="w-full h-8 box-border border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] rounded-lg text-xs cursor-pointer hover:bg-[#595965] transition-colors"
        >
          Browse GIFs
        </button>
      </div>

      {/* GIF Picker (appears above composer) */}
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