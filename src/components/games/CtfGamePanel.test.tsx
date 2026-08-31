// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import CtfGamePanel from "./CtfGamePanel";
import type { CtfPlayView, CtfViewMatchup } from "../../types";

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => cleanup());

const noop = () => {};

function matchup(partial: Partial<CtfViewMatchup> & { prompt?: string }): CtfViewMatchup {
  return {
    prompt: partial.prompt ?? "test prompt",
    answers: partial.answers ?? [
      { id: "a1", playerId: "2", text: "funny a", voteCount: 0 },
      { id: "a2", playerId: "3", text: "funny b", voteCount: 0 },
    ],
    voteDeadline: partial.voteDeadline ?? null,
  };
}

function view(phase: CtfPlayView["phase"], partial: Partial<CtfPlayView> = {}): CtfPlayView {
  return {
    type: "gamePlay",
    gameId: "g1",
    game: "complete-the-funny",
    status: "playing",
    round: 1,
    phase,
    deadline: null,
    prompts: {},
    answered: {},
    phases: null,
    leaderboard: null,
    ...partial,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof CtfGamePanel>> = {}) {
  return render(
    <CtfGamePanel
      view={props.view ?? view("answering")}
      meId={props.meId ?? "1"}
      onAnswer={props.onAnswer ?? noop}
      onVote={props.onVote ?? noop}
    />
  );
}

describe("CtfGamePanel — answering phase (one prompt at a time)", () => {
  it("shows only the first prompt with an input", () => {
    renderPanel({
      view: view("answering", {
        prompts: { "1": ["Weirdest hill to die on", "Bad excuse for homework"] },
      }),
      meId: "1",
    });

    expect(screen.getByText("Weirdest hill to die on")).toBeTruthy();
    expect(screen.queryByText("Bad excuse for homework")).toBeNull();
    expect(screen.getByTestId("ctf-answer-input")).toBeTruthy();
  });

  it("advances to the next prompt on submit and sends answers at the end", () => {
    const onAnswer = vi.fn();
    renderPanel({
      view: view("answering", {
        prompts: { "1": ["prompt A", "prompt B"] },
      }),
      onAnswer,
    });

    let input = screen.getByTestId("ctf-answer-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "answer one" } });
    fireEvent.click(screen.getByTestId("ctf-answer-submit"));

    // Now on prompt 2
    expect(screen.getByText("prompt B")).toBeTruthy();
    expect(screen.queryByText("prompt A")).toBeNull();

    // Re-query the input (it was replaced by the animation re-mount)
    input = screen.getByTestId("ctf-answer-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "answer two" } });
    fireEvent.click(screen.getByTestId("ctf-answer-submit"));

    expect(onAnswer).toHaveBeenCalledWith(["answer one", "answer two"]);
  });

  it("shows a visible countdown when deadline is set", () => {
    renderPanel({
      view: view("answering", {
        prompts: { "1": ["test prompt"] },
        deadline: Date.now() + 60_000,
      }),
    });

    expect(screen.getByText(/60s/)).toBeTruthy();
  });

  it("shows always-visible own points during answering (CTF-4)", () => {
    renderPanel({
      view: view("answering", {
        prompts: { "1": ["test"] },
        scores: { "1": 1500 },
      }),
      meId: "1",
    });
    expect(screen.getByText("1500 pts")).toBeTruthy();
  });
});

describe("CtfGamePanel — synchronized voting (CTF-2)", () => {
  it("shows only the current matchup everyone is voting on", () => {
    renderPanel({
      view: view("voting", {
        phases: [matchup({ prompt: "First matchup" }), matchup({ prompt: "Second matchup" })],
        currentMatchup: 0,
      }),
      meId: "1",
    });

    expect(screen.getByText("First matchup")).toBeTruthy();
    expect(screen.queryByText("Second matchup")).toBeNull();
  });

  it("advances to the next matchup when currentMatchup changes (server-driven)", () => {
    const { rerender } = renderPanel({
      view: view("voting", {
        phases: [matchup({ prompt: "First matchup" }), matchup({ prompt: "Second matchup" })],
        currentMatchup: 0,
      }),
      meId: "1",
    });

    expect(screen.getByText("First matchup")).toBeTruthy();

    rerender(
      <CtfGamePanel
        view={view("voting", {
          phases: [matchup({ prompt: "First matchup" }), matchup({ prompt: "Second matchup" })],
          currentMatchup: 1,
        })}
        meId="1"
        onAnswer={noop}
        onVote={noop}
      />
    );

    expect(screen.getByText("Second matchup")).toBeTruthy();
    expect(screen.queryByText("First matchup")).toBeNull();
  });

  it("renders large answer cards with player on top and vote dots below (CTF-5)", () => {
    renderPanel({
      view: view("voting", {
        phases: [
          matchup({
            prompt: "Pick the funniest",
            answers: [
              { id: "a1", playerId: "2", text: "pineapples on pizza", voteCount: 2 },
              { id: "a2", playerId: "3", text: "toast", voteCount: 0 },
            ],
          }),
        ],
        currentMatchup: 0,
      }),
      meId: "1",
    });

    // Answer text appears (large, in the middle)
    expect(screen.getByText("pineapples on pizza")).toBeTruthy();
    expect(screen.getByText("toast")).toBeTruthy();
    // Vote dots: 2 votes → 2 dots on a1's card
    const a1Btn = screen.getByTestId("ctf-vote-0-a1");
    const dots = a1Btn.querySelectorAll(".rounded-full");
    expect(dots.length).toBe(2);
  });

  it("wires the vote through and locks voting after selection", () => {
    const onVote = vi.fn();
    renderPanel({
      view: view("voting", {
        phases: [matchup({ prompt: "matchup" })],
        currentMatchup: 0,
      }),
      meId: "1",
      onVote,
    });

    fireEvent.click(screen.getByTestId("ctf-vote-0-a1"));
    expect(onVote).toHaveBeenCalledWith(0, "a1");

    // Both buttons now disabled
    expect(
      (screen.getByTestId("ctf-vote-0-a1") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId("ctf-vote-0-a2") as HTMLButtonElement).disabled
    ).toBe(true);

    // Shows confirmation
    expect(screen.getByText(/vote locked in/)).toBeTruthy();
  });

  it("prevents voting on own answer", () => {
    renderPanel({
      view: view("voting", {
        phases: [
          matchup({
            prompt: "matchup",
            answers: [
              { id: "a1", playerId: "1", text: "mine", voteCount: 0 },
              { id: "a2", playerId: "2", text: "theirs", voteCount: 0 },
            ],
          }),
        ],
        currentMatchup: 0,
      }),
      meId: "1",
    });

    expect(
      (screen.getByTestId("ctf-vote-0-a1") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId("ctf-vote-0-a2") as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it("shows a voting countdown when voteDeadline is set", () => {
    renderPanel({
      view: view("voting", {
        phases: [matchup({})],
        currentMatchup: 0,
        voteDeadline: Date.now() + 30_000,
      }),
      meId: "1",
    });

    expect(screen.getByText(/30s/)).toBeTruthy();
  });
});

describe("CtfGamePanel — over phase (scoreboard)", () => {
  it("shows the ranked leaderboard with medals and scores", async () => {
    renderPanel({
      view: view("over", {
        leaderboard: { "1": 2500, "2": 1800, "3": 900 },
      }),
      meId: "1",
    });

    expect(screen.getByTestId("ctf-leaderboard")).toBeTruthy();
    expect(screen.getByText("(you)")).toBeTruthy();
    // Scores animate up from 0; after a tick the final values appear.
    await waitFor(() => expect(screen.getByText("2500")).toBeTruthy(), { timeout: 3000 });
    // The viewer is highlighted as (you)
    expect(screen.getByText("(you)")).toBeTruthy();
  });
});
