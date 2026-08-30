/** The keyboard-driven command palette (Ctrl/Cmd+K) that runs app actions. */
import { useState, useEffect, useRef, useMemo, useCallback } from "react";

export interface CommandAction {
  id: string;
  /** Group label shown as a heading in the palette. */
  section: string;
  /** Action title — searchable. */
  label: string;
  /** Optional subtitle / hint. */
  hint?: string;
  /** Keyboard shortcut shown on the right. */
  shortcut?: string;
  /** Optional keywords that also match the search. */
  keywords?: string;
  /** Run when the action is selected (Enter / click). */
  run: () => void;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Additional actions provided by the host (sidebar toggles, focus composer, etc.). */
  actions?: CommandAction[];
}

/**
 * A command-palette / shortcut menu. Open with the backtick (`) key.
 *
 * Renders a centered overlay with a search input at the top and a list of
 * grouped actions below. Arrow keys move the selection, Enter runs it, Esc
 * closes. The host registers global `` ` `` handling; this component handles
 * all in-palette keyboard navigation.
 */
export default function CommandPalette({ isOpen, onClose, actions = [] }: Props) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Host supplies all actions (including theme navigation).
  const allActions = actions;

  // Filter by the search query across label, hint, keywords, section.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allActions;
    return allActions.filter((a) => {
      const haystack = [a.label, a.hint ?? "", a.keywords ?? "", a.section]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [allActions, query]);

  // Reset selection + focus when opening.
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActiveIndex(0);
      // Focus on next tick so the input is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Keep activeIndex in bounds when the filtered list changes.
  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered, activeIndex]);

  // Scroll the active item into view.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const runActive = useCallback(() => {
    const action = filtered[activeIndex];
    if (action) {
      action.run();
      onClose();
    }
  }, [filtered, activeIndex, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runActive();
    }
  };

  if (!isOpen) return null;

  // Group filtered actions by section, preserving order.
  const sections: { section: string; items: { action: CommandAction; localIndex: number }[] }[] = [];
  filtered.forEach((action, i) => {
    let bucket = sections.find((s) => s.section === action.section);
    if (!bucket) {
      bucket = { section: action.section, items: [] };
      sections.push(bucket);
    }
    bucket.items.push({ action, localIndex: i });
  });

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      data-testid="command-palette"
    >
      <div
        className="term-panel w-[560px] max-w-[92vw] max-h-[60vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search row */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--border-primary)]">
          <span className="text-[var(--accent)] glow select-none">{"~>"}</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search actions…"
            data-testid="palette-search"
            className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)] text-sm"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="text-[10px] text-[var(--text-muted)] border border-[var(--border-primary)] px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        {/* Action list */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto py-1"
          data-testid="palette-list"
        >
          {sections.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-[var(--text-muted)]">
              No matching actions.
            </div>
          )}
          {sections.map((section) => (
            <div key={section.section}>
              <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                {section.section}
              </div>
              {section.items.map(({ action, localIndex }) => {
                const isActive = localIndex === activeIndex;
                return (
                  <button
                    key={action.id}
                    data-idx={localIndex}
                    onClick={runActive}
                    onMouseEnter={() => setActiveIndex(localIndex)}
                    className={`w-full text-left px-4 py-1.5 flex items-center gap-3 border-l-2 transition-colors ${
                      isActive
                        ? "bg-[var(--bg-tertiary)] border-[var(--accent)]"
                        : "border-transparent hover:bg-[var(--bg-tertiary)]"
                    }`}
                  >
                    <span
                      className={`text-sm ${
                        isActive
                          ? "text-[var(--text-primary)]"
                          : "text-[var(--text-secondary)]"
                      }`}
                    >
                      {action.label}
                    </span>
                    {action.hint && (
                      <span className="text-xs text-[var(--text-muted)] ml-1">
                        {action.hint}
                      </span>
                    )}
                    <span className="ml-auto" />
                    {action.shortcut && (
                      <kbd className="text-[10px] text-[var(--text-muted)] border border-[var(--border-primary)] px-1.5 py-0.5">
                        {action.shortcut}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-3 py-1.5 border-t border-[var(--border-primary)] text-[10px] text-[var(--text-muted)] flex items-center justify-between">
          <span>
            <kbd className="border border-[var(--border-primary)] px-1">↑↓</kbd>{" "}
            navigate ·{" "}
            <kbd className="border border-[var(--border-primary)] px-1">↵</kbd>{" "}
            select
          </span>
          <span>{filtered.length} actions</span>
        </div>
      </div>
    </div>
  );
}
