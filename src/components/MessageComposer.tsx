import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { uploadFile } from "../services/api";
import { MAX_UPLOAD_BYTES, MAX_MESSAGE_LENGTH } from "../constants";
import { truncate } from "../utils/format";
import type { FileAttachment, ReplyTarget } from "../types";
import GifPicker from "./GifPicker";

/** Commands that require room staff (owner/mod/admin). */
const STAFF_COMMANDS = new Set(["/kick", "/ban", "/unban", "/mute", "/unmute", "/mod", "/demod"]);
const ALL_COMMANDS: [string, string][] = [
  ["/kick", "@username"],
  ["/ban", "@username"],
  ["/unban", "@username"],
  ["/mute", "@username"],
  ["/unmute", "@username"],
  ["/mod", "@username"],
  ["/demod", "@username"],
  ["/join", "#roomcode"],
  ["/leave", ""],
  ["/help", "[page]"],
];

/** Build command lookup filtered by permission. */
function commandsForUser(viewerIsStaff: boolean) {
  const cmds = viewerIsStaff
    ? ALL_COMMANDS
    : ALL_COMMANDS.filter(([k]) => !STAFF_COMMANDS.has(k));
  return {
    map: new Map<string, string>(cmds.map(([k, v]) => [k, v])),
    names: cmds.map(([k]) => k),
  };
}

interface Props {
  onSend: (
    text: string,
    gifUrl: string | null,
    file?: FileAttachment | null
  ) => void;
  onSlashCommand?: (command: string, arg: string) => void;
  /** The message currently being replied to, if any. */
  replyTo?: ReplyTarget | null;
  onCancelReply?: () => void;
  /** Unique display names in the room, for @username autocomplete. */
  memberNames?: string[];
  /** Whether the viewer is staff (owner/mod/admin) — gates mod commands. */
  viewerIsStaff?: boolean;
  /** Whether the viewer is admin — gates admin-only commands. */
  viewerIsAdmin?: boolean;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function MessageComposer({
  onSend,
  replyTo,
  onCancelReply,
  onSlashCommand,
  memberNames = [],
  viewerIsStaff = false,
  viewerIsAdmin = false,
}: Props) {
  const [text, setText] = useState("");
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [file, setFile] = useState<FileAttachment | null>(null);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [popIndex, setPopIndex] = useState(0);

  // Build the allowed-command lookup based on viewer permissions.
  const { map: commandsByPrefix, names: commandNames } = useMemo(
    () => commandsForUser(viewerIsStaff),
    [viewerIsStaff]
  );

  // Parse the current input: is it a slash command? Command part? Argument?
  const slashState = useMemo(() => {
    if (!text.startsWith("/")) return null;
    const space = text.indexOf(" ");
    const cmd = space === -1 ? text : text.slice(0, space);
    const arg = space === -1 ? "" : text.slice(space + 1);
    const exact = commandsByPrefix.get(cmd);
    return { cmd, arg, exact, hint: exact !== undefined ? exact : null };
  }, [text, commandsByPrefix]);

  // Detect @mention autocomplete in non-slash-command messages.
  const mentionState = useMemo(() => {
    if (!text || text.startsWith("/")) return null;
    // Find the last @ that is preceded by start-of-string or a space.
    const lastAt = text.lastIndexOf("@");
    if (lastAt === -1) return null;
    const before = text[lastAt - 1];
    if (before !== undefined && before !== " " && before !== "\n") return null;
    const query = text.slice(lastAt + 1);
    if (query.includes(" ") || query.length > 30) return null;
    // Don't show popover for empty query — user just typed @.
    if (query.length === 0) return null;
    const filtered = memberNames
      .filter((n) => n.toLowerCase().startsWith(query.toLowerCase()))
      .slice(0, 8);
    // Always offer @everyone when the query matches.
    // Store without the @ prefix — acceptPopItem prepends it.
    const everyone = "everyone".startsWith(query.toLowerCase())
      ? ["everyone"]
      : [];
    return { start: lastAt, query, matches: [...everyone, ...filtered] };
  }, [text, memberNames]);

  // Build the autocomplete popover items.
  const popItems: { id: string; label: string; secondary?: string }[] =
    useMemo(() => {
      // @mention autocomplete takes priority over slash commands in regular text.
      if (mentionState) {
        return mentionState.matches.map((n) => ({ id: n, label: "@" + n }));
      }
      if (!slashState) return [];
      const { cmd, arg, exact, hint } = slashState;

      // Phase 1: command not fully typed yet (no space). Show matching commands.
      if (arg === "" && !exact) {
        return commandNames
          .filter((c) => c.startsWith(cmd))
          .map((c) => {
            const h = commandsByPrefix.get(c);
            return h ? { id: c, label: c, secondary: h } : { id: c, label: c };
          });
      }

      // Phase 2: command is exact, hint is @username — show matching members.
      if (exact && hint === "@username") {
        const atIdx = arg.indexOf("@");
        if (atIdx === -1) {
          // No @ typed yet — show "@username" placeholder.
          return [{ id: "@", label: "@username" }];
        }
        const query = arg.slice(atIdx + 1).toLowerCase();
        const filtered = memberNames
          .filter((n) => n.toLowerCase().includes(query))
          .slice(0, 8);
        if (filtered.length === 0) {
          return [{ id: "", label: "no matches" }];
        }
        return filtered.map((n) => ({ id: arg.slice(0, atIdx + 1) + n, label: n }));
      }

      // Phase 3: command is exact, hint is #roomcode — show hint.
      if (exact && hint === "#roomcode") {
        return [{ id: "#", label: "#roomcode" }];
      }

      return [];
    }, [slashState, memberNames, mentionState]);

  // Clamp popIndex when items change.
  useEffect(() => {
    setPopIndex(0);
  }, [popItems.length]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed && !gifUrl && !file) return;

    if (slashState && slashState.exact && onSlashCommand) {
      onSlashCommand(slashState.cmd.slice(1), slashState.arg);
      setText("");
      return;
    }

    onSend(trimmed, gifUrl, file);
    setText("");
    setGifUrl(null);
    setFile(null);
    setError("");
  }, [text, gifUrl, file, slashState, onSend, onSlashCommand]);

  const acceptPopItem = useCallback(
    (forceIndex?: number) => {
      if (popItems.length === 0) return;
      const idx = forceIndex ?? popIndex;
      const item = popItems[idx] ?? popItems[0];
      if (!item || item.id === "" || item.id === "@") return;

      // @mention completion in regular messages.
      if (mentionState) {
        const before = text.slice(0, mentionState.start);
        setText(before + "@" + item.id + " ");
        return;
      }

      // Slash-command completion.
      if (!slashState) return;
      const { arg } = slashState;

      if (arg === "" && !slashState.exact) {
        setText(item.id + " ");
      } else {
        const beforeArg = text.slice(0, slashState.cmd.length + 1);
        setText(beforeArg + item.id);
      }
    },
    [slashState, popItems, popIndex, text, mentionState]
  );

  /** Compute which text acceptPopItem would produce without calling setText. */
  const getAcceptedText = useCallback(
    (forceIndex?: number): string | null => {
      if (popItems.length === 0) return null;
      const idx = forceIndex ?? popIndex;
      const item = popItems[idx] ?? popItems[0];
      if (!item || item.id === "" || item.id === "@") return null;

      if (mentionState) {
        return text.slice(0, mentionState.start) + "@" + item.id + " ";
      }
      if (!slashState) return null;
      if (slashState.arg === "" && !slashState.exact) {
        return item.id + " ";
      }
      return text.slice(0, slashState.cmd.length + 1) + item.id;
    },
    [popItems, popIndex, text, mentionState, slashState]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (popItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPopIndex((i) => (i + 1) % popItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPopIndex((i) => (i - 1 + popItems.length) % popItems.length);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        acceptPopItem();
        return;
      }
      // Enter while popover is open: if the command is already complete
      // (Phase 2/3 — we're picking a target), accept the pop item AND send.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        acceptPopItem();
        if (slashState && slashState.exact && onSlashCommand) {
          // Call getAcceptedText to compute what the completed text looks like
          // without relying on React state (still batched from acceptPopItem).
          const nextText = getAcceptedText();
          if (nextText) {
            const trimmed = nextText.trim();
            if (trimmed.startsWith("/")) {
              const space = trimmed.indexOf(" ");
              const cmd = space === -1 ? trimmed.slice(1) : trimmed.slice(1, space);
              const arg = space === -1 ? "" : trimmed.slice(space + 1);
              onSlashCommand(cmd, arg);
              setText("");
            }
          }
        }
        return;
      }
    }

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

      {/* Slash command popover — floats above the textarea */}
      {popItems.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 mb-1 z-20">
          <div className="border border-[var(--accent)] bg-[var(--bg-primary)] max-h-[180px] overflow-y-auto text-xs shadow-lg">
            {popItems.map((item, i) => (
              <div
                key={item.id + i}
                data-testid={i === popIndex ? "slash-pop-active" : "slash-pop-item"}
                className={`px-2 py-1 flex items-center gap-3 cursor-pointer ${
                  i === popIndex
                    ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                }`}
                onClick={() => acceptPopItem(i)}
              >
                <span className="flex-1">{item.label}</span>
                {item.secondary && (
                  <span className="text-[var(--text-muted)]">{item.secondary}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload error — only takes space when visible */}
      {error && (
        <div className="flex items-center mt-1.5">
          <span className="text-[var(--error)] text-xs ml-auto text-right">
            {error}
          </span>
        </div>
      )}

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
