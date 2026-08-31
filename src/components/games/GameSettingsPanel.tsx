/** Host-only lobby settings editor — per-game fields sent as settings on
 *  gameStart. ms timers are edited in seconds. */
import type { GameSettings } from "../../types";

interface Props {
  gameType: "impostor" | "complete-the-funny";
  settings: GameSettings;
  /** Report a single-field change, preserving untouched settings. */
  onChange: (next: GameSettings) => void;
}

const FIELDS: Record<
  Props["gameType"],
  { key: keyof GameSettings; label: string; min?: number; max?: number; step?: number; hint?: string }[]
> = {
  impostor: [
    { key: "impostorCount", label: "number of slimes (impostors)", min: 1, hint: "default 1" },
    { key: "maxRounds", label: "max rounds", min: 1, max: 100, hint: "default 5" },
    { key: "hintTimeMs", label: "seconds to give a hint", min: 5, step: 1, hint: "default 30 s" },
    { key: "wordViewMs", label: "seconds to view your word", min: 2, step: 1, hint: "default 10 s" },
    { key: "guessTimeMs", label: "seconds to guess after being voted out", min: 5, step: 1, hint: "default 30 s" },
  ],
  "complete-the-funny": [
    { key: "promptsPerPlayer", label: "prompts per player", min: 2, hint: "default 4" },
    { key: "rounds", label: "rounds", min: 1, hint: "default 3" },
    { key: "answerTimeLimitMs", label: "seconds to answer", min: 5, step: 1, hint: "default 60 s" },
    { key: "voteTimeMs", label: "seconds to vote per matchup", min: 5, step: 1, hint: "default 30 s" },
  ],
};

/**
 * Host-adjustable lobby settings (spec §4/§6.1). ms settings are edited in
 * seconds for readability but stored as ms to match the server payload.
 */
export default function GameSettingsPanel({ gameType, settings, onChange }: Props) {
  return (
    <div data-testid="game-settings" className="flex flex-col gap-2 mt-3">
      <div className="text-[11px] text-[var(--text-muted)] uppercase tracking-widest">
        host settings
      </div>
      {FIELDS[gameType].map(({ key, label, min = 1, max, step = 1, hint }) => {
        const raw = settings[key];
        // ms fields are edited as seconds on the client.
        const display =
          raw === undefined
            ? ""
            : key === "hintTimeMs" || key === "wordViewMs" || key === "guessTimeMs" || key === "answerTimeLimitMs"
              ? Math.round(raw / 1000)
              : raw;
        return (
          <label key={key} className="flex items-center gap-2 text-xs">
            <span className="flex-1 text-[var(--text-primary)]">
              {label}
              {hint ? <span className="ml-1 text-[var(--text-muted)]">({hint})</span> : null}
            </span>
            <input
              data-testid={`set-${key}`}
              type="number"
              min={min}
              max={max}
              step={step}
              value={String(display)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n) || n < min) return;
                if (max !== undefined && n > max) return;
                const val =
                  key === "hintTimeMs" || key === "wordViewMs" || key === "guessTimeMs" || key === "answerTimeLimitMs" || key === "voteTimeMs"
                    ? Math.round(n * 1000)
                    : n;
                onChange({ ...settings, [key]: val });
              }}
              className="w-16 border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-sm text-[var(--text-primary)] outline-none"
            />
          </label>
        );
      })}
    </div>
  );
}