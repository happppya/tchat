# Minigames — Implementation Plans for Remaining Todos

> Each plan is self-contained: an agent can pick up one item and execute it
> without prior context. Items are ordered by dependency (G-1 first since
> several others touch the same identity-resolution code).

**Conventions:**
- Test framework: Vitest (unit/integration), Playwright (E2E in `tests/`).
- All tests use the existing `scrollIntoView` guard and `cleanup()` pattern.
- CSS: Tailwind arbitrary values + global keyframes in `src/index.css`.
- Server state machines are pure (in `src/server/games/`); realtime.ts is the
  I/O layer that drives them.
- Types live in `src/types/games.ts`.
- Client hook: `src/pages/useMinigames.ts` owns game-frame handling.
- The `broadcastGameView` helper resolves anon names via `playerIdentityMap`.

---

## G-1 — Lobby shows actual names instead of user IDs

**Problem:** The lobby renders `participantIds` directly. In non-anonymous
rooms these are raw user IDs like `"1"`, `"2"`. In anonymous rooms the server
already maps them to `Guest_XXXX` names, but non-anonymous rooms still show
bare numbers.

**Root cause:** `gameStatePayload()` in `src/server/realtime.ts` (line ~680)
calls `mapId(map, id)` for each participant. `playerIdentityMap` returns
`null` for non-anonymous rooms (it only maps when `roomIsAnonymous` is true),
so `mapId` passes the raw id through unchanged.

**Implementation:**

1. **Server** — `src/server/realtime.ts`:
   - Change `playerIdentityMap()` to always return a map. For non-anonymous
     rooms, resolve each participant id to their `username` via a bulk DB
     query: `SELECT id, username FROM users WHERE id IN (...)`.
   - For anonymous rooms, keep the existing `getAnonName` logic.
   - This means `mapId(map, id)` now always returns a display name.
   - Update the return type from `Map<string, string> | null` to just
     `Map<string, string>` and remove all the null-handling at call sites.
   - **Files:** `realtime.ts` (the `playerIdentityMap` function, and all
     callers of `broadcastGameView`/`mapId`).

2. **Client** — No changes needed. `GameOverlay.tsx` already renders
   `participantIds` as text. Once the server sends names, they appear
   automatically. `useMinigames.ts` already stores `participantIds` from the
   `gameState` frame as-is.

3. **Tests:**
   - `realtime.test.ts`: The existing tests assert `participantIds` contain
     `"1"`, `"2"` etc. Update them to expect the usernames (`"alice"`,
     `"bob"`, `"carol"`). The test setup already creates users with those
     names — check the test DB seeding.
   - The anonymous-room test already expects `Guest_` names — keep it.
   - Add a unit test: "lobby gameState shows usernames in non-anonymous rooms"
     — create a game, join, assert the broadcast `participantIds` contains
     `"alice"` not `"1"`.

**TDD steps:**
1. Write a failing realtime test: `participantIds` should contain `"alice"`
   after game creation in a non-anonymous room. It will fail because the
   current code sends `"1"`.
2. Implement the `playerIdentityMap` change.
3. Fix all existing tests that assert raw user IDs in `participantIds`.
4. Verify green.

**Scope:** ~30 lines server, ~20 test updates. No client changes.

---

## I-4 — Terminology: "answer" not "hint"; slime's category is actually shown

**Problem:** The UI calls the player's submitted clue a "hint", but per the
spec it should be called an "answer". The "hint" is the category/hint phrase
shown privately to the impostor to guide them. The impostor's hint IS already
dealt (`role.hint` in `GameRole`), but the UI labels are wrong.

**Current state:**
- Server: `submitHint()`, `checkHint()`, the `gameHint` frame type, and
  `session.hints` all use "hint" internally. This is fine — it's internal
  naming. The server-side `IMPOSTOR_WORD_POOL` entries have a `hint` field
  (e.g. `{ word: "bird", hint: "flies" }`).
- Client: `ImpostorGamePanel.tsx` shows `"your hint category is"` for the
  impostor (correct), but the input placeholder says `"give a one-word clue…"`
  and the submit button says `"[ submit clue ]"`. The word "clue" is
  acceptable but the feedback note says it should be "answer".

**Decision needed:** The feedback says the player submits an "answer" (their
attempt to demonstrate they know the word). But looking at the game flow,
players take turns giving one-word clues, then vote, then the voted-out
impostor guesses the word. The "answer" terminology in the feedback likely
refers to the impostor's final guess. **Agent should read the feedback note
carefully** — I-4 says "What players submit when they think they know the
word should be called an 'answer'". This is the guess phase, not the clue
phase.

**Implementation (client-only, no server changes):**

1. **`src/components/games/ImpostorGamePanel.tsx`:**
   - Hint phase (turn player): change placeholder from `"give a one-word clue…"`
     to `"give a one-word answer…"` and button from `"[ submit clue ]"` to
     `"[ submit answer ]"`.
   - Guess phase (voted-out impostor): change placeholder from
     `"what is the secret word?"` to `"what is your answer?"` and button from
     `"[ make the guess ]"` to `"[ submit answer ]"`.
   - The impostor's private hint category label `"your hint category is"` is
     already correct — leave it.

2. **Tests:**
   - `ImpostorGamePanel.test.tsx`: Update any test that asserts `"submit clue"`
     or `"make the guess"` text. Use `data-testid` assertions instead of text
     where possible (the testids `impostor-hint-submit` and
     `impostor-guess-submit` don't change).
   - E2E `tests/games.spec.ts`: Update if it clicks by text label; it should
     use testids already.

**TDD steps:**
1. Update the component test to assert the new button text `"submit answer"`.
   It will fail.
2. Change the labels.
3. Verify green.

**Scope:** ~6 line changes in the component, ~4 test assertion updates.

---

## I-5 — Persistent game-end screen (Impostor)

**Problem:** When the game ends, the server sends `gameEnded` and the client
immediately closes the overlay and removes the play view. The player never
sees the outcome.

**Current flow:**
- Server `finishGame()` → broadcasts `{ type: "gameEnded", gameId, outcome }`
  → deletes game data, session, timer.
- Client `useMinigames.ts` `handleGameFrame` for `gameEnded`: removes the
  game from `gamesByRoom`, sets `activeGame` to null (closes overlay), drops
  `playViews` and `roles`.

**But:** The server already broadcasts the `over` phase in the `gamePlay`
view before calling `finishGame`. For Impostor, when `submitGuess()` or
`castVote()` resolves the game, the session enters `phase: { kind: "over",
outcome }`. The server then calls `finishGame()` which broadcasts
`gameEnded`. The client sees the `over` play view briefly, then `gameEnded`
wipes it.

**Implementation:**

1. **Client** — `src/pages/useMinigames.ts`:
   - On `gameEnded`, do NOT immediately close the overlay or drop the play
     view. Instead, mark the game as "ended" in a new `endedGames` state:
     `Record<string, { outcome?: string; gameType: string }>`.
   - The overlay stays open showing the `over` phase play view (which already
     has `outcome`).
   - Add a `dismissEndedGame(gameId)` callback that clears the ended-game
     entry, drops the play view/role, and closes the overlay.
   - `handleCloseGame` should also clear the ended-game state if the open
     game is ended.

2. **Client** — `src/components/games/GameOverlay.tsx`:
   - Accept an `isEnded` prop and an `onDismissEnded` callback.
   - When `isEnded`, show a "game over" banner with a `[ close ]` button that
     calls `onDismissEnded`. The in-play panel still renders the `over` phase
     content beneath it (the ImpostorGamePanel already has an `over` phase
     branch showing the outcome label).

3. **Client** — `src/components/games/ImpostorGamePanel.tsx`:
   - The `over` phase already shows `outcomeLabel(view.outcome)`. Enhance it
     to show who was the impostor and what the word was. The `role` prop
     already carries `secretWord`/`hint`. Add a reveal section: "the word was
     X" and "the slime was Y" — but Y isn't available in the public play view.
     The server would need to include `impostorIds` and `secretWord` in the
     final `gameEnded` or `gamePlay` over frame. **Simplest approach:** Add
     `impostorIds: string[]` and `secretWord: string` to the Impostor over
     phase play view broadcast.

4. **Server** — `src/server/realtime.ts`:
   - In `impostorPlayView()`, when `session.phase.kind === "over"`, include
     `impostorIds` (the list of players who were impostors) and `secretWord`
     in the broadcast. This is safe because the game is over.
   - Type: add `impostorIds?: string[]` and `secretWord?: string` to
     `ImpostorPlayView`.

5. **Client types** — `src/types/games.ts`:
   - Add `impostorIds?: string[]` and `secretWord?: string` to
     `ImpostorPlayView`.

6. **Tests:**
   - `realtime.test.ts`: Add test "the over play view reveals the impostor
     and secret word" — start a game, play to resolution, assert the final
     `gamePlay` frame includes `impostorIds` and `secretWord`.
   - `ImpostorGamePanel.test.tsx`: Add test "over phase shows the word and who
     the slime was" — render with `phase: "over"`, `outcome: "crewmates-win"`,
     `impostorIds: ["2"]`, `secretWord: "pizza"`, assert both are visible.
   - `useMinigames` tests (if they exist): Test that `gameEnded` keeps the
     overlay open until `dismissEndedGame` is called.

**TDD steps:**
1. Write the server test asserting `impostorIds` + `secretWord` in the over
   frame. Watch it fail.
2. Add the fields to the broadcast + type.
3. Write the component test asserting the word/impostor are shown. Watch it
   fail.
4. Add the reveal UI to the `over` phase.
5. Write a test that `gameEnded` does NOT close the overlay. Watch it fail.
6. Change `useMinigames` to keep the overlay open.
7. Verify all green.

**Scope:** ~40 lines server, ~15 lines types, ~30 lines useMinigames, ~40
lines GameOverlay + ImpostorGamePanel, ~60 lines tests.

---

## I-6 — Live answer streaming (Impostor)

**Problem:** Other players' clues/answers are hidden until you submit your
own. Players should see everyone's answers live as they come in.

**Current state:** In the Impostor hint phase, each player takes a turn
giving a one-word clue. The server stores `session.hints[playerId] = hint`
and broadcasts it in `impostorPlayView` via the `hints` map. So hints ARE
broadcast live — every `submitHint` triggers a `broadcastGameView`. The
issue is likely that the client doesn't show hints from other players in
real-time, OR the feedback refers to a different aspect.

**Re-reading the feedback:** "Players should be able to see what answers
everybody else has inputted LIVE immediately after their input. Instead, they
are incorrectly hidden until the player enters their own answer." This sounds
like it's about the Complete the Funny answering phase, not Impostor. But
it's listed under Impostor (I-6). **Agent should verify:** does the
ImpostorGamePanel show the hints list to non-turn players? Looking at the
code, yes — the `hint` phase shows `{Object.entries(view.hints).map(...)}`
for the waiting player. So this may already work for Impostor.

**If this is about Complete the Funny:** During the answering phase, each
player's `answered` count is broadcast (how many prompts they've filled), but
the actual answer text is NOT broadcast (it's hidden until voting). The
feedback wants answer text visible live. **This is a design decision** —
showing answers live during the answering phase would spoil voting. The
agent should clarify with the user whether I-6 applies to CtF (where it would
spoil the game) or if the current Impostor behavior already satisfies it.

**If I-6 is Impostor-only and already works:** Mark it as done with a comment.
The hint phase already broadcasts each hint immediately, and the waiting
player's view renders them live.

**If I-6 means "show a live feed of who has answered how many prompts" in
CtF:** The `answered` field in `ctfPlayView` already broadcasts per-player
answer counts. The CtfGamePanel answering flow could show a list like
"alice: 2/4, bob: 3/4, carol: 4/4 ✓". This is a small UI addition.

**Implementation (if needed):**

1. **`src/components/games/CtfGamePanel.tsx`** — In the `AnsweringFlow`:
   - Below the prompt/input, render a small live status list from
     `view.answered` (a `Record<string, number>`). For each player, show
     `"name: N/P ✓"` where P = `myPrompts.length` and ✓ when N === P.
   - This gives players a sense of progress without revealing answer text.

2. **Tests:**
   - `CtfGamePanel.test.tsx`: Add test "shows live answer progress for other
     players" — render with `answered: { "2": 3, "3": 4 }` and 4 prompts,
     assert `"3/4"` and `"4/4 ✓"` are visible.

**TDD steps:**
1. Write the test. Watch it fail.
2. Add the status list UI.
3. Verify green.

**Scope:** ~15 lines component, ~15 lines test. **Agent should first verify
whether this is already satisfied for Impostor.**

---

## I-7 — Persist past answers across rounds with round separation

**Problem:** In Impostor, when a new round starts, `session.hints = {}`
clears all previous hints. Players can't see what clues were given in
earlier rounds. The UI should show a clear per-round answer log.

**Current state:**
- Server: `choose()` in `impostorSession.ts` line ~150: when everyone
  continues and the round cap isn't reached, `session.hints = {}` clears the
  hints. `session.round += 1`.
- Client: `ImpostorGamePanel.tsx` only shows `view.hints` (current round's
  hints). No history.

**Implementation:**

1. **Server** — `src/server/games/impostorSession.ts`:
   - Add `hintsByRound: Record<number, Record<string, string>>` to
     `ImpostorSession`. Before clearing hints for a new round, snapshot:
     `session.hintsByRound[session.round] = { ...session.hints }`.
   - Then clear `session.hints = {}` as before.
   - Update `createImpostorSession` to initialize `hintsByRound: {}`.

2. **Server** — `src/server/realtime.ts`:
   - In `impostorPlayView()`, include `hintsByRound` in the broadcast. Map
     the player ids to display names (same as `hints`).

3. **Types** — `src/types/games.ts`:
   - Add `hintsByRound?: Record<number, Record<string, string>>` to
     `ImpostorPlayView`.

4. **Client** — `src/pages/useMinigames.ts`:
   - Forward `hintsByRound` from the `gamePlay` frame into the play view
     state.

5. **Client** — `src/components/games/ImpostorGamePanel.tsx`:
   - In the hint phase (waiting player view), render each past round as a
     separated block:
     ```
     ── round 1 ──
     alice: banana
     bob: yellow
     ── round 2 (current) ──
     carol: fruit
     ```
   - Use a divider with the round label, and the same hint list format.

6. **Tests:**
   - `impostorSession.test.ts`: Add test "preserves hints from previous
     rounds" — start a game, submit hints for round 1, choose continue,
     assert `hintsByRound[1]` contains the round-1 hints and `hints` is
     cleared.
   - `ImpostorGamePanel.test.tsx`: Add test "shows past rounds' hints with
     round separation" — render with `hintsByRound: { 1: { "2": "yellow" } }`
     and `hints: { "3": "fruit" }`, assert `"round 1"` and `"round 2"` labels
     and both hints are visible.
   - `realtime.test.ts`: Add test "impostor play view includes hintsByRound"
     — play through two rounds, assert the broadcast contains both rounds.

**TDD steps:**
1. Write the session test. Watch it fail.
2. Add `hintsByRound` to the session.
3. Write the component test. Watch it fail.
4. Add the round-separated UI.
5. Write the realtime test. Watch it fail.
6. Add `hintsByRound` to the broadcast + type.
7. Verify all green.

**Scope:** ~20 lines session, ~10 lines server broadcast, ~5 lines types,
~30 lines component, ~50 lines tests.

---

## CTF-6 — End screen for Complete the Funny (mirrors I-5)

**Problem:** Same as I-5 but for CtF. When the game ends, the server
broadcasts `gameEnded` and the client immediately closes the overlay.

**Current state:** The CtF `over` phase already includes `leaderboard`
(final scores). The CtfGamePanel already renders a ranked scoreboard for the
`over` phase. The issue is that `gameEnded` immediately wipes the play view.

**Implementation:**

This is the same client-side change as I-5 — once `useMinigames` keeps the
overlay open after `gameEnded`, the CtF `over` phase scoreboard stays
visible. The CtfGamePanel already handles the `over` phase with medals and
scores.

**So: implement I-5 first.** CTF-6 comes for free once the
`useMinigames` `gameEnded` handling changes to keep the overlay open.

**Additional CtF-specific polish:**
- Add a `[ close ]` button on the scoreboard that calls `onDismissEnded`
  (from the I-5 `GameOverlay` change).
- Show "game over!" header above the scoreboard.

**Tests:**
- `CtfGamePanel.test.tsx`: The existing "shows the ranked leaderboard" test
  already covers the `over` phase. Add a test that the close button is
  visible when `isEnded` is true.

**Scope:** ~10 lines component (the close button), ~5 lines test. Depends on
I-5 being done first.

---

## Polish — UX, animations, movement to make minigames feel fun

**Problem:** Overall the minigames feel static. Need more juice: particle
effects, sound, screen shake, celebratory animations.

**This is an open-ended polish pass.** Break it into concrete sub-tasks:

### Polish-1: Confetti on game end
- Add a lightweight confetti burst when the `over` phase renders. Use a CSS
  approach (no library): generate ~20 absolutely-positioned divs with random
  colors, sizes, and `@keyframes` fall animations.
- **Scope:** ~40 lines CSS + component, in both `ImpostorGamePanel` and
  `CtfGamePanel` over-phase renders.

### Polish-2: Pulse/glow on the turn player's name
- In Impostor hint phase, the turn player's name in the waiting view should
  pulse with a subtle glow to draw attention.
- **Scope:** ~5 lines (add `animate-pulse` + `glow` class to the turn player
  indicator).

### Polish-3: Button press feedback
- All game action buttons should have `active:scale-95 transition-transform`
  for tactile feedback on click.
- **Scope:** ~1 class added to ~15 buttons across both panels.

### Polish-4: Slide transition for phase changes in GameOverlay
- When the overlay switches from lobby to playing, or playing to ended,
  slide the content. Currently it's a hard swap.
- **Scope:** ~10 lines (add `animate-[slideIn_0.3s_ease]` to the
  content container keyed on `game.status`).

### Polish-5: Score count-up animation
- In the CtF scoreboard, animate the score numbers counting up from 0 to
  their final value over ~1s.
- **Scope:** ~20 lines (a `useCountUp` hook using `requestAnimationFrame`).

**No TDD needed for visual polish** — these are CSS/animation changes with
no behavioral logic. Verify by running the dev server and visually checking,
or by taking screenshots in the E2E tests.

---

## Dependency Graph

```
G-1 (names)     ← do first, unblocks nothing but touches shared code
I-5 (end screen) ← unblocks CTF-6
CTF-6           ← depends on I-5
I-4 (terminology) ← independent
I-6 (live answers) ← independent (verify if already done first)
I-7 (round history) ← independent
Polish          ← do last, after all features are in
```

**Recommended order:** G-1 → I-7 → I-4 → I-5 → CTF-6 → I-6 → Polish
