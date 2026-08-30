# Tchat Minigames — Requirements & Todos

> Status: **Server core + Phase 1 client shell + lobby settings + both in-play gameplay panels implemented (TDD)** — game lifecycle, both gameplay engines, WS protocol, resource cleanup, the client game button / invitation card / overlay-lobby / host settings panel, and the Impostor + Complete the Funny in-play phase panels are done and verified with unit + E2E tests.

---

## 1. Overview

- Users can **spontaneously create** minigames from inside any chat room — no scheduling, no admin setup.
- The creator sends the game to the room as an **invitation embedded in a chat message**.
- The invitation is **clickable by anyone in the room** to join.
- Creating or joining a game opens the **game window as an overlay** on the chat.

---

## 2. Game Button & Invitations

### 2.1 Game Button
- A new **game button** sits to the right of the message bar, right next to the existing **gif and upload** buttons.
- Clicking it opens a **dropdown listing all available games** (initially: *Impostor*, *Complete the Funny*).
- Clicking one game in the dropdown sends the **invitation message to everyone in the room**.
- The sender is automatically the **creator/host** and is joined to the game (lobby opens on send).

### 2.2 Invitation Message
- Renders as a **clickable game card** inside the chat message.
- Shows: game name, host, player count, and current status (Lobby / In Progress / Ended).
- Anyone in the room can click it to **join** the game (opens the overlay straight into the lobby; if the game is already in progress, only original participants can rejoin — see §3.1).

---

## 3. Game Window Overlay

- Upon **creating or joining** a game, the chat window is **overlaid by the game window**.
- Every game has a **close button** that closes the overlay and returns to chat.
- **Closing does not leave the game** — the player stays a participant and can **rejoin by clicking the invitation again**.
- **Multiple games can run concurrently in one room** (each with its own lobby and state), but only **one game overlay** is open at a time on the client, and a player can be a participant in only **one game at a time**.

### 3.1 Invitation & Presence Edge Cases (resolved)
- **Game already in progress** — players who were **participants when the game started** can **rejoin** by clicking the invitation; players who were **not** in the game at start **cannot join** (prevents the Impostor secret word leaking to late joiners).
- **Soft leave (close the game window)** — closing the window doesn't change any game logic; the player stays a participant but simply can't play until they click the invitation again, which reopens the window and lets them resume. A player can only be **in one game at a time**.
- **Ended game** — game data is **deleted when the game ends** (saves server resources). Clicking an invitation for an ended game shows that the game is over — no result summary, no re-opening the last screen.
- **Leaving the room / closing the tab** — the player is **removed from the game** (unlike closing the overlay, which is a soft leave).

---

## 4. Lobby

- Upon creating a game, **everyone goes to the lobby** — the creator and everyone who clicks the invitation.
- The lobby shows **all participants** and marks **who is the host**.
- In the lobby the **host can adjust game settings** (settings differ per game; see §6.1), then **press Start** to start the game for everyone in the lobby. Settings are chosen in seconds on the client but sent as `ms` to match the server payloads (`hintTimeMs`, `wordViewMs`, `guessTimeMs`, `answerTimeLimitMs`).
- Players joining after the game has started: see §3.1 — only original participants can rejoin; new players can't.

---

## 5. Game 1 — Impostor

### 5.1 Setup
- The host chooses (in the lobby) **how many impostors** — any number; **default 1**. Everyone else is a **crewmate**.
- All crewmates are shown the **same secret word**.
- Each impostor is shown **only a hint or category related to the word** (never the word itself or another word).
- The word/hint pool is **bundled with the app**: curated English word lists authored by us (see §9.7).

### 5.2 Rounds
- In one round, **everybody takes turns** (fixed order) submitting **one hint** each.
- **Timers (server-enforced):** each player has **30 seconds** to submit their hint, and at the start of their turn can view their word (crewmates) or hint (impostor) for **~10 seconds** before it hides.
- Hint constraints (enforced server-side):
  - **Max 100 characters**.
  - **Cannot contain the secret word** (rejected if it does).
- After all players have given their hint, everyone chooses **"continue"** or **"vote"**:
  - **Continue** → another round of hints repeats (word stays the same).
  - **Vote** → the game enters the **final voting phase**.

### 5.3 Final Voting Phase
- Each player casts a vote for **one person**.
- The player with the **most votes** is voted out.

### 5.4 Resolution
| Voted out is a... | Outcome | Display |
|---|---|---|
| **Crewmate** | Game over | "Crewmates lose" (impostors win) |
| **Impostor** (guesses the word **wrong**) | Game over | Crewmates win |
| **Impostor** (guesses the word **correctly**) | Game over | **Draw** |
| **Tie** in the final vote | Game over | **Tie screen** (neither side wins) |

- Only a **voted-out impostor** gets a **chance to guess the word**; crewmates never guess (they already know the word).
- A guess counts as **correct if it contains the secret word**, case-insensitively — e.g. word "bird": "hummingbird" ✓, "Bird" ✓, "bicycle" ✗.
- The voted-out impostor has a **server-enforced 30 s window to guess**. If they don't guess in time (e.g. they disconnected), the game resolves as **crewmates-win** instead of hanging in the guess phase.

### 5.5 Client panel (implemented)
- `ImpostorGamePanel` renders inside the game overlay once a game is in progress, driven by the public `gamePlay` view + the viewer's private `gameRole`.
- **Hint phase** — only the current turn taker sees their secret word (from their private role) and can submit a hint (`gameHint`); everyone else sees prior hints and a "waiting" state. The word never renders for non-turn players.
- **Choose phase** — buttons send `gameChoose` with `continue` or `vote`.
- **Vote phase** — buttons for each votable participant (excluding the viewer) send `gameVote`; a decided `votedOutId` is shown instead.
- **Guess phase** — only the voted-out impostor sees a guess input (`gameGuess`); others wait.
- **Over phase** — shows the outcome label.
- Covered by deterministic jsdom component tests (8 tests).

---

## 6. Game 2 — Complete the Funny

### 6.1 Settings (host-adjustable in the lobby)
| Setting | Range | Default |
|---|---|---|
| **Prompts per player** (P) | 2–10 | 4 |
| **Number of rounds** | adjustable | TBD |
| **Answer time limit** per round | adjustable | TBD |

> Note: the base description says players get a series of **3 to 5** prompts per round; the settings range is **2–10 with default 4**. Both stated in the spec — treat 3–5 as the product description and 2–10/default 4 as the setting.

### 6.2 Rounds — Answering Phase
- Each round, every player is given a series of prompts (P prompts each) and a **time limit** to enter all their answers.
- Players fill in one answer per prompt.
- **Answers are capped at 400 characters** (enforced server-side).
- If the timer runs out (or the player submits nothing), the answer defaults to **"I RAN OUT OF TIME"**.
- Example prompts: *"Weirdest hill to die on"*, *"Bad excuse for late homework"*.
- The prompt pool is **bundled with the app**: curated English prompts authored by us (see §9.7).

### 6.3 Voting Phase
- After all answers are submitted, the game enters the voting phase.
- **Up to 4 answers (A) for a prompt are shown** to all players.
- Each player (except the ones who wrote the displayed answers) can vote for one answer in that matchup.
- **Each voting phase has a unique prompt**; there may be **more voting phases than prompts given to each player** (every answer becomes part of a matchup), and in some cases **not all players receive the same prompts**.

### 6.4 Scoring
- **1000-point pool per voting phase**: the answers get points **proportional to how many votes they got** (e.g. half the votes → 500).
- **Unanimous bonus**: if one answer gets **all** the votes, that author gets **+500 additional points**.
- **Round multipliers**: each round's pool is **1000 + 200 × (round − 1)** — every round after the first adds **+20% of the base 1000-point pool (flat 200 points)**, stacking per round: round 1 → 1000, round 2 → 1200, round 3 → 1400, round 4 → 1600.
- A final **leaderboard** shows total points per player.

### 6.5 The Math That Makes It Work
- N players × P prompts each = **N × P answers** total.
- Answers are grouped into voting matchups of **A** answers (A ≤ 4, from the same prompt).
- If **N × P is not evenly divisible by A**, the system **dynamically adjusts A for 1 or 2 phases** (e.g. showing 3 answers instead of 4), **or** assigns **varying prompts per player** so the pool still partitions cleanly into whole matchups.
- The point of the balancing: every phase has a unique prompt, every answer appears once, and the number of phases stays a whole number.

```
phases = N × P / A      (integer; pad with adjusted A or varied prompts)
```

### 6.6 Edge Cases
- Player submits answers for only some prompts before timeout (default applies per missing answer).
- **Tie in a matchup's vote (resolved)** — no tiebreaker needed: the pool is split pro-rata, so a tied answer simply takes its proportional share (two answers tied at 2 votes each on a 4-vote phase → 500 each).
- A matchup where one answer is "I RAN OUT OF TIME" — still eligible to be voted on (spec doesn't exclude it).

### 6.7 Client panel (implemented)
- `CtfGamePanel` renders inside the game overlay once the game is in progress, driven by the public `gamePlay` view.
- **Answering phase** — shows only the viewer's prompts (by `meId`), one input each; submit wire `answers` in prompt order via `gameAnswer`.
- **Voting phase** — renders every matchup (prompt + its answers); each answer button sends `gameVote` with the phase index and answer id. A player's own answer is disabled (the server also rejects self-votes).
- **Over phase** — shows the leaderboard sorted by score descending.
- Covered by deterministic jsdom component tests (4 tests).

### 6.8 Lobby settings panel (implemented)
- `GameSettingsPanel` appears in the lobby for the **host only**, listing the settings relevant to the chosen game (Impostor: impostor count + the three timers; Complete the Funny: prompts per player, rounds, answer time).
- ms-based timers are edited in **seconds** for readability but stored/sent as ms (matching the server). A setting not touched by the host is omitted, so the server's defaults apply.
- Host **Start** sends `gameStart` with `settings`; non-hosts still just see the "waiting for host" state.
- Covered by deterministic jsdom component tests (4 tests).

---

## 7. Technical Constraints

- **Server-authoritative** for: role/word assignment, timers, hint/answer validation (100/400 char caps, word-containment check), scoring, and the divisibility adjustment. Clients only render state.
- Word/hint and prompt pools are **bundled with the app** (curated English lists, no server-side generation).
- Invitations are a **special message type** (structured payload, not free text) rendered as a clickable card.
- Real-time state flows over the existing WebSocket; per-game state lives server-side alongside room state.
- Closing the overlay is a **client-only action** (soft leave); the server keeps the player in the game.
- **Leaving the room or closing the tab** removes the player from the game (server-side).
- **Game data is deleted when a game ends**; ended-game invitations render a "game over" state, not results.
- Deterministic scoring logic — unit-testable without the UI.
- **Deleting a room ends every game hosted in it** (registry entry, in-play session, and timers) so no game outlives its room; the empty-room janitor does the same for rooms it reaps.
- **Closing the tab / dropping the socket is a hard leave enforced server-side** on disconnect (not just a UI convention): the player is removed from the game and their one-game slot is freed immediately.
- In-play sessions and turn timers are cleared when a game ends or its room is deleted — no stale timers keep firing after the game is gone.
- The impostor's **guess phase has a 30 s server-enforced deadline** (like the hint timer) so a disconnected impostor can't leave the game hanging in memory; on timeout it resolves as crewmates-win.
- **Anonymous rooms:** every broadcast game frame (`gameState`, `gamePlay`) identifies players by their stable `Guest_XXXX` anon names (the same ones messages use) — real user ids never leave the server in an anonymous room. Each player's private `gameRole` frame tells them their own anon name so they can find themselves in the anonymized participant lists.

---

## 8. Todos

### Phase 0 — Data model & protocol (server done)
- [x] Server game registry: game types (Impostor, Complete the Funny) with display metadata — `src/server/gameTypes.ts`.
- [ ] Message type for game invitation (gameId, game type, host, status) + invitation card renderer.
- [x] Server game state machine: **Lobby → Playing → Ended**; participants, host, per-game settings; **delete game data on Ended** — `src/server/games.ts` (+ `groupChatId` room scope, one-game-at-a-time, soft vs. hard leave).
- [x] WS messages: create/join/rejoin/soft-leave/hard-leave/start/end/hint/choose/vote/guess/answer + `gameState`/`gameRole`/`gamePlay`/`gameEnded` snapshots — `src/server/realtime.ts`.
- [x] Server timers + the "I RAN OUT OF TIME" default injection — `impostorSession.ts` / `completeTheFunny.ts` (timeout overrides for tests).

### Phase 0.5 — Gameplay engines & resource cleanup (server done, TDD)
- [x] Impostor engine: turn order, hint validation (100-char cap, no secret word), 30 s/10 s deadlines, continue/vote, final vote, guess, resolution — `src/server/impostorSession.ts`.
- [x] Complete the Funny engine: settings validation, prompt dealing, answer timeouts, matchups (`planMatchups` whole-number phases), pro-rata + unanimous + round-multiplier scoring, leaderboard — `src/server/completeTheFunny.ts`.
- [x] Bundled word/prompt pools — `src/server/gamePools.ts`.
- [x] Resource cleanup: `endGamesInRoom` on room deletion + janitor reaps; timers/sessions cleared on end; **socket close = hard leave** (frees the one-game slot).
- [ ] Client invitation card + overlay/lobby screens (Phase 1).

### Phase1 — Client shell
- [x] Game button next to gif/upload buttons; dropdown of available games — `MessageComposer` `🎮` (`game-button`/`game-dropdown`).
- [x] Invitation card in message list; click-to-join — `GameInvitationCard`, rendered in `ChatWindow` from live `gameState` broadcasts.
- [x] Overlay manager: open/close game window, close button, rejoin via invitation, one-overlay-at-a-time — `GameOverlay`, hosted in `ChatWindow`; soft-leave close; `gameStart` flips status to In Progress via the `gamePlay` broadcast; `gameEnded` removes the card + closes the overlay. **Invitations are rendered from the server's `gameState` broadcast** (a live card in the thread), not a stored message column — no server message-schema change needed.
- [x] Lobby screen: participant list, host badge, Start button (host-only) — `GameOverlay`. Settings panel remains.
- [x] Phase 1 E2E (`tests/games.spec.ts`): game button → dropdown → create; invitation card seen by both; click-to-join lobby; host Starts → In Progress; close → chat; click again → rejoin.

### Phase2 — Impostor
- [ ] Role assignment (host-configurable impostor count, default 1) + secret word / impostor hint generation (bundled English word pool).
- [ ] Turn-based hint UI: 30 s answer timer, ~10 s hint view, 100-char limit, server-side "cannot contain the word" rejection.
- [ ] Continue / Vote choice after each round; vote UI; vote tie → tie screen.
- [ ] Voted-out resolution: crewmate → crewmates lose; impostor → guess screen → win/draw/lose results.

### Phase3 — Complete the Funny
- [ ] Settings wiring: P (2–10, default 4), rounds, time limit; host controls.
- [ ] Prompt assignment + **divisibility adjustment**: dynamic A (e.g. 3 instead of 4 for 1–2 phases) or varied prompts per player so N×P/A is integral.
- [ ] Answer entry UI with countdown; 400-char cap; timeout default "I RAN OUT OF TIME".
- [ ] Voting phases: unique prompts, up to 4 answers per matchup, authors excluded from voting on their own answers.
- [ ] Scoring engine: 1000-point pro-rata pool, +500 unanimous bonus, per-round pool = 1000 + 200 × (round − 1); leaderboard.

### Phase4 — Verification (E2E Playwright + Vitest unit)
- [ ] **Unit (Vitest):** divisibility adjustment yields whole-number phases for all N × P (N players, P 2–10) with A ∈ {2,3,4}; pro-rata scoring incl. ties; unanimous +500; per-round pools (1000 / 1200 / 1400…).
- [ ] **E2E:** host opens game button dropdown → invitation appears in the chat for everyone.
- [~] **E2E:** second user clicks invitation → both in lobby; host badge; Start disabled for non-hosts — covered by `tests/games.spec.ts` (both in lobby + host sees Start); *settings panel* still to build.
- [x] **E2E:** start → overlay opens; close → back to chat; clicking invitation again → rejoin overlay — `tests/games.spec.ts`.
- [ ] **E2E Impostor:** crewmates see the word, impostor sees hint only; 30 s turn timer; ~10 s hint view; >100-char hint rejected; hint containing the word rejected; continue loop vs vote; vote-out crewmate → "Crewmates lose"; vote-out impostor → correct guess (incl. word-as-substring, e.g. "hummingbird" for "bird") = draw, wrong = crewmates win; vote tie → tie screen.
- [ ] **E2E Complete the Funny:** timeout → "I RAN OUT OF TIME"; >400-char answer blocked; authors can't vote on own answers; unique prompts per phase; unanimous +500 applied; round 2 → +20%, round 3 → +40%.
- [ ] **E2E edge cases:** rejoin in-progress game as original participant (no word leak); new player blocked from joining in-progress game; ended-game invitation click → "game over" (data deleted); player leaves room / closes tab mid-game → removed from game.

---

## 9. Resolved Decisions (user-confirmed)

1. **Impostor vote ties** → the game ends on a **tie screen**; no impostor loss or victory.
2. **Impostor count** → host-adjustable, any number; **default 1**.
3. **Impostor timers** → **30 s** to type each hint; each player can view their word/hint for **~10 s**.
4. **Concurrency & rejoining** → multiple games can run in one room; a player can rejoin a game they were in when it started, but **cannot join** an in-progress game they weren't in at start.
5. **Draw semantics** → a guess is correct if it **contains the word** (case-insensitive): "hummingbird" ✓ for "bird".
6. **Round multiplier** → pool = **1000 + 200 × (round − 1)**: round 1 → 1000, round 2 → 1200, round 3 → 1400, round 4 → 1600.
7. **Word/prompt sources** → curated lists **bundled with the app**, all in **English**.
8. **Crewmate guessing** → **only the impostor** can guess the word; crewmates never guess.
9. **Soft leave** → closing the game window keeps the player in the game (no logic change); clicking the invitation again resumes play. A player can be a participant in **only one game at a time**.
10. **Ended games** → game data is **deleted when the game ends** (saves server resources); no result screen.
11. **Leaving room / closing tab** → the player is **removed from the game** (a hard leave, unlike closing the overlay).
12. **Room deletion** → deleting a room ends **every game hosted in it** (registry + session + timers), so games never outlive their room; the empty-room janitor does the same for reaped rooms.
13. **Socket close = hard leave (enforced)** → the server removes the player from their game on disconnect and frees their one-game slot — not just a UI convention.
14. **CtF matchup ties** → no tiebreaker: the pool is split pro-rata, so tied answers split their proportional share evenly.
15. **Guess deadline** → the voted-out impostor has a server-enforced **30 s window to guess** (spec doesn't pin it; matches the hint timer); no guess on timeout → **crewmates-win**. Prevents a disconnected impostor from hanging the game.
16. **Anonymous rooms** → game broadcasts use `Guest_XXXX` anon names (never real user ids), mirroring message anonymization; `gameRole` carries each player's own anon name so they can self-identify.