import { useState, useRef, useCallback, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { uploadFile } from "../services/api";
import { MAX_UPLOAD_BYTES, MAX_MESSAGE_LENGTH } from "../constants";
import type { FileAttachment } from "../types";
import GifPicker from "./GifPicker";
import Avatar from "./Avatar";

interface Props {
  onSend: (
    text: string,
    gifUrl: string | null,
    file?: FileAttachment | null
  ) => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function MessageComposer({ onSend }: Props) {
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [file, setFile] = useState<FileAttachment | null>(null);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The display name is the authenticated username — the server enforces this,
  // so clients cannot spoof another user's identity.
  const promptName = user?.username ?? "guest";

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && !gifUrl && !file) return;
    onSend(trimmed, gifUrl, file);
    setText("");
    setGifUrl(null);
    setFile(null);
    setError("");
  }, [text, gifUrl, file, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;

    if (picked.size > MAX_UPLOAD_BYTES) {
      setError(`File must be under ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
      return;
    }

    setError("");
    setUploading(true);
    try {
      const dataUrl = await readFileAsDataUrl(picked);
      const uploaded = await uploadFile(picked.name, dataUrl);
      setFile({
        url: uploaded.url,
        name: uploaded.fileName,
        type: uploaded.fileType,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload file");
    } finally {
      setUploading(false);
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
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileChange}
        className="hidden"
        data-testid="file-input"
      />

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
        <span className="flex items-center gap-1.5 pt-2 select-none whitespace-nowrap">
          <Avatar name={promptName} src={user?.picture_url ?? null} size={18} />
          <span className="text-[var(--accent)] glow text-sm">
            {promptName}$$
          </span>
        </span>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={clearError}
          placeholder="type a message…"
          maxLength={MAX_MESSAGE_LENGTH}
          data-testid="message-input"
          className="flex-1 min-h-10 max-h-[200px] box-border px-2 py-2 border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] text-sm leading-snug resize-none overflow-y-auto outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
        />
      </div>

      {/* Selected file preview */}
      {file && (
        <div className="mt-1.5 flex items-center gap-2">
          {file.type.startsWith("image/") ? (
            <img
              src={file.url}
              alt={file.name}
              className="w-16 h-12 object-cover border border-[var(--border-primary)]"
            />
          ) : (
            <span className="text-sm">📎</span>
          )}
          <span className="text-xs text-[var(--text-secondary)] truncate">
            {file.name}
          </span>
          <button
            onClick={() => setFile(null)}
            className="text-[var(--text-muted)] text-xs border-none bg-transparent cursor-pointer hover:text-[var(--error)]"
          >
            [ remove ]
          </button>
        </div>
      )}

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
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          data-testid="upload-button"
          className="flex-1 h-7 box-border border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-xs cursor-pointer hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-50"
        >
          {uploading ? "[ uploading… ]" : "[ upload ]"}
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
