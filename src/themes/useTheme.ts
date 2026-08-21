import { useCallback, useSyncExternalStore } from "react";
import { THEMES, getStoredThemeId, storeThemeId, getTheme } from "./themes";
import type { Theme, ThemeColors } from "./themes";

/**
 * CSS custom property names (in declaration order) paired with the theme's
 * color keys. Kept in sync with ThemeColors.
 */
const CSS_VARS: { cssVar: string; key: keyof ThemeColors }[] = [
  { cssVar: "--bg-primary", key: "bgPrimary" },
  { cssVar: "--bg-secondary", key: "bgSecondary" },
  { cssVar: "--bg-tertiary", key: "bgTertiary" },
  { cssVar: "--border-primary", key: "borderPrimary" },
  { cssVar: "--text-primary", key: "textPrimary" },
  { cssVar: "--text-secondary", key: "textSecondary" },
  { cssVar: "--text-muted", key: "textMuted" },
  { cssVar: "--accent", key: "accent" },
  { cssVar: "--accent-light", key: "accentLight" },
  { cssVar: "--error", key: "error" },
];

/**
 * Apply a theme by setting CSS custom properties directly on the root element.
 *
 * Setting inline style on document.documentElement is bulletproof: inline
 * styles beat any stylesheet rule regardless of source order or Tailwind
 * layering, so every var-* utility re-reads the new values immediately.
 */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const { cssVar, key } of CSS_VARS) {
    root.style.setProperty(cssVar, theme.colors[key]);
  }
}

/**
 * Simple external store so multiple components can subscribe to theme changes
 * (e.g. the command palette) without prop-drilling.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let currentThemeId = getStoredThemeId();

// Apply on module load so the very first paint is correct (avoids flash).
if (typeof document !== "undefined") {
  applyTheme(getTheme(currentThemeId));
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): string {
  return currentThemeId;
}

function setThemeId(id: string): void {
  if (id === currentThemeId) return;
  currentThemeId = id;
  storeThemeId(id);
  applyTheme(getTheme(id));
  listeners.forEach((l) => l());
}

export function useTheme() {
  const themeId = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const theme = getTheme(themeId);

  const setTheme = useCallback((id: string) => {
    setThemeId(id);
  }, []);

  return { themeId, theme, setTheme, themes: THEMES };
}

/**
 * Subscribe to theme changes for use outside React (e.g. palette keyboard
 * handling). Returns an unsubscribe function.
 */
export function onThemeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export { getTheme };
