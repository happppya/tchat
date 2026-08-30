/**
 * Registry of available minigame types (spec §8 Phase 0): static metadata the
 * client dropdown and the invitation card render from. `gameCreate` validates
 * against this list, so unknown types never reach the GameManager.
 */
export interface GameTypeInfo {
  id: string;
  displayName: string;
  icon: string;
  description: string;
}

export const GAME_TYPES: GameTypeInfo[] = [
  {
    id: "impostor",
    displayName: "Impostor",
    icon: "🕵️",
    description: "Find the impostor before they guess the secret word.",
  },
  {
    id: "complete-the-funny",
    displayName: "Complete the Funny",
    icon: "😂",
    description: "Answer silly prompts, then vote for the funniest.",
  },
];

const BY_ID = new Map(GAME_TYPES.map((game) => [game.id, game]));

export function getGameType(id: string): GameTypeInfo | undefined {
  return BY_ID.get(id);
}

export function isKnownGameType(id: string): boolean {
  return BY_ID.has(id);
}
