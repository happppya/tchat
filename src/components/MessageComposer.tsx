import { useState, useRef, useCallback, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { uploadFile } from "../services/api";
import { MAX_UPLOAD_BYTES, MAX_MESSAGE_LENGTH } from "../constants";
import { truncate } from "../utils/format";
import type { FileAttachment, ReplyTarget } from "../types";
import GifPicker from "./GifPicker";
import Avatar from "./Avatar";

interface Props {
  onSend: (
    text: string,
    gifUrl: string | null,
    file?: FileAttachment | null
  ) => void;
  /** The message currently being replied to, if any. */
  replyTo?: ReplyTarget | null;
  onCancelReply?: () => void;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function MessageComposer({ onSend, replyTo, onCancelReply }: Props) {
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

      {/* Reply preview */}
      {replyTo && (
        <div
          data-testid="reply-preview"
          className="flex items-center gap-2 mb-1.5 text-xs text-[var(--text-muted)] border-l-2 border-[var(--accent)] pl-2"
        >
          <span className="truncate">
            replying to <span className="text-[var(--accent-light)]">{replyTo.author}</span>
            {replyTo.quote && <>: “{truncate(replyTo.quote, 100)}”</>}
          </span>
          <button
            onClick={onCancelReply}
            data-testid="cancel-reply"
            className="ml-auto text-[var(--text-muted)] border-none bg-transparent cursor-pointer hover:text-[var(--error)]"
          >
            [ cancel ]
          </button>
        </div>
      )}

      {/* Composer row: message box with upload/GIF icons to its right */}
      <div className="flex gap-2 items-end">
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
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          data-testid="upload-button"
          title="Attach a file"
          aria-label="Attach a file"
          className="h-10 w-10 flex-shrink-0 flex items-center justify-center border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-base cursor-pointer hover:bg-[var(--bg-tertiary)] hover:border-[var(--accent)]/60 transition-colors disabled:opacity-50"
        >
          {uploading ? "…" : "📎"}
        </button>
        <button
          onClick={() => setGifPickerOpen((p) => !p)}
          data-testid="gif-button"
          title="Search GIFs"
          aria-label="Search GIFs"
          className="h-10 w-10 flex-shrink-0 flex items-center justify-center border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-base cursor-pointer hover:bg-[var(--bg-tertiary)] hover:border-[var(--accent)]/60 transition-colors"
        >
          🎞
        </button>
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

      {/* Identity sits bottom-left; errors flush right */}
      <div className="flex items-center gap-1.5 mt-1.5 min-h-5">
        <Avatar name={promptName} src={user?.picture_url ?? null} size={16} />
        <span
          data-testid="composer-user"
          className="text-xs text-[var(--text-muted)] break-all min-w-0"
        >
          {promptName}
        </span>
        <span className="text-[var(--error)] text-xs ml-auto text-right">
          {error}
        </span>
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
