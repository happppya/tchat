/** Grid of theme swatches; switching applies a saved theme. */
import { useEffect, useState } from "react";
import { useTheme } from "../../themes/useTheme";
import { THEMES } from "../../themes/themes";
import type { ThemeMode } from "../../themes/themes";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/** Small colour swatch preview bar. */
function Swatch({ color }: { color: string }) {
  return (
    <div
      className="w-8 h-4 rounded-sm shrink-0 border border-[var(--border-primary)]"
      style={{ backgroundColor: color }}
    />
  );
}

export default function ThemePicker({ isOpen, onClose }: Props) {
  const { themeId, setTheme, mode, setMode } = useTheme();
  const [localId, setLocalId] = useState(themeId);

  // Keep the locally-tracked selection in sync when the mode (and therefore
  // the active theme) changes.
  useEffect(() => {
    setLocalId(themeId);
  }, [themeId]);

  if (!isOpen) return null;

  const handleSelect = (id: string) => {
    setLocalId(id);
    setTheme(id);
  };

  const handleMode = (next: ThemeMode) => {
    // setMode resolves the theme for the new mode synchronously via the
    // store; the useEffect above keeps localId in step with it.
    setMode(next);
  };

  const visibleThemes = THEMES.filter((t) => t.mode === mode);

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-start justify-center pt-[10vh]"
      onClick={onClose}
    >
      {/* Semi-transparent backdrop — dims the background but lets it show
          through so the user can preview the new theme on the live chat. */}
      <div
        className="absolute inset-0 bg-black/40"
        aria-hidden="true"
      />

      <div
        className="relative term-panel w-[520px] max-w-[92vw] max-h-[70vh] overflow-y-auto shadow-2xl border border-[var(--border-primary)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-[var(--bg-secondary)] border-b border-[var(--border-primary)] px-4 py-3 flex items-center justify-between">
          <h2 className="text-[var(--text-primary)] text-sm font-semibold">
            choose theme
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] text-xs border border-[var(--border-primary)] px-2 py-1 bg-transparent cursor-pointer hover:text-[var(--text-primary)] transition-colors"
          >
            close
          </button>
        </div>

        {/* Mode toggle — switches between the dark and light theme sets */}
        <div className="p-3 pb-0 flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)] uppercase tracking-widest">
            mode
          </span>
          <div className="flex gap-1.5">
            <button
              onClick={() => handleMode("dark")}
              data-testid="theme-mode-dark"
              aria-pressed={mode === "dark"}
              className={`px-3 py-1 text-xs border cursor-pointer transition-colors ${
                mode === "dark"
                  ? "bg-[var(--bg-tertiary)] border-[var(--accent)] text-[var(--accent)]"
                  : "bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              ● dark
            </button>
            <button
              onClick={() => handleMode("light")}
              data-testid="theme-mode-light"
              aria-pressed={mode === "light"}
              className={`px-3 py-1 text-xs border cursor-pointer transition-colors ${
                mode === "light"
                  ? "bg-[var(--bg-tertiary)] border-[var(--accent)] text-[var(--accent)]"
                  : "bg-[var(--bg-primary)] border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}
            >
              ○ light
            </button>
          </div>
          <span className="ml-auto text-xs text-[var(--text-muted)]">
            {visibleThemes.length} themes
          </span>
        </div>

        <div className="p-3 flex flex-col gap-2">
          {visibleThemes.map((t) => {
            const active = t.id === localId;
            return (
              <button
                key={t.id}
                onClick={() => handleSelect(t.id)}
                data-testid={`theme-option-${t.id}`}
                className={`text-left px-4 py-2.5 flex flex-col gap-1.5 border cursor-pointer transition-colors ${
                  active
                    ? "bg-[var(--bg-tertiary)] border-[var(--accent)]"
                    : "bg-[var(--bg-primary)] border-[var(--border-primary)] hover:border-[var(--text-muted)]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`text-sm font-semibold ${
                      active
                        ? "text-[var(--accent)]"
                        : "text-[var(--text-primary)]"
                    }`}
                  >
                    {t.name}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {t.description}
                  </span>
                  {active && (
                    <span className="ml-auto text-[var(--accent)] text-xs">
                      ● active
                    </span>
                  )}
                </div>

                {/* Colour preview row */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Swatch color={t.colors.bgPrimary} />
                  <Swatch color={t.colors.bgSecondary} />
                  <Swatch color={t.colors.bgTertiary} />
                  <Swatch color={t.colors.borderPrimary} />
                  <Swatch color={t.colors.textPrimary} />
                  <Swatch color={t.colors.textSecondary} />
                  <Swatch color={t.colors.textMuted} />
                  <Swatch color={t.colors.accent} />
                  <Swatch color={t.colors.accentLight} />
                  <Swatch color={t.colors.error} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}