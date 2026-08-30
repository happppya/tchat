/**
 * Bundled English pools (spec §9.7): curated word/hint entries for Impostor
 * and prompts for Complete the Funny, shipped with the app (no server-side
 * generation). Starter set — expand freely; entries must be hand-checked so
 * each hint hints at exactly its word without containing it.
 */
import type { WordEntry } from "./impostor";

export const IMPOSTOR_WORD_POOL: WordEntry[] = [
  { word: "bird", hint: "flies" },
  { word: "ocean", hint: "salty" },
  { word: "guitar", hint: "six strings" },
  { word: "library", hint: "quiet shelves" },
  { word: "pizza", hint: "cheesy round" },
  { word: "bicycle", hint: "two wheels, pedals" },
  { word: "coffee", hint: "bitter morning drink" },
  { word: "desert", hint: "sand and heat" },
  { word: "penguin", hint: "tuxedo bird" },
  { word: "keyboard", hint: "typing keys" },
  { word: "mountain", hint: "very tall land" },
  { word: "garden", hint: "grows plants" },
  { word: "candle", hint: "wax and wick" },
  { word: "suitcase", hint: "packed for travel" },
  { word: "mirror", hint: "shows reflection" },
  { word: "rainbow", hint: "after the rain" },
  { word: "statue", hint: "still and stone" },
  { word: "honey", hint: "sweet from bees" },
  { word: "lantern", hint: "portable light" },
  { word: "compass", hint: "points north" },
];

export const CTF_PROMPT_POOL: string[] = [
  "Weirdest hill to die on",
  "Bad excuse for late homework",
  "Worst superpower",
  "Most useless invention",
  "Best name for a pet rock",
  "Worst thing to say at a funeral",
  "Least effective pickup line",
  "Worst thing to hear from a surgeon",
  "Best way to waste a wish",
  "Most suspicious thing a landlord could say",
  "Worst text to send to your boss by accident",
  "Best excuse for being late to your own party",
  "Most unhelpful fortune cookie message",
  "Worst name for a boat",
  "Least convincing alibi",
  "Best thing to put on a tombstone",
  "Worst birthday surprise",
  "Most awkward elevator conversation starter",
  "Best fake band name",
  "Worst thing to find in your sandwich",
];
