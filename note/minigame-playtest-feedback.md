# Minigames — Playtest Feedback (Bugs & Todos)

> Source: playtest feedback rounds on the new minigames feature. Status: open.
> Implemented items are kept as checked summary lines in the checklist at the
> bottom; unchecked items below are still missing or broken.

---

## 1. Impostor

### Bug I-1 — Continue-vs-force-a-vote ignores the majority
- The round-end choice ("continue" vs "force a vote") triggers a forced vote if **any** player picks "force a vote".
- Playtest example: **2 players choose continue, 1 chooses force a vote — the game still forces the vote**, which makes no sense given the 2-to-1 majority for continuing.
- **Requirement:** majority decides. A vote is forced only when *more* players choose "force a vote" than "continue"; otherwise the round continues (ties continue by default).
- Still open from the earlier round: show the **running tally of both options** (your own choice is already highlighted, but the others' tallies are not shown anywhere).

### Bug I-5 — Guess flow + persistent end screen not implemented yet
- When the slime (voted-out impostor) is prompted to guess the word and presses **"make the guess"**, **nothing happens**.
- Root cause observed: the final **"over" play view is never broadcast** — the server goes straight from the last phase to `gameEnded`, so every client stays stuck on the previous phase screen (for the slime, the guess screen just sits there).
- **Requirement:**
  - Wire the slime's guess through end to end (correct guess → draw, wrong guess → crewmates win) and broadcast the result.
  - **Persistent result screen:** the server ends the game, but clients keep a result window (outcome, who the slime was, the secret word) until each player closes it.

### Bug I-6 — Everyone must see all answers at all times, with round attribution
- Answers are currently shown **only to players who are NOT answering** — the player whose turn it is to input an answer **cannot see what everyone else has put** (the earlier live-streaming fix only reached the waiting-player view).
- **During the continue/force-a-vote screen, answers cannot be seen at all.**
- **Requirement:**
  - Every player sees **every answer from every player at ALL times**, including while it is their own turn to answer.
  - Each answer shows **which round it belongs to** (clear per-round separation).
  - The choose (continue / force a vote) screen also shows the round's answers.
  - Answers still stream in live as each player submits — no gating on your own input.

### Bug I-4 — Terminology: players submit an "answer", not a "hint"/"clue"
- The slime's private hint/category **is** dealt only to the slime (that part is done).
- Remaining: UI copy still says clue/guess language — "give a one-word clue…" → "give a one-word answer…", "[ submit clue ]" → "[ submit answer ]", "[ make the guess ]" → "[ submit answer ]".

### Requirement I-8 — Impostor UI framing overhaul
- The UI needs a **major overhaul on framing** to be more user-friendly and game-like.

---

## 2. Complete the Funny

### Bug CTF-2 — Voting must be synchronized: everyone votes on the same screen at the same time
- Currently each player clicks through the matchups **one by one at their own pace**, which is completely wrong — players end up on different prompts at different times.
- **Requirement — one shared, server-driven voting screen:**
  - Everybody is shown the **same prompt** and the **same answers at the same time**.
  - Everybody can see, live, **how many votes each answer has received** — rendered as **dots** on the answer block (**one dot = one player** who voted; tallies must re-broadcast on every vote, not just on phase changes).
  - The round advances when **everyone has voted OR the voting time limit runs out** — there is currently **no voting timeout at all**; add a server-enforced per-prompt voting deadline with a visible countdown.

### Requirement CTF-5 — Answer UI: large game-like rectangles with live dot tallies
- The answer rows should be reworked into a **game-like layout**: **large rectangles filling the center portion of the chat window** instead of rows.
- Each answer block, top to bottom:
  - the **player who wrote it** — small text at the top,
  - the **answer content** — the largest / most important text, in the middle,
  - the **vote dots** — at the bottom, one dot per player who voted, updating live.
- Supersedes the old "highlight your own selection + show the tally as a number" requirement.

### Requirement CTF-7 — Points-reveal animation after each voting group
- After a group finishes voting (everyone voted or time ran out), show **how many points each player won**:
  - when **more than one answer wins points**: animated text **pops up above each winning answer** and **counts up from +0 to +{points}**;
  - when **only one answer wins (unanimous)**: show **special animated text** for the unanimous win while playing an animation where **one answer knocks the other off the screen**.

### Bug CTF-9 — Matchups group the same player's answers to different prompts
- Playtest bug (3 players): a voting prompt showed **four answers all written by the same player** — his answers to four *different* prompts — which makes no sense.
- **Requirement:** matchups are built **per prompt**: the answers shown for a prompt are **one answer from each unique player who answered that prompt**. Different prompts must never be mixed into one matchup.

### Bug CTF-4 — Points aren't visible during play
- Still open: no always-visible display of your own points while answering/voting.
- The interim ranked scoreboard after each voting round is **replaced** by the per-group points-reveal animation (CTF-7).
- The final ranked scoreboard is implemented in the panel but never shows (blocked by CTF-6).

### Bug CTF-6 — Final scoreboard never shows (same root cause as I-5)
- The final **"over" play view is never broadcast** — the game jumps straight to `gameEnded`, so the ranked scoreboard panel never renders.
- **Requirement:** broadcast the final "over" view (ranked leaderboard), then end the game; clients keep the scoreboard until each player closes it.

---

## 3. Checklist

- [x] **G-1** Lobby shows real names, not user IDs.
- [x] **I-1** Continue-vs-force-a-vote respects the majority (2 continue + 1 force → continue); show the running tally of both options.
- [x] **I-2** Max rounds: default 5, settings 1–100, server-enforced.
- [x] **I-3** Immediate role reveal at game start (slime / crewmate + word or hint).
- [x] **I-4** Wording: players submit an "answer" (buttons/placeholders still say clue / make-the-guess). Hint privacy for the slime is done.
- [x] **I-5** Guess flow + persistent end screen ("make the guess" does nothing; the final "over" view is never shown).
- [x] **I-6** All answers should be visible to everyone at all times, with per-round attribution, including the choose (continue/force-a-vote) screen.
- [x] **I-7** Past answers persist across rounds with clear round separation.
- [x] **I-8** Impostor UI framing overhaul — more user-friendly and game-like. Make use of the whole window, not just the top. Fix overlaps.
- [x] **CTF-1** Answering: one prompt at a time with a visible global countdown.
- [x] **CTF-2** Synchronized voting: everyone sees the same prompt + answers at the same time, live dot tallies, advance on all-voted **or** timeout (no voting deadline exists yet).
- [x] **CTF-3** Smooth transitions between prompts and phases.
- [x] **CTF-4** Always-visible own points during play (+ final scoreboard handled by CTF-6).
- [x] **CTF-5** Answer cards: player above (small), answer in the middle (large), live vote dots below — four large rectangles centered in the chat window.
- [x] **CTF-6** Persistent final ranked scoreboard on game end (over view never broadcast).
- [x] **CTF-7** Points-reveal animation after each voting group: +0 → +{points} count-up above winning answers; If unanimous, unanimous win text + knock-one-off-the-screen animation.
- [x] **CTF-9** Matchups are built per prompt — each answer for a prompt is from a unique player.
- [x] **Polish** confetti, slide/fade, glow/pulse, score count-up.
- [x] **Game UI** Make sure UI is user friendly and makes the game fun.