/**
 * MINIGAME COPY — every human-facing string for the Impostor and Complete
 * the Funny minigames lives here, in one file, so a human can rewrite them
 * without touching any component code. Components only import from this
 * file; no UI text should be hardcoded in the panels.
 *
 * Notes for editors:
 *  - Strings ending in "…" are intentional (in-progress states).
 *  - Bracketed labels like "[ close ]" match the app's terminal-style UI;
 *    keep the brackets when rewriting, or remove them everywhere at once.
 *  - Functions marked TEMPLATE interpolate player names / counts; keep the
 *    interpolation, change the surrounding words freely.
 *  - Pluralization is handled inside the TEMPLATE functions.
 */

/* ── Shared: overlay, invitation card, lobby ─────────────────────────── */

export const COPY = {
  statusGameOver: "Game Over",
  statusInProgress: "In Progress",
  statusLobby: "Lobby",

  participantsLabel: "participants",
  hostBadge: "host",
  closeButton: "[ close ]",
  closeTitle: "Close the game window",
  startButton: "[ start game ]",
  hostSettingsHeading: "host settings",
  waitingForHost: "waiting for the host to start…",
  gameInProgressMessage: "the game is in progress",

  /** Shown to the winner on any end screen. */
  youWinBanner: "✦ you win ✦",

  youSuffix: "(you)",
  pointsSuffix: "pts",
} as const;

/** TEMPLATE: heading above the participant list, e.g. "participants (4)". */
export function participantsHeading(count: number): string {
  return `${COPY.participantsLabel} (${count})`;
}

/** TEMPLATE: player count on the invitation card. */
export function invitationPlayerCount(count: number): string {
  return `${count} player${count === 1 ? "" : "s"}`;
}

export const COPY_INVITATION = {
  /** Suffix when the game already started. */
  inProgressSuffix: " : in progress",
  /** Suffix while the game is open. */
  joinSuffix: " : click to join",
} as const;

/* ── Impostor ────────────────────────────────────────────────────────── */

export const COPY_IMPOSTOR = {
  /** Small uppercase phase tag in the header. */
  phaseLabels: {
    hint: "answers",
    choose: "decide",
    vote: "vote",
    guess: "guess",
    over: "result",
  },

  /* Role reveal (start-of-game card) */
  revealYouAreSlime: "you are the slime!",
  revealYouAreCrewmate: "you are a crewmate",
  revealSlimeBlurb: "blend in. give answers like you know the word. don't get caught.",
  revealCrewmateBlurb: "find the slime among you. they don't know the word!",
  revealHintLabel: "your hint category",
  revealWordLabel: "the secret word is",
  revealGotItButton: "[ got it → ]",

  /* Hint (answering) phase */
  yourHintCategory: "your hint category:",
  theSecretWord: "the secret word:",
  yourTurnOneWord: "it's your turn — give a one-word answer.",
  answerPlaceholder: "give a one-word answer…",
  submitAnswerButton: "[ submit answer ]",
  answerTag: "▾ answering",
  noAnswersYet: "no answers yet — be the first!",

  /* Choose phase (continue vs vote) */
  choosePrompt: "the slime is among you. continue, or force a vote?",
  continueButton: "[ continue ]",
  forceVoteButton: "[ force a vote ]",
  tallyContinueLabel: "continue",
  tallyVoteLabel: "force a vote",
  yourMove: "— your move",

  /* Vote phase */
  votePrompt: "vote out the slime:",

  /* Guess phase (voted-out impostor only) */
  guessPrompt: "you were voted out. guess the real word!",
  guessHintLabel: "your hint category was:",
  guessPlaceholder: "what is your answer?",

  /* Over (result) screen */
  outcomeWordLabel: "the word was",
  outcomeHintLabel: "your hint was",
  outcomeSlimeLabel: "the slime was",

  /** Outcome headline per result kind; unknown outcomes fall back. */
  outcomeLabels: {
    "crewmates-win": "🛡️ the crewmates win",
    "crewmates-lose": "🟢 the slime decimated the crewmates",
    draw: "🟢 the slime guessed the word — draw",
    tie: "🤝 tie — no one was voted out",
  },
  outcomeFallback: "game over",
} as const;

/** TEMPLATE: whose turn it is, e.g. "waiting for Ada to give an answer…". */
export function waitingForAnswer(player: string): string {
  return `waiting for ${player} to give an answer…`;
}

/** Tail of the waiting line after the highlighted player name, so the UI can
 *  style the name separately: "Ada <tail>" → "to give an answer…". */
export function waitingForAnswerTail(player: string): string {
  return waitingForAnswer(player).slice(`waiting for ${player} `.length);
}

/** TEMPLATE: confirmation after casting a vote. */
export function youVotedFor(player: string): string {
  return `you voted for ${player} — waiting for others…`;
}

/** TEMPLATE: reveal of the decided vote on the vote screen, e.g. "voted out: Ada". */
export function votedOutLabel(player: string): string {
  return `voted out: ${player}`;
}

/** TEMPLATE: non-impostor waiting text during the guess phase. */
export function waitingForGuess(player: string): string {
  return `waiting for ${player} to guess the word…`;
}

/** TEMPLATE: choose-tally counts, e.g. "continue: 2" / "force a vote: 1". */
export function tallyCount(label: string, count: number): string {
  return `${label}: ${count}`;
}

/** TEMPLATE: decide progress, e.g. "1/3 decided". */
export function decidedCount(decided: number, total: number): string {
  return `${decided}/${total} decided`;
}

/** TEMPLATE: headline on the over screen for a known outcome. */
export function outcomeHeadline(outcome: string | null): string {
  if (outcome && outcome in COPY_IMPOSTOR.outcomeLabels) {
    return COPY_IMPOSTOR.outcomeLabels[outcome as keyof typeof COPY_IMPOSTOR.outcomeLabels];
  }
  return outcome ?? COPY_IMPOSTOR.outcomeFallback;
}

/* ── Complete the Funny ──────────────────────────────────────────────── */

export const COPY_CTF = {
  phaseAnswering: "answering",
  phaseVoting: "voting",
  answerPlaceholder: "type your funniest answer…",
  nextButton: "[ next → ]",
  submitAnswersButton: "[ submit answers ]",
  answersSubmitted: "answers submitted — waiting for others…",
  waitingForMatchups: "waiting for matchups…",
  matchupResolved: "matchup resolved",
  unanimousBanner: "⭐ UNANIMOUS! ⭐",
  finalScoresHeading: "final scores",
  voteWord: "vote",
  votesWord: "votes",
} as const;

/** TEMPLATE: matchup progress label, e.g. "matchup 2/5". */
export function matchupProgress(current: number, total: number): string {
  return `matchup ${current}/${total}`;
}

/** TEMPLATE: round indicator shown in both panels' headers, e.g. "round 2". */
export function roundLabel(round: number): string {
  return `round ${round}`;
}

/** TEMPLATE: vote-locked confirmation, e.g. "…waiting for the room (3 votes in)…". */
export function voteLockedIn(votesIn: number): string {
  const noun = votesIn === 1 ? COPY_CTF.voteWord : COPY_CTF.votesWord;
  return `vote locked in — waiting for the room (${votesIn} ${noun} in)…`;
}

/** TEMPLATE: vote count under an answer, e.g. "3 votes". */
export function voteCountLabel(count: number): string {
  const noun = count === 1 ? COPY_CTF.voteWord : COPY_CTF.votesWord;
  return `${count} ${noun}`;
}

/* ── Host settings labels (GameSettingsPanel) ────────────────────────── */

export const COPY_SETTINGS = {
  impostor: {
    impostorCount: { label: "number of slimes (impostors)", hint: "default 1" },
    maxRounds: { label: "max rounds", hint: "default 5" },
    hintTimeMs: { label: "seconds to give a hint", hint: "default 30 s" },
    wordViewMs: { label: "seconds to view your word", hint: "default 10 s" },
    guessTimeMs: { label: "seconds to guess after being voted out", hint: "default 30 s" },
  },
  "complete-the-funny": {
    promptsPerPlayer: { label: "prompts per player", hint: "default 4" },
    rounds: { label: "rounds", hint: "default 3" },
    answerTimeLimitMs: { label: "seconds to answer", hint: "default 60 s" },
    voteTimeMs: { label: "seconds to vote per matchup", hint: "default 30 s" },
  },
} as const;
