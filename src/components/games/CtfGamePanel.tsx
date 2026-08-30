/** Complete the Funny in-play panel: answering form (only the viewer's
 *  prompts), voting matchups, and the leaderboard. */
import { useState } from "react";
import type { CtfPlayView } from "../../types";

interface Props {
  view: CtfPlayView;
  /** The viewer's display identity — anon name in anonymous rooms, else id. */
  meId: string;
  /** Answering: per-prompt text → answers array (order matches the prompts). */
  onAnswer: (answers: string[]) => void;
  /** Voting: vote on a matchup. */
  onVote: (phaseIndex: number, answerId: string) => void;
}

/**
 * Complete the Funny gameplay panel (spec §6) shown inside the game overlay
 * once the game is in progress. Renders the answering form (only the viewer's
 * prompts) or the voting matchups, and the leaderboard when the game is over.
 */
export default function CtfGamePanel({ view, meId, onAnswer, onVote }: Props) {
  const [answers, setAnswers] = useState<Record<number, string>>({});

  if (view.phase === "over" && view.leaderboard) {
    const entries = Object.entries(view.leaderboard).sort((a, b) => b[1] - a[1]);
    return (
      <div data-testid="ctf-leaderboard" className="flex flex-col gap-1">
        <div className="text-[11px] text-[var(--text-muted)] uppercase tracking-widest">
          leaderboard
        </div>
        {entries.map(([player, score]) => (
          <div
            key={player}
            className="flex items-center justify-between text-sm text-[var(--text-primary)]"
          >
            <span>{player}</span>
            <span className="text-[var(--accent)]">{score}</span>
          </div>
        ))}
      </div>
    );
  }

  if (view.phase === "voting" && view.phases) {
    return (
      <div data-testid="ctf-panel" className="flex flex-col gap-4">
        <div className="text-[11px] text-[var(--text-muted)] uppercase tracking-widest">
          round {view.round} · voting
        </div>
        {view.phases.map((matchup, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="text-sm text-[var(--text-primary)]">{matchup.prompt}</div>
            {matchup.answers.map((answer) => (
              <button
                type="button"
                key={answer.id}
                data-testid={`ctf-vote-${i}-${answer.id}`}
                disabled={answer.playerId === meId}
                onClick={() => onVote(i, answer.id)}
                className="text-left text-sm border border-[var(--border-primary)] px-2 py-1 cursor-pointer hover:border-[var(--accent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {answer.text}
              </button>
            ))}
          </div>
        ))}
      </div>
    );
  }

  // answering
  const myPrompts = view.prompts[meId] ?? [];
  const filled = myPrompts.filter((_, i) => (answers[i] ?? "").trim()).length;
  return (
    <div data-testid="ctf-panel" className="flex flex-col gap-3">
      <div className="text-[11px] text-[var(--text-muted)] uppercase tracking-widest">
        round {view.round} · answering ({filled}/{myPrompts.length})
      </div>
      <div className="flex flex-col gap-2">
        {myPrompts.map((prompt, i) => (
          <label key={i} className="flex flex-col gap-1">
            <span className="text-xs text-[var(--text-primary)]">{prompt}</span>
            <input
              data-testid={`ctf-answer-${i}`}
              value={answers[i] ?? ""}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [i]: e.target.value }))}
              placeholder="your answer…"
              className="w-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-sm text-[var(--text-primary)] outline-none"
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        data-testid="ctf-answer-submit"
        onClick={() => {
          const payload = myPrompts.map((_, i) => (answers[i] ?? "").trim());
          onAnswer(payload);
        }}
        className="self-start text-xs border border-[var(--accent)] text-[var(--accent)] px-3 py-1 bg-[var(--accent)]/10 cursor-pointer hover:bg-[var(--accent)]/20 transition-colors"
      >
        [ submit answers ]
      </button>
    </div>
  );
}