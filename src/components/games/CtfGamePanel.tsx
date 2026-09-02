/** Complete the Funny in-play panel: one-prompt-at-a-time answering,
 *  synchronized server-driven voting with live dot tallies (CTF-2/CTF-5),
 *  always-visible points (CTF-4), a points-reveal animation after each
 *  voting matchup (CTF-7), and an animated final scoreboard (CTF-6).
 *
 *  The server drives the shared voting screen: everyone votes on the same
 *  matchup at the same time (view.currentMatchup). Live vote dots re-render
 *  on every broadcast; a per-matchup countdown (view.voteDeadline) advances
 *  the room on all-voted OR timeout.
 */
import { useEffect, useRef, useState } from "react";
import type { CtfPlayView, CtfViewMatchup } from "../../types";
import {
  COPY_CTF,
  COPY as COPY_SHARED,
  matchupProgress,
  roundLabel,
  voteLockedIn,
  voteCountLabel,
} from "./gameCopy";

interface Props {
  view: CtfPlayView;
  meId: string;
  onAnswer: (answers: string[]) => void;
  onVote: (phaseIndex: number, answerId: string) => void;
}

export default function CtfGamePanel({ view, meId, onAnswer, onVote }: Props) {
  if (view.phase === "over" && view.leaderboard) {
    return <FinalScoreboard view={view} meId={meId} />;
  }
  if (view.phase === "voting" && view.phases) {
    return <SynchronizedVoting view={view} meId={meId} onVote={onVote} />;
  }
  return <AnsweringFlow view={view} meId={meId} onAnswer={onAnswer} />;
}

/* ── Answering ───────────────────────────────────────────────────── */

function AnsweringFlow({
  view,
  meId,
  onAnswer,
}: {
  view: CtfPlayView;
  meId: string;
  onAnswer: (answers: string[]) => void;
}) {
  const myPrompts = view.prompts[meId] ?? [];
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const secondsLeft = useDeadlineSeconds(view.deadline);
  const autoSubmitted = useRef(false);

  useEffect(() => {
    if (!view.deadline || secondsLeft > 0 || autoSubmitted.current) return;
    autoSubmitted.current = true;
    setSubmitted(true);
    onAnswer(myPrompts.map((_, i) => (answers[i] ?? "").trim()));
  }, [secondsLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  if (submitted) {
    return (
      <div data-testid="ctf-panel" className="flex flex-col items-center gap-2 py-6 animate-[fadeIn_0.3s_ease]">
        <div className="text-2xl">✅</div>
        <div className="text-sm text-[var(--text-muted)]">{COPY_CTF.answersSubmitted}</div>
      </div>
    );
  }

  const prompt = myPrompts[current];
  const isLast = current === myPrompts.length - 1;
  const value = answers[current] ?? "";

  const advance = () => {
    if (isLast) {
      autoSubmitted.current = true;
      setSubmitted(true);
      onAnswer(myPrompts.map((_, i) => (answers[i] ?? "").trim()));
      return;
    }
    setCurrent((c) => c + 1);
    setAnimKey((k) => k + 1);
  };

  const urgent = secondsLeft <= 10;
  const myScore = view.scores?.[meId] ?? 0;

  return (
    <div data-testid="ctf-panel" className="flex flex-col gap-3">
      <PhaseHeader round={view.round} phaseLabel={COPY_CTF.phaseAnswering} right={<PointsBadge score={myScore} />} />
      <ProgressBar current={current + 1} total={myPrompts.length} />
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[var(--text-muted)]">{current + 1}/{myPrompts.length}</span>
        {secondsLeft > 0 && (
          <CountdownPill seconds={secondsLeft} urgent={urgent} />
        )}
      </div>

      <div key={animKey} className="animate-[slideIn_0.25s_ease] flex flex-col gap-2">
        <div className="text-base font-semibold text-[var(--text-primary)] leading-snug">{prompt}</div>
        <input
          data-testid="ctf-answer-input"
          autoFocus
          value={value}
          onChange={(e) => setAnswers((prev) => ({ ...prev, [current]: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter" && value.trim()) advance(); }}
          placeholder={COPY_CTF.answerPlaceholder}
          maxLength={400}
          className="w-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors"
        />
        <button
          type="button"
          data-testid="ctf-answer-submit"
          disabled={!value.trim()}
          onClick={advance}
          className="self-start text-xs border border-[var(--accent)] text-[var(--accent)] px-4 py-1.5 bg-[var(--accent)]/10 cursor-pointer hover:bg-[var(--accent)]/20 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isLast ? COPY_CTF.submitAnswersButton : COPY_CTF.nextButton}
        </button>
      </div>
    </div>
  );
}

/* ── Synchronized voting (CTF-2 / CTF-5) ─────────────────────────── */

function SynchronizedVoting({
  view,
  meId,
  onVote,
}: {
  view: CtfPlayView;
  meId: string;
  onVote: (phaseIndex: number, answerId: string) => void;
}) {
  const phases = view.phases!;
  const current = view.currentMatchup ?? 0;
  const matchup: CtfViewMatchup | undefined = phases[current];
  const [myVote, setMyVote] = useState<string | null>(null);
  const secondsLeft = useDeadlineSeconds(view.voteDeadline ?? null);
  const myScore = view.scores?.[meId] ?? 0;

  // CTF-7: points-reveal animation when a matchup resolves. The server
  // advances `current` when all vote or the deadline passes. We detect the
  // transition and briefly show the resolved matchup's point gains before
  // the new matchup renders.
  const prevMatchup = useRef(current);
  const prevScores = useRef<Record<string, number> | undefined>(view.scores);
  const [reveal, setReveal] = useState<{ matchup: CtfViewMatchup; scoreDeltas: Record<string, number> } | null>(null);
  useEffect(() => {
    const advanced = prevMatchup.current !== current && current > 0;
    const oldScores = prevScores.current ?? {};
    const newScores = view.scores ?? {};
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    if (advanced) {
      // Matchup just advanced — the previous matchup resolved.
      const prev = phases[current - 1];
      const deltas: Record<string, number> = {};
      for (const answer of prev.answers) {
        const delta = (newScores[answer.playerId] ?? 0) - (oldScores[answer.playerId] ?? 0);
        if (delta > 0) deltas[answer.playerId] = delta;
      }
      // Only show the reveal if there were actual point gains (CTF-7).
      if (Object.keys(deltas).length > 0) {
        setReveal({ matchup: prev, scoreDeltas: deltas });
        revealTimer = setTimeout(() => setReveal(null), 2500);
      }
      setMyVote(null);
    }
    prevMatchup.current = current;
    prevScores.current = view.scores;
    return () => { if (revealTimer) clearTimeout(revealTimer); };
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!matchup) {
    return (
      <div data-testid="ctf-panel" className="text-sm text-[var(--text-muted)]">
        {COPY_CTF.waitingForMatchups}
      </div>
    );
  }

  const totalVoters = matchup.answers.reduce((sum, a) => sum + a.voteCount, 0);
  const urgent = secondsLeft <= 5;

  // CTF-7: show the points-reveal overlay when a matchup just resolved.
  if (reveal) {
    return (
      <PointsReveal matchup={reveal.matchup} scoreDeltas={reveal.scoreDeltas} meId={meId} />
    );
  }

  return (
    <div data-testid="ctf-panel" className="flex flex-col gap-3">
      <PhaseHeader
        round={view.round}
        phaseLabel={COPY_CTF.phaseVoting}
        right={<PointsBadge score={myScore} />}
      />
      <ProgressBar current={current + 1} total={phases.length} />
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[var(--text-muted)]">{matchupProgress(current + 1, phases.length)}</span>
        {secondsLeft > 0 && (
          <CountdownPill seconds={secondsLeft} urgent={urgent} />
        )}
      </div>

      <div key={current} className="animate-[slideIn_0.25s_ease] flex flex-col gap-2">
        <div className="text-base font-semibold text-[var(--text-primary)] leading-snug">{matchup.prompt}</div>
        {/* CTF-5: large answer rectangles — player on top, answer in middle, vote dots below */}
        <div className="flex flex-col gap-2">
          {matchup.answers.map((answer, i) => {
            const selected = myVote === answer.id;
            const mine = answer.playerId === meId;
            return (
              <button
                type="button"
                key={answer.id}
                data-testid={`ctf-vote-${current}-${answer.id}`}
                disabled={mine || myVote !== null}
                onClick={() => {
                  if (myVote !== null) return;
                  setMyVote(answer.id);
                  onVote(current, answer.id);
                }}
                className={`text-left border px-4 py-3 transition-all duration-200 active:scale-95
                  ${selected ? "border-[var(--accent)] bg-[var(--accent)]/15" : "border-[var(--border-primary)] hover:border-[var(--accent)]/60 hover:bg-[var(--accent)]/5 cursor-pointer"}
                  ${mine ? "cursor-not-allowed opacity-50" : ""}
                  ${myVote !== null && !selected ? "opacity-50" : ""}
                `}
              >
                {/* Player — small text on top */}
                <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-1">
                  {answer.playerId}{mine ? ` ${COPY_SHARED.youSuffix}` : ""}
                </div>
                {/* Answer — the largest, most important text */}
                <div className="text-base text-[var(--text-primary)] font-medium leading-snug mb-2">
                  {answer.text}
                </div>
                {/* Vote dots — one per vote received, live */}
                <div className="flex items-center gap-1.5">
                  {selected && <span className="text-[var(--accent)] text-xs">✓</span>}
                  {Array.from({ length: answer.voteCount }, (_, j) => (
                    <span
                      key={j}
                      className="w-2 h-2 rounded-full bg-[var(--accent)] animate-[fadeIn_0.2s_ease]"
                    />
                  ))}
                  {answer.voteCount > 0 && (
                    <span className="text-[10px] text-[var(--text-muted)] ml-1">{answer.voteCount}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {myVote !== null && (
          <div className="text-xs text-[var(--text-muted)] animate-[fadeIn_0.3s_ease]">
            {voteLockedIn(totalVoters)}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Final scoreboard (CTF-6) ───────────────────────────────────── */

function FinalScoreboard({ view, meId }: { view: CtfPlayView; meId: string }) {
  const entries = Object.entries(view.leaderboard!).sort((a, b) => b[1] - a[1]);
  const medals = ["🥇", "🥈", "🥉"];
  const winnerScore = entries[0]?.[1] ?? 0;
  const winners = entries.filter(([, s]) => s === winnerScore).map(([p]) => p);
  const iWon = winners.includes(meId);
  return (
    <div data-testid="ctf-leaderboard" className="flex flex-col gap-2 py-2 relative overflow-hidden">
      {/* Confetti burst */}
      {Array.from({ length: iWon ? 20 : 12 }, (_, i) => (
        <div
          key={i}
          className="absolute pointer-events-none"
          style={{
            left: `${4 + i * 4.5}%`,
            top: 0,
            width: `${1.5 + (i % 3) * 0.5}px`,
            height: `${1.5 + (i % 3) * 0.5}px`,
            background: ["var(--accent)", "var(--accent-light)", "var(--error)", "#2aa198", "#b58900"][i % 5],
            animation: `confetti-fall ${0.8 + (i % 3) * 0.3}s ease-out ${i * 0.05}s forwards`,
          }}
        />
      ))}
      {iWon && (
        <div className="text-center text-xs text-[var(--accent)] uppercase tracking-widest animate-[fadeIn_0.6s_ease]">
          {COPY_SHARED.youWinBanner}
        </div>
      )}
      <div className="text-center text-[11px] text-[var(--text-muted)] uppercase tracking-widest animate-[fadeIn_0.4s_ease]">
        {COPY_CTF.finalScoresHeading}
      </div>
      {entries.map(([player, score], i) => (
        <ScoreRow
          key={player}
          rank={i}
          player={player}
          score={score}
          meId={meId}
          medal={medals[i] ?? `${i + 1}.`}
        />
      ))}
    </div>
  );
}

/* ── Points-reveal animation (CTF-7) ─────────────────────────────── */

/**
 * CTF-7: when a voting matchup resolves, briefly show each winning answer
 * with an animated +0 → +{points} count-up. When only one answer wins
 * (unanimous), show special text and a knock-the-other-off animation.
 */
function PointsReveal({
  matchup,
  scoreDeltas,
  meId,
}: {
  matchup: CtfViewMatchup;
  scoreDeltas: Record<string, number>;
  meId: string;
}) {
  const winners = matchup.answers.filter((a) => scoreDeltas[a.playerId]);
  const isUnanimous = winners.length === 1 && winners.length < matchup.answers.length;
  const totalVotes = matchup.answers.reduce((s, a) => s + a.voteCount, 0);
  return (
    <div data-testid="ctf-points-reveal" className="flex flex-col gap-3 py-2 animate-[fadeIn_0.3s_ease]">
      <div className="text-center text-[11px] text-[var(--text-muted)] uppercase tracking-widest">
        {COPY_CTF.matchupResolved}
      </div>
      {isUnanimous && (
        <div className="text-center text-lg font-bold text-[var(--accent)] glow animate-[fadeIn_0.5s_ease]">
          {COPY_CTF.unanimousBanner}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {matchup.answers.map((answer, i) => {
          const delta = scoreDeltas[answer.playerId] ?? 0;
          const won = delta > 0;
          const knockedOff = !won && totalVotes > 0;
          return (
            <div
              key={answer.id}
              className={`relative border px-4 py-3 ${
                won
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border-primary)]"
              } ${knockedOff ? "animate-[slideOut_0.4s_ease_forwards]" : ""}`}
              style={{ animationDelay: knockedOff ? `${i * 0.1}s` : "0s" }}
            >
              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-1">
                {answer.playerId}{answer.playerId === meId ? ` ${COPY_SHARED.youSuffix}` : ""}
              </div>
              <div className="text-base text-[var(--text-primary)] font-medium mb-1">
                {answer.text}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--text-muted)]">
                  {voteCountLabel(answer.voteCount)}
                </span>
                {won && (
                  <span className="text-sm font-bold text-[var(--accent)] animate-[fadeIn_0.3s_ease]">
                    +<CountUp target={delta} />
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Shared building blocks ─────────────────────────────────────── */

function PhaseHeader({ round, phaseLabel, right }: { round: number; phaseLabel: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 animate-[fadeIn_0.3s_ease]">
      <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-widest">{roundLabel(round)}</span>
      <span className="text-[11px] text-[var(--text-muted)]">·</span>
      <span className="text-[11px] text-[var(--accent)] uppercase tracking-widest">{phaseLabel}</span>
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="h-1 w-full bg-[var(--bg-tertiary)] rounded-sm overflow-hidden">
      <div
        className="h-full bg-[var(--accent)] transition-all duration-300 ease-out"
        style={{ width: `${(current / total) * 100}%` }}
      />
    </div>
  );
}

function CountdownPill({ seconds, urgent }: { seconds: number; urgent: boolean }) {
  return (
    <span className={`ml-auto text-[11px] font-bold px-1.5 py-0.5 border ${urgent ? "text-[var(--error)] border-[var(--error)]/50 animate-pulse" : "text-[var(--text-muted)] border-[var(--border-primary)]"}`}>
      ⏱ {seconds}s
    </span>
  );
}

/** CTF-4: always-visible own points badge. */
function PointsBadge({ score }: { score: number }) {
  return (
    <span className="text-[11px] font-bold px-2 py-0.5 border border-[var(--accent)]/40 text-[var(--accent)] bg-[var(--accent)]/10">
      {score} {COPY_SHARED.pointsSuffix}
    </span>
  );
}

function ScoreRow({ rank, player, score, meId, medal }: {
  rank: number; player: string; score: number; meId: string; medal: string;
}) {
  const displayScore = useCountUp(score);
  return (
    <div
      data-testid={`ctf-rank-${rank}`}
      className={`flex items-center justify-between px-3 py-2 border transition-all animate-[slideIn_0.3s_ease] ${
        player === meId
          ? "border-[var(--accent)] bg-[var(--accent)]/10"
          : "border-[var(--border-primary)]"
      }`}
      style={{ animationDelay: `${rank * 80}ms` }}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm">{medal}</span>
        <span className={`text-sm ${player === meId ? "text-[var(--accent-light)] font-semibold" : "text-[var(--text-primary)]"}`}>
          {player}
          {player === meId && <span className="text-[10px] text-[var(--text-muted)] ml-1">{COPY_SHARED.youSuffix}</span>}
        </span>
      </div>
      <span className="text-sm font-bold text-[var(--accent)]">{displayScore}</span>
    </div>
  );
}

/** Inline count-up number (for the points-reveal, CTF-7). */
function CountUp({ target }: { target: number }) {
  const value = useCountUp(target);
  return <>{value}</>;
}

/* ── Hooks ──────────────────────────────────────────────────────── */

/**
 * Animate a number counting up from 0 to target over ~1s. Uses
 * requestAnimationFrame, but falls back to a setInterval if rAF doesn't
 * fire (jsdom under heavy test load). The final value always settles to
 * `target` even if the animation doesn't complete.
 */
function useCountUp(target: number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === 0) return;
    const start = performance.now();
    const duration = 1000;
    let raf: number | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      return t < 1;
    };
    // Try rAF first (smooth in real browsers).
    raf = requestAnimationFrame(function rafTick(now: number) {
      if (tick(now)) {
        raf = requestAnimationFrame(rafTick);
      }
    });
    // Fallback: also tick on an interval in case rAF never fires (jsdom).
    interval = setInterval(() => {
      if (!tick(performance.now())) {
        if (interval) clearInterval(interval);
        setValue(target); // ensure final value settles
      }
    }, 100);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
      if (interval) clearInterval(interval);
    };
  }, [target]);
  return value;
}

/** Seconds remaining until a deadline, 0 when null. */
function useDeadlineSeconds(deadline: number | null): number {
  const [remaining, setRemaining] = useState(() =>
    deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0
  );
  useEffect(() => {
    if (!deadline) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [deadline]);
  return remaining;
}
