/** Theme hook: reads the active theme from a store and applies it as a React
 *  attribute; also exposes a setter and the current theme name. */
import { useCallback, useSyncExternalStore } from "react";
import {
  THEMES,
  getStoredThemeId,
  getStoredThemeIdForMode,
  storeThemeId,
  getTheme,
} from "./themes";
import type { Theme, ThemeColors, ThemeMode } from "./themes";

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
 * CRT scanline overlay opacity. Dark backgrounds swallow the black scanlines,
 * but on light themes they read as obvious stripes — so light mode gets a much
 * subtler version.
 */
const SCANLINE_OPACITY: Record<ThemeMode, string> = {
  dark: "0.4",
  light: "0.1",
};

/**
 * Opacity of the dark depth blur (second shadow) on .glow elements. Dark
 * themes keep it for contrast against dark backgrounds; in light mode it
 * reads as a dirty dark ring around the pastel halo, so it's removed
 * entirely.
 */
const GLOW_SHADOW_OPACITY: Record<ThemeMode, string> = {
  dark: "0.3",
  light: "0",
};

/** How much white to blend into the accent for the light-mode glow halo. */
const LIGHT_GLOW_WHITE_RATIO = 0.55;

/** Mix a #rrggbb color toward white by `ratio` (0..1). */
function mixWithWhite(hex: string, ratio: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * ratio);
  return `rgb(${mix(r)} ${mix(g)} ${mix(b)})`;
}

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
  root.style.setProperty("--scanline-opacity", SCANLINE_OPACITY[theme.mode]);
  root.style.setProperty(
    "--glow-color",
    theme.mode === "light"
      ? mixWithWhite(theme.colors.accent, LIGHT_GLOW_WHITE_RATIO)
      : "currentColor"
  );
  root.style.setProperty(
    "--glow-shadow-opacity",
    GLOW_SHADOW_OPACITY[theme.mode]
  );
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

  /**
   * Switch modes (dark/light). The theme resolves to whatever was last
   * selected in that mode, or that mode's default theme on first switch.
   */
  const setMode = useCallback((mode: ThemeMode) => {
    setThemeId(getStoredThemeIdForMode(mode));
  }, []);

  return { themeId, theme, setTheme, setMode, mode: theme.mode, themes: THEMES };
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
