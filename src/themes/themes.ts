/**
 * Theme definitions.
 *
 * Each theme maps onto the CSS custom properties consumed throughout the app.
 * The active theme is applied by setting these variables on :root via a
 * <style> tag injected by the ThemeProvider. Everything is dark.
 */

export interface ThemeColors {
  /** Deepest background — the body / app frame. */
  bgPrimary: string;
  /** Panel / sidebar / card background. */
  bgSecondary: string;
  /** Raised surface (inputs, hover, nested panels). */
  bgTertiary: string;
  /** Border / divider color. */
  borderPrimary: string;
  /** Primary text. */
  textPrimary: string;
  /** Secondary text (body copy). */
  textSecondary: string;
  /** Muted text (timestamps, hints). */
  textMuted: string;
  /** Accent — prompts, cursor, active highlights. */
  accent: string;
  /** Lighter accent for hover/active states. */
  accentLight: string;
  /** Error / warning. */
  error: string;
}

export interface Theme {
  id: string;
  name: string;
  /** Short description shown in the palette. */
  description: string;
  colors: ThemeColors;
}

export const THEMES: Theme[] = [
  {
    id: "dawn",
    name: "Dawn",
    description: "Simple black with subtle orange + sunrise accents",
    colors: {
      // Very dark / near-black backgrounds with the faintest warm tint.
      bgPrimary: "#0a0a0c",
      bgSecondary: "#101013",
      bgTertiary: "#161619",
      borderPrimary: "#26262b",
      // Off-white text, low contrast.
      textPrimary: "#d8d4d0",
      textSecondary: "#9a958e",
      textMuted: "#5c5852",
      // Subtle orange / sunrise accent — muted, not neon.
      accent: "#d98a4e",
      accentLight: "#e8a96b",
      error: "#c75450",
    },
  },
  {
    id: "matrix",
    name: "Matrix",
    description: "Phosphor green on black",
    colors: {
      bgPrimary: "#000000",
      bgSecondary: "#0a0f0a",
      bgTertiary: "#0f1a0f",
      borderPrimary: "#1a3a1a",
      textPrimary: "#33ff33",
      textSecondary: "#22cc22",
      textMuted: "#1a881a",
      accent: "#33ff33",
      accentLight: "#66ff66",
      error: "#ff3344",
    },
  },
  {
    id: "amber",
    name: "Amber",
    description: "Warm amber on near-black (VT220)",
    colors: {
      bgPrimary: "#0a0600",
      bgSecondary: "#140d00",
      bgTertiary: "#1f1400",
      borderPrimary: "#3a2400",
      textPrimary: "#ffb000",
      textSecondary: "#cc8800",
      textMuted: "#885500",
      accent: "#ffb000",
      accentLight: "#ffcc44",
      error: "#ff4444",
    },
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    description: "Neon magenta + cyan",
    colors: {
      bgPrimary: "#0a0014",
      bgSecondary: "#140028",
      bgTertiary: "#1f0040",
      borderPrimary: "#3a1066",
      textPrimary: "#ff2bd6",
      textSecondary: "#c41fa3",
      textMuted: "#7a1688",
      accent: "#00f0ff",
      accentLight: "#44f0ff",
      error: "#ff3366",
    },
  },
  {
    id: "muted",
    name: "Muted",
    description: "Soft gray-blue on charcoal",
    colors: {
      bgPrimary: "#14161a",
      bgSecondary: "#1c1f24",
      bgTertiary: "#262a30",
      borderPrimary: "#3a3f47",
      textPrimary: "#d8dce4",
      textSecondary: "#9aa0aa",
      textMuted: "#5c626c",
      accent: "#7aa2f7",
      accentLight: "#9bb8ff",
      error: "#f06a6a",
    },
  },
  {
    id: "synthwave",
    name: "Synthwave",
    description: "Purple haze + sunset gradients",
    colors: {
      bgPrimary: "#1a0b2e",
      bgSecondary: "#241046",
      bgTertiary: "#2e1561",
      borderPrimary: "#4a1f88",
      textPrimary: "#f9f5ff",
      textSecondary: "#c4a8e8",
      textMuted: "#7a5c9e",
      accent: "#ff5edf",
      accentLight: "#ff85e8",
      error: "#ff4d6d",
    },
  },
  {
    id: "carbon",
    name: "Carbon",
    description: "Minimal monochrome terminal",
    colors: {
      bgPrimary: "#0b0b0b",
      bgSecondary: "#141414",
      bgTertiary: "#1e1e1e",
      borderPrimary: "#2e2e2e",
      textPrimary: "#e0e0e0",
      textSecondary: "#a8a8a8",
      textMuted: "#5a5a5a",
      accent: "#e0e0e0",
      accentLight: "#ffffff",
      error: "#d05050",
    },
  },
];

export const DEFAULT_THEME_ID = "dawn";

const STORAGE_KEY = "chat-theme-id";

export function getStoredThemeId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES.some((t) => t.id === stored)) return stored;
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_THEME_ID;
}

export function storeThemeId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // localStorage unavailable
  }
}

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
