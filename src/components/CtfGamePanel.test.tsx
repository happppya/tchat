// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import CtfGamePanel from "./CtfGamePanel";
import type { CtfPlayView } from "../types";

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => cleanup());

const noop = () => {};

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

describe("CtfGamePanel — answering phase", () => {
  it("shows the viewer's prompts with an input each and submits them", () => {
    const onAnswer = vi.fn();
    renderPanel({
      view: view("answering", {
        prompts: { "1": ["Weirdest hill to die on", "Bad excuse for homework"] },
      }),
      meId: "1",
      onAnswer,
    });

    expect(screen.getByText("Weirdest hill to die on")).toBeTruthy();
    const first = screen.getByTestId("ctf-answer-0");
    fireEvent.change(first, { target: { value: "pineapples" } });
    const second = screen.getByTestId("ctf-answer-1");
    fireEvent.change(second, { target: { value: "my cat ate it" } });
    fireEvent.click(screen.getByTestId("ctf-answer-submit"));
    expect(onAnswer).toHaveBeenCalledWith(["pineapples", "my cat ate it"]);
  });

  it("only fills the prompts belonging to the viewer", () => {
    renderPanel({
      view: view("answering", {
        prompts: { "1": ["mine"], "2": ["someone else's"] },
      }),
      meId: "1",
    });
    expect(screen.getByText("mine")).toBeTruthy();
    expect(screen.queryByText("someone else's")).toBeNull();
    expect(screen.getAllByTestId(/^ctf-answer-[0-9]+$/).length).toBe(1);
  });
});

describe("CtfGamePanel — voting phase", () => {
  it("renders each matchup and submits a vote with phase index + answer id", () => {
    const onVote = vi.fn();
    renderPanel({
      view: view("voting", {
        phases: [
          {
            prompt: "Weirdest hill to die on",
            answers: [
              { id: "a1", playerId: "1", text: "pineapples" },
              { id: "a2", playerId: "2", text: "toast" },
            ],
          },
        ],
      }),
      meId: "1",
      onVote,
    });

    expect(screen.getByText("Weirdest hill to die on")).toBeTruthy();
    fireEvent.click(screen.getByTestId("ctf-vote-0-a2"));
    expect(onVote).toHaveBeenCalledWith(0, "a2");
  });
});

describe("CtfGamePanel — over phase", () => {
  it("shows the leaderboard", () => {
    renderPanel({
      view: view("over", { leaderboard: { "1": 2500, "2": 1800 } }),
    });
    expect(screen.getByTestId("ctf-leaderboard")).toBeTruthy();
    expect(screen.getByText("2500")).toBeTruthy();
  });
});