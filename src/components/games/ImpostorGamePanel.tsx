/** Impostor in-play panel: role reveal, hint/choose/vote/guess/over phases
 *  with CSS transitions and glow effects.
 *
 *  Playtest fixes:
 *   - I-1: continue-vs-vote respects the majority; running tally shown.
 *   - I-4: "answer" terminology (not clue / make-the-guess).
 *   - I-5: the final "over" play view is broadcast; it reveals the secret
 *     word + who the slime was to everyone (including the slime).
 *   - I-6: every player sees every answer at all times, incl. their own turn
 *     and the choose screen, with per-round attribution.
 *   - I-8: game-like full-window framing, bolder cards, progress dots. */
import { useEffect, useRef, useState } from "react";
import type { GameRole, ImpostorPlayView } from "../../types";
import {
  COPY_IMPOSTOR,
  decidedCount,
  outcomeHeadline,
  roundLabel,
  tallyCount,
  waitingForAnswer,
  waitingForAnswerTail,
  waitingForGuess,
  youVotedFor,
  votedOutLabel,
} from "./gameCopy";

interface Props {
  view: ImpostorPlayView;
  role: GameRole | null;
  meId: string;
  participantIds: string[];
  onHint: (hint: string) => void;
  onChoose: (choice: "continue" | "vote") => void;
  onVote: (votedForId: string) => void;
  onGuess: (guess: string) => void;
}

const PHASE_LABELS = COPY_IMPOSTOR.phaseLabels;

export default function ImpostorGamePanel({ view, role, meId, participantIds, onHint, onChoose, onVote, onGuess }: Props) {
  const [hint, setHint] = useState("");
  const [guess, setGuess] = useState("");
  const [choice, setChoice] = useState<"continue" | "vote" | null>(null);
  const [vote, setVote] = useState<string | null>(null);
  const [showReveal, setShowReveal] = useState(true);
  const prevPhaseRef = useRef<string | null>(null);

  // Reset local input state whenever the phase changes, so stale values
  // from a previous phase don't leak into the new one.
  useEffect(() => {
    if (prevPhaseRef.current === null) {
      prevPhaseRef.current = view.phase;
      return;
    }
    if (prevPhaseRef.current !== view.phase) {
      prevPhaseRef.current = view.phase;
      setShowReveal(false);
      setHint("");
      setGuess("");
      setChoice(null);
      setVote(null);
    }
  }, [view.phase]);

  const myTurn = view.phase === "hint" && view.turnPlayerId === meId;
  const isImpostor = role?.role === "impostor";

  if (view.phase === "hint" && showReveal && role) {
    return <RoleReveal role={role} isImpostor={isImpostor} onDismiss={() => setShowReveal(false)} />;
  }

  return (
    <div data-testid="impostor-panel" className="flex flex-col gap-3">
      <div key={`header-${view.phase}`} className="flex items-center gap-2 animate-[fadeIn_0.3s_ease]">
        <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-widest">{roundLabel(view.round)}</span>
        <span className="text-[11px] text-[var(--text-muted)]">·</span>
        <span className="text-[11px] text-[var(--accent)] uppercase tracking-widest">{PHASE_LABELS[view.phase]}</span>
        {view.phase === "hint" && view.hintDeadline && <HintTimer deadline={view.hintDeadline} />}
      </div>

      {view.phase === "hint" && (
        <div key={`hint-${view.phase}`} className="animate-[slideIn_0.25s_ease] flex flex-col gap-3">
          {/* Turn-order progress dots: who has answered this round. */}
          <TurnProgress
            order={participantIds}
            answered={Object.keys(view.hints)}
            turnPlayerId={view.turnPlayerId}
            meId={meId}
          />
          {/* I-6: every player sees every answer at all times. */}
          <AnswersList view={view} meId={meId} highlightGiver={view.turnPlayerId} />
          {myTurn ? (
            <div className="flex flex-col gap-2 border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3 animate-[fadeIn_0.3s_ease]">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-xs text-[var(--text-muted)]">
                  {isImpostor ? COPY_IMPOSTOR.yourHintCategory : COPY_IMPOSTOR.theSecretWord}
                </span>
                <span className={`text-lg font-bold ${isImpostor ? "text-[var(--error)]" : "text-[var(--accent)] glow"}`}>
                  {isImpostor ? role?.hint : role?.secretWord}
                </span>
              </div>
              <div className="text-xs text-[var(--text-primary)]">{COPY_IMPOSTOR.yourTurnOneWord}</div>
              <div className="flex gap-2 w-full">
                <input
                  data-testid="impostor-hint-input"
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && hint.trim()) {
                      onHint(hint.trim());
                      setHint("");
                    }
                  }}
                  placeholder={COPY_IMPOSTOR.answerPlaceholder}
                  maxLength={100}
                  autoFocus
                  className="flex-1 border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors"
                />
                <button
                  type="button"
                  data-testid="impostor-hint-submit"
                  disabled={!hint.trim()}
                  onClick={() => { onHint(hint.trim()); setHint(""); }}
                  className="text-xs border border-[var(--accent)] text-[var(--accent)] px-4 py-1.5 bg-[var(--accent)]/10 cursor-pointer hover:bg-[var(--accent)]/20 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {COPY_IMPOSTOR.submitAnswerButton}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-[var(--text-muted)] animate-pulse">
              waiting for <span className="text-[var(--accent)] glow">{view.turnPlayerId}</span> {" "}
              {waitingForAnswerTail(view.turnPlayerId ?? "")}
            </div>
          )}
        </div>
      )}

      {view.phase === "choose" && (
        <div key={`choose-${view.phase}`} className="animate-[slideIn_0.25s_ease] flex flex-col gap-3">
          {/* I-6: the choose screen also shows the round's answers. */}
          <AnswersList view={view} meId={meId} />
          <div className="text-sm text-[var(--text-primary)]">{COPY_IMPOSTOR.choosePrompt}</div>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="impostor-choose-continue"
              onClick={() => { setChoice("continue"); onChoose("continue"); }}
              disabled={choice !== null}
              className={`text-xs px-5 py-2 transition-all duration-200 cursor-pointer border active:scale-95 ${choice === "continue" ? "border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--accent-light)] glow" : "border-[var(--border-primary)] hover:border-[var(--accent)]"} ${choice !== null && choice !== "continue" ? "opacity-40" : ""}`}
            >
              {COPY_IMPOSTOR.continueButton}
            </button>
            <button
              type="button"
              data-testid="impostor-choose-vote"
              onClick={() => { setChoice("vote"); onChoose("vote"); }}
              disabled={choice !== null}
              className={`text-xs px-5 py-2 transition-all duration-200 cursor-pointer border active:scale-95 ${choice === "vote" ? "border-[var(--error)] bg-[var(--error)]/15 text-[var(--error)] glow" : "border-[var(--error)]/60 text-[var(--error)] hover:bg-[var(--error)]/10"} ${choice !== null && choice !== "vote" ? "opacity-40" : ""}`}
            >
              {COPY_IMPOSTOR.forceVoteButton}
            </button>
          </div>
          {/* I-1: running tally of both options. */}
          <ChooseTally
            choices={view.choices ?? {}}
            meId={meId}
            myChoice={choice}
            total={participantIds.length}
          />
        </div>
      )}

      {view.phase === "vote" && (
        <div key={`vote-${view.phase}`} className="animate-[slideIn_0.25s_ease] flex flex-col gap-3">
          {view.votedOutId ? (              <div data-testid="impostor-voted-out" className="text-sm text-[var(--accent)] font-semibold animate-[fadeIn_0.4s_ease]">
              {votedOutLabel(view.votedOutId!)}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="text-sm text-[var(--text-primary)]">{COPY_IMPOSTOR.votePrompt}</div>
              {participantIds.filter((p) => p !== meId).map((p) => {
                const selected = vote === p;
                const voteCount = view.votes
                  ? Object.values(view.votes).filter((t) => t === p).length
                  : 0;
                return (
                  <button
                    type="button"
                    key={p}
                    data-testid={`impostor-vote-${p}`}
                    disabled={vote !== null}
                    onClick={() => { setVote(p); onVote(p); }}
                    className={`text-left text-sm border px-3 py-2 transition-all duration-200 active:scale-95 ${selected ? "border-[var(--error)] bg-[var(--error)]/15 text-[var(--error)]" : "border-[var(--border-primary)] hover:border-[var(--error)] cursor-pointer"} ${vote !== null && !selected ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      {selected && <span className="text-[var(--error)]">✓</span>}
                      <span>{p}</span>
                      {/* Live vote dots: one dot per vote received. */}
                      {voteCount > 0 && (
                        <span className="ml-auto flex items-center gap-1">
                          {Array.from({ length: voteCount }, (_, i) => (
                            <span
                              key={i}
                              className="w-1.5 h-1.5 rounded-full bg-[var(--error)] animate-[fadeIn_0.2s_ease]"
                            />
                          ))}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
              {vote && (
                <div className="text-[10px] text-[var(--text-muted)] animate-[fadeIn_0.3s_ease] mt-1">
                  {youVotedFor(vote)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {view.phase === "guess" && (
        <div key={`guess-${view.phase}`} className="animate-[slideIn_0.25s_ease] flex flex-col gap-3">
          {view.votedOutId === meId ? (
            <div className="flex flex-col gap-2 border border-[var(--error)]/30 bg-[var(--error)]/5 p-3">
              <div className="text-sm text-[var(--error)] font-semibold">{COPY_IMPOSTOR.guessPrompt}</div>
              <div className="text-xs text-[var(--text-muted)]">
                {COPY_IMPOSTOR.guessHintLabel} <span className="text-[var(--error)] font-bold">{role?.hint}</span>
              </div>
              <div className="flex gap-2 w-full">
                <input
                  data-testid="impostor-guess-input"
                  value={guess}
                  onChange={(e) => setGuess(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && guess.trim()) {
                      onGuess(guess.trim());
                      setGuess("");
                    }
                  }}
                  placeholder={COPY_IMPOSTOR.guessPlaceholder}
                  maxLength={100}
                  autoFocus
                  className="flex-1 border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--error)] transition-colors"
                />
                <button
                  type="button"
                  data-testid="impostor-guess-submit"
                  disabled={!guess.trim()}
                  onClick={() => { onGuess(guess.trim()); setGuess(""); }}
                  className="text-xs border border-[var(--accent)] text-[var(--accent)] px-4 py-1.5 bg-[var(--accent)]/10 cursor-pointer hover:bg-[var(--accent)]/20 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {COPY_IMPOSTOR.submitAnswerButton}
                </button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-[var(--text-muted)] animate-pulse">
              {waitingForGuess(view.votedOutId!)}
            </div>
          )}
        </div>
      )}

      {view.phase === "over" && <OverScreen view={view} role={role} meId={meId} />}
    </div>
  );
}

/** Role-reveal card at the start of a hint phase: shows the player their role,
 *  the secret word (crewmates) or hint category (slime), and auto-dismisses
 *  when the word-view window closes so the game starts on time. */
function RoleReveal({ role, isImpostor, onDismiss }: { role: GameRole; isImpostor: boolean; onDismiss: () => void }) {
  useEffect(() => {
    // Auto-dismiss after the word-view window so a distracted player doesn't
    // stall the round. Mirrors the server's WORD_VIEW_MS (10s) default.
    const id = setTimeout(onDismiss, 10_000);
    return () => clearTimeout(id);
  }, [onDismiss]);
  return (
    <div data-testid="impostor-role-reveal" className="flex flex-col items-center gap-3 py-8 animate-[fadeIn_0.4s_ease]">
      <div className={`text-5xl ${isImpostor ? "animate-bounce" : ""}`}>{isImpostor ? "🟢" : "🛡️"}</div>
      <div className={`text-2xl font-bold ${isImpostor ? "text-[var(--error)] glow" : "text-[var(--accent)] glow"}`}>
        {isImpostor ? COPY_IMPOSTOR.revealYouAreSlime : COPY_IMPOSTOR.revealYouAreCrewmate}
      </div>
      <div className="text-xs text-[var(--text-muted)] text-center max-w-xs">
        {isImpostor ? COPY_IMPOSTOR.revealSlimeBlurb : COPY_IMPOSTOR.revealCrewmateBlurb}
      </div>
      <div className="mt-3 flex flex-col items-center gap-1">
        <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest">
          {isImpostor ? COPY_IMPOSTOR.revealHintLabel : COPY_IMPOSTOR.revealWordLabel}
        </div>
        <div className={`text-3xl font-bold ${isImpostor ? "text-[var(--error)]" : "text-[var(--accent)] glow"}`}>
          {isImpostor ? role.hint : role.secretWord}
        </div>
      </div>
      <button
        type="button"
        data-testid="impostor-role-reveal-dismiss"
        onClick={onDismiss}
        className="mt-3 text-xs border border-[var(--accent)] text-[var(--accent)] px-5 py-2 bg-[var(--accent)]/10 cursor-pointer hover:bg-[var(--accent)]/20 transition-colors"
      >
        {COPY_IMPOSTOR.revealGotItButton}
      </button>
    </div>
  );
}

/** Final result screen. Uses the public over-view's secretWord + impostorIds
 *  (I-5) so EVERY player — including the slime — sees the word revealed. */
function OverScreen({ view, role, meId }: { view: ImpostorPlayView; role: GameRole | null; meId: string }) {
  const slimeIds = view.impostorIds ?? [];
  const word = view.secretWord ?? role?.secretWord;
  const slimeNames = slimeIds.length > 0 ? slimeIds.join(", ") : null;
  const wasSlime = slimeIds.includes(meId);
  const outcome = view.outcome;
  const crewmatesWon = outcome === "crewmates-win";
  const slimeWon = outcome === "crewmates-lose" || outcome === "draw";
  const viewerWon = (wasSlime && slimeWon) || (!wasSlime && crewmatesWon);
  return (
    <div data-testid="impostor-outcome" className="flex flex-col gap-3 py-4 animate-[fadeIn_0.5s_ease] relative overflow-hidden">
      {/* Confetti burst — bigger and richer on a crewmate/impostor win. */}
      {Array.from({ length: viewerWon ? 20 : 12 }, (_, i) => (
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
      {viewerWon && (
        <div className="text-center text-xs text-[var(--accent)] uppercase tracking-widest animate-[fadeIn_0.6s_ease]">
          ✦ you win ✦
        </div>
      )}
      <div className="text-2xl font-bold text-[var(--accent)] glow text-center">
        {outcomeLabel(outcome)}
      </div>
      {word && (
        <div className="text-center text-sm text-[var(--text-muted)]">
          {COPY_IMPOSTOR.outcomeWordLabel}{" "}
          <span className="text-lg font-bold text-[var(--accent)] glow">{word}</span>
        </div>
      )}
      {role?.hint && wasSlime && (
        <div className="text-center text-sm text-[var(--text-muted)]">
          {COPY_IMPOSTOR.outcomeHintLabel}{" "}
          <span className="text-lg font-bold text-[var(--error)]">{role.hint}</span>
        </div>
      )}
      {slimeNames && (
        <div className="text-center text-xs text-[var(--text-muted)]">
          {COPY_IMPOSTOR.outcomeSlimeLabel} <span className="text-[var(--error)] font-semibold">{slimeNames}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Shared answers list (I-6): every player sees every answer at all times,
 * including while it's their own turn and on the choose screen. Past rounds
 * are grouped with clear per-round attribution; the current round streams in
 * live as each player submits. Answers are never gated behind your own input.
 */
function AnswersList({
  view,
  meId,
  highlightGiver,
}: {
  view: ImpostorPlayView;
  meId: string;
  highlightGiver?: string | null;
}) {
  const hasPast = view.hintsByRound && Object.keys(view.hintsByRound).length > 0;
  const hasCurrent = Object.keys(view.hints).length > 0;
  if (!hasPast && !hasCurrent) {
    return (
      <div className="text-xs text-[var(--text-muted)] italic">{COPY_IMPOSTOR.noAnswersYet}</div>
    );
  }
  return (
    <div data-testid="impostor-answers" className="flex flex-col gap-2">
      {view.hintsByRound &&
        Object.entries(view.hintsByRound)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([round, roundHints]) => (
            <RoundAnswers
              key={`past-${round}`}
              label={roundLabel(Number(round))}
              roundHints={roundHints}
              highlightGiver={highlightGiver}
              meId={meId}
            />
          ))}
      {hasCurrent && (
        <RoundAnswers
          label={roundLabel(view.round)}
          roundHints={view.hints}
          highlightGiver={highlightGiver}
          meId={meId}
          live
        />
      )}
    </div>
  );
}

function RoundAnswers({
  label,
  roundHints,
  highlightGiver,
  meId,
  live = false,
}: {
  label: string;
  roundHints: Record<string, string>;
  highlightGiver?: string | null;
  meId: string;
  live?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest border-t border-[var(--border-primary)] pt-1 mt-1">
        {label}
      </div>
      {Object.entries(roundHints).map(([giver, text]) => {
        const isMe = giver === meId;
        const isCurrent = giver === highlightGiver;
        return (
          <div
            key={giver}
            className={`text-sm flex items-center gap-2 border-l-2 pl-2 pr-2 py-1 ${live ? "animate-[fadeIn_0.3s_ease]" : ""} ${isMe ? "border-[var(--accent)]" : "border-[var(--border-primary)]"} ${isCurrent ? "bg-[var(--accent)]/5" : ""}`}
          >
            <span className={`text-[var(--text-muted)] shrink-0 ${isCurrent ? "text-[var(--accent)] glow" : ""}`}>
              {giver}:
            </span>
            <span className="text-[var(--text-primary)] font-medium">{text}</span>
            {isCurrent && <span className="text-[10px] text-[var(--accent)] ml-auto shrink-0">{COPY_IMPOSTOR.answerTag}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Turn-order progress: a dot per participant. Filled = has answered this
 *  round, pulsing = currently answering. Gives a quick "who's left" read. */
function TurnProgress({
  order,
  answered,
  turnPlayerId,
  meId,
}: {
  order: string[];
  answered: string[];
  turnPlayerId: string | null;
  meId: string;
}) {
  const answeredSet = new Set(answered);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {order.map((p) => {
        const done = answeredSet.has(p);
        const current = p === turnPlayerId;
        const mine = p === meId;
        return (
          <span
            key={p}
            title={p}
            className={`w-2 h-2 rounded-full transition-colors ${done ? "bg-[var(--accent)]" : current ? "bg-[var(--accent-light)] animate-pulse" : "bg-[var(--border-primary)]"} ${mine ? "ring-1 ring-[var(--accent)]" : ""}`}
          />
        );
      })}
    </div>
  );
}

/** I-1: running tally of continue vs force-a-vote choices, with a progress
 *  bar showing how many players have decided. */
function ChooseTally({
  choices,
  meId,
  myChoice,
  total,
}: {
  choices: Record<string, "continue" | "vote">;
  meId: string;
  myChoice: "continue" | "vote" | null;
  total: number;
}) {
  const entries = Object.entries(choices);
  const continueCount = entries.filter(([, c]) => c === "continue").length;
  const voteCount = entries.filter(([, c]) => c === "vote").length;
  const decided = entries.length;
  if (decided === 0 && myChoice === null) return null;
  const pct = total > 0 ? Math.round((decided / total) * 100) : 0;
  return (
    <div data-testid="impostor-choose-tally" className="flex flex-col gap-2 text-[11px] animate-[fadeIn_0.3s_ease]">
      <div className="flex items-center gap-3">
        <span className="text-[var(--accent)]">{tallyCount(COPY_IMPOSTOR.tallyContinueLabel, continueCount)}</span>
        <span className="text-[var(--error)]">{tallyCount(COPY_IMPOSTOR.tallyVoteLabel, voteCount)}</span>
        <span className="ml-auto text-[var(--text-muted)]">{decidedCount(decided, total)}</span>
      </div>
      {/* Progress bar */}
      <div className="h-1.5 bg-[var(--bg-tertiary)] border border-[var(--border-primary)] overflow-hidden">
        <div
          className="h-full bg-[var(--accent)] transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center gap-1 text-[var(--text-muted)] flex-wrap">
        {entries.map(([voter, c]) => (
          <span
            key={voter}
            className={`px-1.5 py-0.5 border ${c === "continue" ? "border-[var(--accent)]/40 text-[var(--accent)]" : "border-[var(--error)]/40 text-[var(--error)]"} ${voter === meId ? "font-bold" : ""}`}
          >
            {voter}
          </span>
        ))}
        {myChoice === null && <span className="italic">{COPY_IMPOSTOR.yourMove}</span>}
      </div>
    </div>
  );
}

function HintTimer({ deadline }: { deadline: number }) {
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  useEffect(() => {
    const tick = () => setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [deadline]);
  const urgent = seconds <= 5;
  return (
    <span className={`ml-auto text-[11px] font-bold px-1.5 py-0.5 border ${urgent ? "text-[var(--error)] border-[var(--error)]/50 animate-pulse" : "text-[var(--text-muted)] border-[var(--border-primary)]"}`}>
      ⏱ {seconds}s
    </span>
  );
}

function outcomeLabel(outcome: string | null): string {
  return outcomeHeadline(outcome);
}
