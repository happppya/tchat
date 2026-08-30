/** Clickable minigame invitation card rendered inside the chat message list
 *  (game name, status, player count). Clicking opens the lobby overlay. */
import type { GameInvitation } from "../../types";
import { gameTypeName } from "../../utils/games";

interface Props {
  game: GameInvitation;
  onClick: (gameId: string) => void;
}

/** Clickable game invitation card rendered in the message list (spec §2.2). */
export default function GameInvitationCard({ game, onClick }: Props) {
  return (
    <button
      type="button"
      data-testid="game-invitation"
      data-game-id={game.gameId}
      onClick={() => onClick(game.gameId)}
      className="w-full text-left border border-[var(--accent)]/40 bg-[var(--accent)]/5 hover:bg-[var(--accent)]/10 transition-colors px-3 py-2 cursor-pointer"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm text-[var(--accent)]">🎮</span>
        <span className="text-sm text-[var(--text-primary)] font-semibold">
          {gameTypeName(game.gameType)}
        </span>
        <span className="ml-auto text-[10px] text-[var(--text-muted)] border border-[var(--border-primary)] px-1 py-0.5">
          {game.status === "playing" ? "In Progress" : "Lobby"}
        </span>
      </div>
      <div className="mt-1 text-xs text-[var(--text-muted)]">
        {game.participantIds.length} player
        {game.participantIds.length === 1 ? "" : "s"}
        {game.status === "playing"
          ? " — in progress, only original players can rejoin"
          : " — click to join"}
      </div>
    </button>
  );
}