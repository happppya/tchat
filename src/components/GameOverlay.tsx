import { useState } from "react";
import type {
  GameInvitation,
  GameRole,
  ImpostorPlayView,
  CtfPlayView,
  GameSettings,
} from "../types";
import { gameTypeName } from "../utils/games";
import ImpostorGamePanel from "./ImpostorGamePanel";
import CtfGamePanel from "./CtfGamePanel";
import GameSettingsPanel from "./GameSettingsPanel";

interface Props {
  game: GameInvitation;
  /** Current user id string ("" unknown) — used to detect the host. */
  currentUserId: number | null;
  onStart: (gameId: string, settings: GameSettings | undefined) => void;
  onClose: () => void;
  /** In-progress play view (spec §5/§6), when the game has started. */
  playView?: ImpostorPlayView | CtfPlayView | null;
  role?: GameRole | null;
  meId?: string;
  onHint?: (gameId: string, hint: string) => void;
  onChoose?: (gameId: string, choice: "continue" | "vote") => void;
  onVote?: (gameId: string, votedForId: string) => void;
  onGuess?: (gameId: string, guess: string) => void;
  onCtfAnswer?: (gameId: string, answers: string[]) => void;
  onCtfVote?: (gameId: string, phaseIndex: number, answerId: string) => void;
}

/**
 * The game window overlay (spec §3). Shows the lobby (participants + host) or,
 * once started, the in-progress badge. The host gets the Start button. Close
 * is a soft leave — the invitation card stays so the player can rejoin.
 */
export default function GameOverlay({
  game,
  currentUserId,
  onStart,
  onClose,
  playView = null,
  role = null,
  meId: propMeId = "",
  onHint,
  onChoose,
  onVote,
  onGuess,
  onCtfAnswer,
  onCtfVote,
}: Props) {
  const isHost = currentUserId !== null && game.hostId === String(currentUserId);
  const [settings, setSettings] = useState<GameSettings>({});

  const viewerId =
    propMeId || (currentUserId != null ? String(currentUserId) : "");

  return (
    <div
      data-testid="game-overlay"
      className="absolute inset-0 z-40 flex flex-col border border-[var(--border-primary)] bg-[var(--bg-primary)] overflow-y-auto"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
        <span className="text-[var(--accent)]">🎮</span>
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {gameTypeName(game.gameType)}
        </span>
        <span
          data-testid="game-status"
          className="text-[10px] text-[var(--text-muted)] border border-[var(--border-primary)] px-1 py-0.5"
        >
          {game.status === "playing" ? "In Progress" : "Lobby"}
        </span>
        <button
          type="button"
          onClick={onClose}
          data-testid="game-overlay-close"
          title="Close the game window (you can rejoin by clicking the invitation)"
          className="ml-auto text-[var(--text-muted)] text-xs border border-[var(--border-primary)] px-2 py-0.5 bg-transparent cursor-pointer hover:text-[var(--error)] hover:border-[var(--error)]/50 transition-colors"
        >
          [ close ]
        </button>
      </div>

      <div className="flex-1 px-3 py-2">
        <div className="text-xs text-[var(--text-muted)] uppercase tracking-widest mb-1">
          participants ({game.participantIds.length})
        </div>
        <div data-testid="game-participants" className="flex flex-col gap-1">
          {game.participantIds.map((id) => (
            <div
              key={id}
              data-testid="game-participant"
              className="flex items-center gap-2 text-sm text-[var(--text-primary)]"
            >
              <span>{id}</span>
              {currentUserId !== null && id === game.hostId && (
                <span className="text-[10px] text-[var(--accent)] border border-[var(--accent)]/40 px-1 py-0.5">
                  host
                </span>
              )}
            </div>
          ))}
        </div>

        {game.status === "lobby" ? (
          isHost ? (
            <div className="flex flex-col gap-2">
              <GameSettingsPanel
                gameType={game.gameType}
                settings={settings}
                onChange={setSettings}
              />
              <button
                type="button"
                onClick={() => onStart(game.gameId, settings)}
                data-testid="game-start-button"
                className="mt-1 self-start text-xs border border-[var(--accent)] text-[var(--accent)] px-3 py-1 bg-[var(--accent)]/10 cursor-pointer hover:bg-[var(--accent)]/20 transition-colors"
              >
                [ start game ]
              </button>
            </div>
          ) : (
            <div className="mt-3 text-xs text-[var(--text-muted)]">
              waiting for the host to start…
            </div>
          )
        ) : playView?.game === "impostor" ? (
          <ImpostorGamePanel
            view={playView}
            role={role}
            meId={viewerId}
            participantIds={game.participantIds}
            onHint={(hint) => onHint?.(game.gameId, hint)}
            onChoose={(choice) => onChoose?.(game.gameId, choice)}
            onVote={(votedForId) => onVote?.(game.gameId, votedForId)}
            onGuess={(guess) => onGuess?.(game.gameId, guess)}
          />
        ) : playView?.game === "complete-the-funny" ? (
          <CtfGamePanel
            view={playView}
            meId={viewerId}
            onAnswer={(answers) => onCtfAnswer?.(game.gameId, answers)}
            onVote={(phaseIndex, answerId) =>
              onCtfVote?.(game.gameId, phaseIndex, answerId)
            }
          />
        ) : (
          <div className="mt-3 text-xs text-[var(--text-muted)]">
            the game is in progress
          </div>
        )}
      </div>
    </div>
  );
}