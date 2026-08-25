/**
 * Theme definitions.
 *
 * Each theme maps onto the CSS custom properties consumed throughout the app.
 * The active theme is applied by setting these variables on :root via a
 * <style> tag injected by the ThemeProvider.
 *
 * Themes come in two modes — dark and light. Dark is the default; the light
 * set is reachable through the mode toggle in the theme picker.
 */

export type ThemeMode = "dark" | "light";

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
  mode: ThemeMode;
  /** Short description shown in the palette. */
  description: string;
  colors: ThemeColors;
}

export const THEMES: Theme[] = [
  {
    id: "dawn",
    name: "Dawn",
    mode: "dark",
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
    mode: "dark",
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
    mode: "dark",
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
    mode: "dark",
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
    mode: "dark",
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
    mode: "dark",
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
    mode: "dark",
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
    mode: "dark",
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
    mode: "dark",
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
  {
    id: "rose",
    name: "Rose Quartz",
    mode: "dark",
    description: "Blush pink & dusty mauve — soft as rose-tinted glass",
    colors: {
      bgPrimary: "#120c10",
      bgSecondary: "#1a1118",
      bgTertiary: "#241922",
      borderPrimary: "#362832",
      textPrimary: "#e8d8e0",
      textSecondary: "#c0a0b0",
      textMuted: "#7a5e6e",
      accent: "#e8a0b8",
      accentLight: "#f0c4d4",
      error: "#d06070",
    },
  },
  {
    id: "void",
    name: "Void",
    mode: "dark",
    description: "Near-absolute black with piercing white-blue, cold and stark",
    colors: {
      bgPrimary: "#060608",
      bgSecondary: "#0c0c10",
      bgTertiary: "#14141a",
      borderPrimary: "#1e1e28",
      textPrimary: "#c8d0e0",
      textSecondary: "#7a849a",
      textMuted: "#404860",
      accent: "#90b8f8",
      accentLight: "#b8d4ff",
      error: "#d04858",
    },
  },
  {
    id: "matcha",
    name: "Matcha",
    mode: "dark",
    description: "Creamy green tea — sage, oat, and soft olive",
    colors: {
      bgPrimary: "#0c0e0a",
      bgSecondary: "#12160e",
      bgTertiary: "#1a1f14",
      borderPrimary: "#283020",
      textPrimary: "#d8dcc8",
      textSecondary: "#a4ac8e",
      textMuted: "#646e50",
      accent: "#b8c478",
      accentLight: "#d4daa0",
      error: "#c87058",
    },
  },
  {
    id: "noir",
    name: "Noir",
    mode: "dark",
    description: "Deep cinema black with aged gold — a vintage projector glow",
    colors: {
      bgPrimary: "#080606",
      bgSecondary: "#0e0c0a",
      bgTertiary: "#161210",
      borderPrimary: "#282018",
      textPrimary: "#d8d0c0",
      textSecondary: "#a89878",
      textMuted: "#6a5e48",
      accent: "#c8a850",
      accentLight: "#e0c878",
      error: "#b85048",
    },
  },
  {
    id: "arctic",
    name: "Arctic",
    mode: "dark",
    description: "Glacial ice & slate — crisp blue-white on frozen stone",
    colors: {
      bgPrimary: "#0a0e14",
      bgSecondary: "#0f141e",
      bgTertiary: "#151c28",
      borderPrimary: "#202c3c",
      textPrimary: "#dce4f0",
      textSecondary: "#90a4c0",
      textMuted: "#506078",
      accent: "#88c8e8",
      accentLight: "#b0e0f8",
      error: "#c87078",
    },
  },
  {
    id: "sunrise",
    name: "Sunrise",
    mode: "light",
    description: "Warm cream paper with a coral sunrise glow",
    colors: {
      bgPrimary: "#faf5ec",
      bgSecondary: "#f3ecdd",
      bgTertiary: "#ebe2cd",
      borderPrimary: "#d9ccae",
      textPrimary: "#33291e",
      textSecondary: "#7d6f58",
      textMuted: "#b8ab8d",
      accent: "#e2713b",
      accentLight: "#f59a6b",
      error: "#c94f3d",
    },
  },
  {
    id: "linen",
    name: "Linen",
    mode: "light",
    description: "Bleached-linen calm — ink-black type, terracotta accents",
    colors: {
      bgPrimary: "#f4f1ec",
      bgSecondary: "#ebe7df",
      bgTertiary: "#e1dcd2",
      borderPrimary: "#cfc8ba",
      textPrimary: "#2c2a26",
      textSecondary: "#6f6a60",
      textMuted: "#aaa49a",
      accent: "#c05a33",
      accentLight: "#d98055",
      error: "#b03a2e",
    },
  },
  {
    id: "mint",
    name: "Mint",
    mode: "light",
    description: "Fresh spearmint — cool greens on bright clean white",
    colors: {
      bgPrimary: "#f2faf4",
      bgSecondary: "#e6f3ea",
      bgTertiary: "#d9ebdf",
      borderPrimary: "#bfd8c8",
      textPrimary: "#1e3b2a",
      textSecondary: "#4f7a5f",
      textMuted: "#8fb39b",
      accent: "#2e9e5f",
      accentLight: "#5cbf85",
      error: "#c4503a",
    },
  },
  {
    id: "sky",
    name: "Sky",
    mode: "light",
    description: "Clear daytime blue — cerulean over soft white clouds",
    colors: {
      bgPrimary: "#f0f7fb",
      bgSecondary: "#e4eff6",
      bgTertiary: "#d7e7f0",
      borderPrimary: "#bcd2e0",
      textPrimary: "#1e2f3d",
      textSecondary: "#4f6c7e",
      textMuted: "#8fa8b8",
      accent: "#2f8fc1",
      accentLight: "#5fadd4",
      error: "#c94f4f",
    },
  },
  {
    id: "lavender",
    name: "Lavender",
    mode: "light",
    description: "Dried lavender — lilac fields with violet ink",
    colors: {
      bgPrimary: "#f8f5fc",
      bgSecondary: "#efeaf7",
      bgTertiary: "#e5def0",
      borderPrimary: "#d0c4e2",
      textPrimary: "#322a44",
      textSecondary: "#6d5f86",
      textMuted: "#a79ac0",
      accent: "#7b5bb8",
      accentLight: "#9d80d0",
      error: "#c94f6e",
    },
  },
  {
    id: "peach",
    name: "Peach",
    mode: "light",
    description: "Stone fruit — creamy peach with a coral-pink pit",
    colors: {
      bgPrimary: "#fdf6f0",
      bgSecondary: "#f6ece2",
      bgTertiary: "#efe1d4",
      borderPrimary: "#e0cbb6",
      textPrimary: "#402c24",
      textSecondary: "#82695c",
      textMuted: "#bda393",
      accent: "#e06e4f",
      accentLight: "#ee9578",
      error: "#c9433a",
    },
  },
  {
    id: "slate",
    name: "Slate",
    mode: "light",
    description: "Rain-washed slate — graphite text with cobalt sparks",
    colors: {
      bgPrimary: "#f2f4f7",
      bgSecondary: "#e7eaef",
      bgTertiary: "#dbdfe7",
      borderPrimary: "#c3c9d4",
      textPrimary: "#23272e",
      textSecondary: "#5c646f",
      textMuted: "#9aa2ae",
      accent: "#3d5fc0",
      accentLight: "#6a86d6",
      error: "#c0483c",
    },
  },
  {
    id: "ivory",
    name: "Ivory",
    mode: "light",
    description: "Gallery white with warm ivory panels and wine accents",
    colors: {
      bgPrimary: "#ffffff",
      bgSecondary: "#f7f4ee",
      bgTertiary: "#efeadf",
      borderPrimary: "#d8d0bf",
      textPrimary: "#26221c",
      textSecondary: "#6a6358",
      textMuted: "#a89f90",
      accent: "#8e3b4f",
      accentLight: "#b25e72",
      error: "#b03a2e",
    },
  },
  {
    id: "sage",
    name: "Sage",
    mode: "light",
    description: "Garden sage — dusty green-grey with fresh olive zing",
    colors: {
      bgPrimary: "#f4f6f0",
      bgSecondary: "#e9ede2",
      bgTertiary: "#dee3d4",
      borderPrimary: "#c6cdb6",
      textPrimary: "#2c3324",
      textSecondary: "#646e52",
      textMuted: "#9ba48a",
      accent: "#6a8f3f",
      accentLight: "#8fb062",
      error: "#b5523a",
    },
  },
  {
    id: "blush",
    name: "Blush",
    mode: "light",
    description: "First-date blush — rose-tinted paper with raspberry ink",
    colors: {
      bgPrimary: "#fdf4f6",
      bgSecondary: "#f7e8ec",
      bgTertiary: "#f0dbe2",
      borderPrimary: "#e0c3cd",
      textPrimary: "#40242e",
      textSecondary: "#7c5563",
      textMuted: "#b5909e",
      accent: "#d94f7a",
      accentLight: "#e87a9e",
      error: "#c0353f",
    },
  },
  {
    id: "sand",
    name: "Sand",
    mode: "light",
    description: "Desert noon — warm dunes with a flash of gold",
    colors: {
      bgPrimary: "#faf4e8",
      bgSecondary: "#f2e9d6",
      bgTertiary: "#e9dec4",
      borderPrimary: "#d6c6a4",
      textPrimary: "#3d3222",
      textSecondary: "#7a6a4c",
      textMuted: "#b2a27e",
      accent: "#c98f2a",
      accentLight: "#dcae4f",
      error: "#b5502e",
    },
  },
  {
    id: "frost",
    name: "Frost",
    mode: "light",
    description: "Morning frost — icy blue-white with glacier teal",
    colors: {
      bgPrimary: "#f3f8fb",
      bgSecondary: "#e6eef5",
      bgTertiary: "#d9e5ef",
      borderPrimary: "#bccfdd",
      textPrimary: "#1f2e3b",
      textSecondary: "#50677a",
      textMuted: "#92a8ba",
      accent: "#1f8f9e",
      accentLight: "#4fb2bf",
      error: "#c04a52",
    },
  },
  {
    id: "cocoa",
    name: "Cocoa",
    mode: "light",
    description: "Milky cocoa — warm browns with a caramel melt",
    colors: {
      bgPrimary: "#f7f1ea",
      bgSecondary: "#efe5da",
      bgTertiary: "#e6d8c9",
      borderPrimary: "#d2bfa9",
      textPrimary: "#35271c",
      textSecondary: "#6f5a47",
      textMuted: "#a8917b",
      accent: "#a9653a",
      accentLight: "#c0844f",
      error: "#b3402e",
    },
  },
  {
    id: "butter",
    name: "Butter",
    mode: "light",
    description: "Sunny butter — bright cream with honey-gold sparkle",
    colors: {
      bgPrimary: "#fdf8e8",
      bgSecondary: "#f6eecf",
      bgTertiary: "#efe4b6",
      borderPrimary: "#dccc8f",
      textPrimary: "#3a3018",
      textSecondary: "#75683c",
      textMuted: "#aea06e",
      accent: "#d9a519",
      accentLight: "#e6bd45",
      error: "#b3452e",
    },
  },
];

export const DEFAULT_THEME_ID = "dawn";

/** Default light theme, applied the first time the user switches to light. */
export const DEFAULT_LIGHT_THEME_ID = "sunrise";

/** Which mode the user last had active. */
const MODE_STORAGE_KEY = "chat-theme-mode";
/** Per-mode selection keys. */
const DARK_THEME_STORAGE_KEY = "chat-theme-dark-id";
const LIGHT_THEME_STORAGE_KEY = "chat-theme-light-id";
/** Legacy key from before the dark/light split — always held a dark theme. */
const LEGACY_THEME_STORAGE_KEY = "chat-theme-id";

function defaultForMode(mode: ThemeMode): string {
  return mode === "dark" ? DEFAULT_THEME_ID : DEFAULT_LIGHT_THEME_ID;
}

function themeKeyForMode(mode: ThemeMode): string {
  return mode === "dark" ? DARK_THEME_STORAGE_KEY : LIGHT_THEME_STORAGE_KEY;
}

/** Which mode is active, honoring the stored preference (dark by default). */
export function getStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (stored === "dark" || stored === "light") return stored;
    // Pre-split installs only ever wrote chat-theme-id, which was dark.
    if (localStorage.getItem(LEGACY_THEME_STORAGE_KEY)) return "dark";
  } catch {
    // localStorage unavailable
  }
  return "dark";
}

/** Stored theme for a given mode, falling back to that mode's default. */
export function getStoredThemeIdForMode(mode: ThemeMode): string {
  try {
    const stored = localStorage.getItem(themeKeyForMode(mode));
    if (stored && THEMES.some((t) => t.id === stored && t.mode === mode)) {
      return stored;
    }
    if (mode === "dark") {
      // Migrate a pre-split selection (chat-theme-id was always a dark theme).
      const legacy = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
      if (legacy && THEMES.some((t) => t.id === legacy && t.mode === "dark")) {
        return legacy;
      }
    }
  } catch {
    // localStorage unavailable
  }
  return defaultForMode(mode);
}

/** The active theme id, honoring the stored mode. */
export function getStoredThemeId(): string {
  return getStoredThemeIdForMode(getStoredMode());
}

export function storeThemeId(id: string): void {
  const theme = getTheme(id);
  try {
    localStorage.setItem(themeKeyForMode(theme.mode), id);
    localStorage.setItem(MODE_STORAGE_KEY, theme.mode);
  } catch {
    // localStorage unavailable
  }
}

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
