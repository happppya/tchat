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
    description: "Warm black with subtle orange + sunrise accents",
    colors: {
      bgPrimary: "#0a0a0c",
      bgSecondary: "#101013",
      bgTertiary: "#161619",
      borderPrimary: "#26262b",
      textPrimary: "#d8d4d0",
      textSecondary: "#9a958e",
      textMuted: "#5c5852",
      accent: "#d98a4e",
      accentLight: "#e8a96b",
      error: "#c75450",
    },
  },
  {
    id: "matrix",
    name: "Matrix",
    description: "Aged CRT phosphor — soft sage on deep black-green",
    colors: {
      bgPrimary: "#080c08",
      bgSecondary: "#0e130e",
      bgTertiary: "#141a14",
      borderPrimary: "#1f2a1f",
      textPrimary: "#8cb88c",
      textSecondary: "#5e8a5e",
      textMuted: "#3a5c3a",
      accent: "#7ab87a",
      accentLight: "#a3d0a3",
      error: "#c7645a",
    },
  },
  {
    id: "amber",
    name: "Amber",
    description: "Warm caramel & copper on deep brown-black",
    colors: {
      bgPrimary: "#0c0a06",
      bgSecondary: "#14100a",
      bgTertiary: "#1c1610",
      borderPrimary: "#2e2418",
      textPrimary: "#d4b896",
      textSecondary: "#a08464",
      textMuted: "#6b5540",
      accent: "#c4956a",
      accentLight: "#dbb88c",
      error: "#c76450",
    },
  },
  {
    id: "cyberpunk",
    name: "Cyberpunk",
    description: "Moody indigo & plum with cool teal accents",
    colors: {
      bgPrimary: "#0d0c1a",
      bgSecondary: "#141328",
      bgTertiary: "#1c1a36",
      borderPrimary: "#2e2b4a",
      textPrimary: "#d4d0e8",
      textSecondary: "#9b94c0",
      textMuted: "#5e5890",
      accent: "#6ec6ca",
      accentLight: "#8fdbde",
      error: "#d4707a",
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
    description: "Dusk violet & soft rose — mellow retro-future",
    colors: {
      bgPrimary: "#19102a",
      bgSecondary: "#221840",
      bgTertiary: "#2c2056",
      borderPrimary: "#3e2e70",
      textPrimary: "#eee8f4",
      textSecondary: "#baa8d4",
      textMuted: "#725e94",
      accent: "#d47ac0",
      accentLight: "#e09ed4",
      error: "#d46a70",
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
  {
    id: "forest",
    name: "Forest",
    description: "Deep moss & olive with warm wood tones",
    colors: {
      bgPrimary: "#0c0f0a",
      bgSecondary: "#12170e",
      bgTertiary: "#191f14",
      borderPrimary: "#273020",
      textPrimary: "#c8ccb8",
      textSecondary: "#8e967a",
      textMuted: "#575e48",
      accent: "#b8985a",
      accentLight: "#d4b878",
      error: "#c06850",
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Deep navy ink with pale aqua and slate blue",
    colors: {
      bgPrimary: "#0a0e16",
      bgSecondary: "#0f1420",
      bgTertiary: "#151b2a",
      borderPrimary: "#232d40",
      textPrimary: "#d0d8e8",
      textSecondary: "#8898b8",
      textMuted: "#4e5c78",
      accent: "#78b8c8",
      accentLight: "#a0d4e0",
      error: "#c86868",
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
