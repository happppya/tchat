// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import ImpostorGamePanel from "./ImpostorGamePanel";
import type { ImpostorPlayView, GameRole } from "../../types";

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => cleanup());

const noop = () => {};

function view(phase: ImpostorPlayView["phase"], partial: Partial<ImpostorPlayView> = {}): ImpostorPlayView {
  return {
    type: "gamePlay",
    gameId: "g1",
    game: "impostor",
    status: "playing",
    round: 1,
    phase,
    turnPlayerId: null,
    hints: {},
    votedOutId: null,
    outcome: null,
    ...partial,
  };
}

function role(partial: Partial<GameRole>): GameRole {
  return { type: "gameRole", gameId: "g1", role: "crewmate", ...partial };
}

function renderPanel(props: Partial<React.ComponentProps<typeof ImpostorGamePanel>> = {}) {
  return render(
    <ImpostorGamePanel
      view={props.view ?? view("hint")}
      role={props.role ?? null}
      meId={props.meId ?? "1"}
      participantIds={props.participantIds ?? ["1", "2"]}
      onHint={props.onHint ?? noop}
      onChoose={props.onChoose ?? noop}
      onVote={props.onVote ?? noop}
      onGuess={props.onGuess ?? noop}
    />
  );
}

/** Dismiss the role-reveal card if present, so tests can reach the panel. */
function dismissReveal() {
  const btn = screen.queryByTestId("impostor-role-reveal-dismiss");
  if (btn) fireEvent.click(btn);
}

describe("ImpostorGamePanel — role reveal (I-3)", () => {
  it("shows a role-reveal card for crewmates with the secret word", () => {
    renderPanel({
      view: view("hint", { turnPlayerId: "1" }),
      role: role({ role: "crewmate", secretWord: "banana" }),
      meId: "1",
    });

    expect(screen.getByTestId("impostor-role-reveal")).toBeTruthy();
    expect(screen.getByText("you are a crewmate")).toBeTruthy();
    expect(screen.getByText("banana")).toBeTruthy();
  });

  it("shows a role-reveal card for impostors with their hint category", () => {
    renderPanel({
      view: view("hint", { turnPlayerId: "1" }),
      role: role({ role: "impostor", hint: "yellow fruit" }),
      meId: "1",
    });

    expect(screen.getByTestId("impostor-role-reveal")).toBeTruthy();
    expect(screen.getByText("you are the slime!")).toBeTruthy();
    expect(screen.getByText("yellow fruit")).toBeTruthy();
  });

  it("dismisses the role reveal and shows the hint panel", () => {
    renderPanel({
      view: view("hint", { turnPlayerId: "1" }),
      role: role({ role: "crewmate", secretWord: "banana" }),
      meId: "1",
    });

    fireEvent.click(screen.getByTestId("impostor-role-reveal-dismiss"));
    expect(screen.queryByTestId("impostor-role-reveal")).toBeNull();
    expect(screen.getByTestId("impostor-hint-input")).toBeTruthy();
  });
});

describe("ImpostorGamePanel — hint phase", () => {
  it("shows the secret word only to the current turn taker and lets them submit a hint", () => {
    const onHint = vi.fn();
    renderPanel({
      view: view("hint", { turnPlayerId: "1" }),
      role: role({ role: "crewmate", secretWord: "banana" }),
      meId: "1",
      onHint,
    });
    dismissReveal();

    expect(screen.getByText("banana")).toBeTruthy();
    const input = screen.getByTestId("impostor-hint-input");
    fireEvent.change(input, { target: { value: "yellow fruit" } });
    fireEvent.click(screen.getByTestId("impostor-hint-submit"));
    expect(onHint).toHaveBeenCalledWith("yellow fruit");
  });

  it("hides the word from non-turn players and shows prior hints instead", () => {
    renderPanel({
      view: view("hint", { turnPlayerId: "2", hints: { "2": "tastes great" } }),
      role: role({ role: "crewmate", secretWord: "banana" }),
      meId: "1",
    });
    dismissReveal();

    expect(screen.queryByText("banana")).toBeNull();
    expect(screen.getByText("tastes great")).toBeTruthy();
    expect(screen.queryByTestId("impostor-hint-submit")).toBeNull();
  });

  it("shows the answers to the current turn taker too (I-6)", () => {
    renderPanel({
      view: view("hint", {
        turnPlayerId: "1",
        hints: { "2": "tastes great" },
      }),
      role: role({ role: "crewmate", secretWord: "banana" }),
      meId: "1",
      participantIds: ["1", "2"],
    });
    dismissReveal();

    // The turn taker can both submit their own answer AND see everyone's.
    expect(screen.getByTestId("impostor-hint-input")).toBeTruthy();
    expect(screen.getByText("tastes great")).toBeTruthy();
  });

  it("uses answer terminology, not clue/guess (I-4)", () => {
    renderPanel({
      view: view("hint", { turnPlayerId: "1" }),
      role: role({ role: "crewmate", secretWord: "banana" }),
      meId: "1",
    });
    dismissReveal();

    expect(screen.getByPlaceholderText(/one-word answer/)).toBeTruthy();
    expect(screen.getByTestId("impostor-hint-submit").textContent).toContain("submit answer");
  });

  it("shows answers on the choose screen (I-6)", () => {
    renderPanel({
      view: view("choose", { hints: { "1": "yellow", "2": "fruit" } }),
      meId: "3",
    });
    expect(screen.getByTestId("impostor-answers")).toBeTruthy();
    expect(screen.getByText("yellow")).toBeTruthy();
    expect(screen.getByText("fruit")).toBeTruthy();
  });

  it("shows past rounds' hints with round separation", () => {
    renderPanel({
      view: view("hint", {
        turnPlayerId: "1",
        hints: { "1": "current clue" },
        hintsByRound: { "1": { "2": "old clue" } },
      }),
      role: role({ role: "crewmate", secretWord: "banana" }),
      meId: "3",
    });
    dismissReveal();

    expect(screen.getAllByText(/round 1/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("old clue")).toBeTruthy();
    expect(screen.getByText("current clue")).toBeTruthy();
  });

  it("shows turn-order progress dots for who has answered", () => {
    renderPanel({
      view: view("hint", { turnPlayerId: "2", hints: { "1": "yellow" } }),
      role: role({ role: "crewmate", secretWord: "banana" }),
      meId: "1",
      participantIds: ["1", "2", "3"],
    });
    dismissReveal();
    // Three participants → three progress dots rendered.
    const dots = document.querySelectorAll("[data-testid='impostor-panel'] .rounded-full");
    expect(dots.length).toBeGreaterThanOrEqual(3);
  });
});

describe("ImpostorGamePanel — choose phase", () => {
  it("offers continue and vote, wiring the choice back", () => {
    const onChoose1 = vi.fn();
    renderPanel({ view: view("choose"), onChoose: onChoose1 });
    fireEvent.click(screen.getByTestId("impostor-choose-continue"));
    expect(onChoose1).toHaveBeenCalledWith("continue");

    // A fresh panel lets the player pick vote (one choice locks the buttons).
    cleanup();
    const onChoose2 = vi.fn();
    renderPanel({ view: view("choose"), onChoose: onChoose2 });
    fireEvent.click(screen.getByTestId("impostor-choose-vote"));
    expect(onChoose2).toHaveBeenCalledWith("vote");
  });

  it("shows a running tally of continue vs vote choices (I-1)", () => {
    renderPanel({
      view: view("choose", {
        choices: { "1": "continue", "2": "vote" },
      }),
      meId: "1",
    });
    expect(screen.getByTestId("impostor-choose-tally")).toBeTruthy();
    expect(screen.getByText(/continue: 1/)).toBeTruthy();
    expect(screen.getByText(/force a vote: 1/)).toBeTruthy();
  });

  it("shows how many have decided out of the total (I-1 progress)", () => {
    renderPanel({
      view: view("choose", { choices: { "1": "continue" } }),
      meId: "1",
      participantIds: ["1", "2", "3"],
    });
    expect(screen.getByText(/1\/3 decided/)).toBeTruthy();
  });
});

describe("ImpostorGamePanel — vote phase (I-1)", () => {
  it("lets the player vote for another participant (not themselves)", () => {
    const onVote = vi.fn();
    renderPanel({ view: view("vote"), meId: "1", participantIds: ["1", "2"], onVote });

    fireEvent.click(screen.getByTestId("impostor-vote-2"));
    expect(onVote).toHaveBeenCalledWith("2");
  });

  it("disables further voting after selection and shows confirmation", () => {
    renderPanel({ view: view("vote"), meId: "1", participantIds: ["1", "2", "3"] });

    fireEvent.click(screen.getByTestId("impostor-vote-2"));

    // Both buttons now disabled
    expect(
      (screen.getByTestId("impostor-vote-2") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId("impostor-vote-3") as HTMLButtonElement).disabled
    ).toBe(true);

    // Shows confirmation text
    expect(screen.getByText(/you voted for 2/)).toBeTruthy();
  });

  it("shows the voted-out player when already decided", () => {
    renderPanel({ view: view("vote", { votedOutId: "2" }), meId: "1" });
    expect(screen.getByTestId("impostor-voted-out")).toBeTruthy();
  });
});

describe("ImpostorGamePanel — guess phase", () => {
  it("asks the voted-out impostor to guess the word", () => {
    const onGuess = vi.fn();
    renderPanel({
      view: view("guess", { votedOutId: "1" }),
      role: role({ role: "impostor", hint: "yellow fruit" }),
      meId: "1",
      onGuess,
    });

    const input = screen.getByTestId("impostor-guess-input");
    fireEvent.change(input, { target: { value: "banana" } });
    fireEvent.click(screen.getByTestId("impostor-guess-submit"));
    expect(onGuess).toHaveBeenCalledWith("banana");
  });

  it("shows a waiting state to players who are not the impostor", () => {
    renderPanel({
      view: view("guess", { votedOutId: "2" }),
      role: role({ role: "crewmate", secretWord: "banana" }),
      meId: "1",
    });
    expect(screen.queryByTestId("impostor-guess-input")).toBeNull();
  });
});

describe("ImpostorGamePanel — over phase", () => {
  it("shows the outcome", () => {
    renderPanel({ view: view("over", { outcome: "crewmates-win" }) });
    expect(screen.getByTestId("impostor-outcome")).toBeTruthy();
    expect(screen.getByText(/crewmates win/i)).toBeTruthy();
  });

  it("reveals the secret word and impostor in the over phase", () => {
    renderPanel({
      view: view("over", { outcome: "crewmates-win", secretWord: "pizza", impostorIds: ["2"] }),
      role: role({ role: "crewmate", secretWord: "pizza" }),
      meId: "1",
      participantIds: ["1", "2", "3"],
    });
    expect(screen.getByText("the word was")).toBeTruthy();
    expect(screen.getByText("pizza")).toBeTruthy();
    expect(screen.getByText(/the slime was/)).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("shows the slime the secret word too via the over view (I-5)", () => {
    // The slime never had role.secretWord — only the public over view
    // carries it, so the slime must see it revealed from the view.
    renderPanel({
      view: view("over", { outcome: "draw", secretWord: "banana", impostorIds: ["1"] }),
      role: role({ role: "impostor", hint: "yellow fruit" }),
      meId: "1",
      participantIds: ["1", "2", "3"],
    });
    expect(screen.getByText("the word was")).toBeTruthy();
    expect(screen.getByText("banana")).toBeTruthy();
  });

  it("shows live vote dots for received votes", () => {
    renderPanel({
      view: view("vote", { votes: { "1": "2", "3": "2" } }),
      meId: "1",
      participantIds: ["1", "2", "3"],
    });
    // Player 2 has 2 votes → 2 dots render inside their button.
    const btn = screen.getByTestId("impostor-vote-2");
    const dots = btn.querySelectorAll(".rounded-full");
    expect(dots.length).toBe(2);
  });
});
