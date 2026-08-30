import { useState } from "react";
import type { GameRole, ImpostorPlayView } from "../types";

interface Props {
  view: ImpostorPlayView;
  role: GameRole | null;
  /** The viewer's display identity — anon name in anonymous rooms, else id. */
  meId: string;
  /** Everyone who can be voted for, by display identity. */
  participantIds: string[];
  onHint: (hint: string) => void;
  onChoose: (choice: "continue" | "vote") => void;
  onVote: (votedForId: string) => void;
  onGuess: (guess: string) => void;
}

/**
 * Impostor gameplay panel (spec §5) shown inside the game overlay once a game
 * is in progress. Renders only the phase appropriate to the current view, and
 * never leaks the secret word outside the turn taker's role frame.
 */
export default function ImpostorGamePanel({
  view,
  role,
  meId,
  participantIds,
  onHint,
  onChoose,
  onVote,
  onGuess,
}: Props) {
  const [hint, setHint] = useState("");
  const [guess, setGuess] = useState("");

  const myTurn = view.phase === "hint" && view.turnPlayerId === meId;

  return (
    <div data-testid="impostor-panel" className="flex flex-col gap-3">
      <div className="text-[11px] text-[var(--text-muted)] uppercase tracking-widest">
        round {view.round} · {view.phase}
      </div>

      {view.phase === "hint" && (
        <div className="flex flex-col gap-2">
          {myTurn ? (
            <div className="flex flex-col gap-2 items-start">
              <div className="text-xs text-[var(--text-muted)]">the word is</div>
              <div
                data-testid="impostor-word"
                className="text-2xl font-bold text-[var(--accent)]"
              >
                {role?.secretWord}
              </div>
              <input
                data-testid="impostor-hint-input"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="give a one-word hint…"
                className="w-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none"
              />
              <button
                type="button"
                data-testid="impostor-hint-submit"
                disabled={!hint.trim()}
                onClick={() => {
                  onHint(hint.trim());
                  setHint("");
                }}
                className="text-xs border border-[var(--accent)] text-[var(--accent)] px-3 py-1 bg-[var(--accent)]/10 cursor-pointer hover:bg-[var(--accent)]/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                [ submit hint ]
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="text-xs text-[var(--text-muted)]">
                waiting for a hint…
              </div>
              {Object.entries(view.hints).map(([giver, text]) => (
                <div
                  key={giver}
                  className="text-sm text-[var(--text-primary)] flex items-center gap-2"
                >
                  <span className="text-[var(--text-muted)]">{giver}:</span>
                  <span>{text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view.phase === "choose" && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-[var(--text-muted)]">
            the slime is among you. continue, or force a vote?
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="impostor-choose-continue"
              onClick={() => onChoose("continue")}
              className="text-xs border border-[var(--border-primary)] px-3 py-1 cursor-pointer hover:border-[var(--accent)] transition-colors"
            >
              [ continue ]
            </button>
            <button
              type="button"
              data-testid="impostor-choose-vote"
              onClick={() => onChoose("vote")}
              className="text-xs border border-[var(--error)]/60 text-[var(--error)] px-3 py-1 cursor-pointer hover:bg-[var(--error)]/10 transition-colors"
            >
              [ force a vote ]
            </button>
          </div>
        </div>
      )}

      {view.phase === "vote" && (
        <div className="flex flex-col gap-2">
          {view.votedOutId ? (
            <div
              data-testid="impostor-voted-out"
              className="text-sm text-[var(--accent)]"
            >
              voted out: {view.votedOutId}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="text-xs text-[var(--text-muted)]">
                vote out the slime:
              </div>
              {participantIds
                .filter((p) => p !== meId)
                .map((p) => (
                  <button
                    type="button"
                    key={p}
                    data-testid={`impostor-vote-${p}`}
                    onClick={() => onVote(p)}
                    className="text-left text-sm border border-[var(--border-primary)] px-2 py-1 cursor-pointer hover:border-[var(--error)] transition-colors"
                  >
                    {p}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {view.phase === "guess" && (
        <div className="flex flex-col gap-2">
          {view.votedOutId === meId ? (
            <div className="flex flex-col gap-2 items-start">
              <div className="text-xs text-[var(--text-muted)]">
                you were voted out. guess the real word:
              </div>
              <input
                data-testid="impostor-guess-input"
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
                placeholder="what is the secret word?"
                className="w-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none"
              />
              <button
                type="button"
                data-testid="impostor-guess-submit"
                disabled={!guess.trim()}
                onClick={() => {
                  onGuess(guess.trim());
                  setGuess("");
                }}
                className="text-xs border border-[var(--accent)] text-[var(--accent)] px-3 py-1 bg-[var(--accent)]/10 cursor-pointer hover:bg-[var(--accent)]/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                [ make the guess ]
              </button>
            </div>
          ) : (
            <div className="text-xs text-[var(--text-muted)]">
              waiting for the voted-out player to guess…
            </div>
          )}
        </div>
      )}

      {view.phase === "over" && (
        <div
          data-testid="impostor-outcome"
          className="text-lg font-bold text-[var(--accent)]"
        >
          {outcomeLabel(view.outcome)}
        </div>
      )}
    </div>
  );
}

function outcomeLabel(outcome: string | null): string {
  switch (outcome) {
    case "crewmates-win":
      return "the crewmates win";
    case "crewmates-lose":
      return "the slime decimated the crewmates";
    case "draw":
      return "draw";
    case "tie":
      return "tie — no one voted out";
    default:
      return outcome ?? "game over";
  }
}