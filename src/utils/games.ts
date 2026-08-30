/** Minigame metadata shared between the invitation card and the overlay. */
export const GAME_TYPE_NAMES: Record<string, string> = {
  impostor: "Impostor",
  "complete-the-funny": "Complete the Funny",
};

/** The games offered in the composer dropdown (spec §2.1), in order. */
export const AVAILABLE_GAMES: { id: string; name: string }[] = [
  { id: "impostor", name: GAME_TYPE_NAMES.impostor },
  { id: "complete-the-funny", name: GAME_TYPE_NAMES["complete-the-funny"] },
];

export function gameTypeName(gameType: string): string {
  return GAME_TYPE_NAMES[gameType] ?? gameType;
}