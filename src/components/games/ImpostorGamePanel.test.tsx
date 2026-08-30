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

describe("ImpostorGamePanel — hint phase", () => {
  it("shows the secret word only to the current turn taker and lets them submit a hint", () => {
    const onHint = vi.fn();
    renderPanel({
      view: view("hint", { turnPlayerId: "1" }),
      role: { type: "gameRole", gameId: "g1", role: "crewmate", secretWord: "banana" } as GameRole,
      meId: "1",
      onHint,
    });

    expect(screen.getByText("banana")).toBeTruthy();
    const input = screen.getByTestId("impostor-hint-input");
    fireEvent.change(input, { target: { value: "yellow fruit" } });
    fireEvent.click(screen.getByTestId("impostor-hint-submit"));
    expect(onHint).toHaveBeenCalledWith("yellow fruit");
  });

  it("hides the word from non-turn players and shows prior hints instead", () => {
    renderPanel({
      view: view("hint", { turnPlayerId: "2", hints: { "2": "tastes great" } }),
      role: { type: "gameRole", gameId: "g1", role: "crewmate", secretWord: "banana" } as GameRole,
      meId: "1",
    });

    expect(screen.queryByText("banana")).toBeNull();
    expect(screen.getByText("tastes great")).toBeTruthy();
    expect(screen.queryByTestId("impostor-hint-submit")).toBeNull();
  });
});

describe("ImpostorGamePanel — choose phase", () => {
  it("offers continue and vote, wiring the choice back", () => {
    const onChoose = vi.fn();
    renderPanel({ view: view("choose"), onChoose });

    fireEvent.click(screen.getByTestId("impostor-choose-continue"));
    expect(onChoose).toHaveBeenCalledWith("continue");
    fireEvent.click(screen.getByTestId("impostor-choose-vote"));
    expect(onChoose).toHaveBeenCalledWith("vote");
  });
});

describe("ImpostorGamePanel — vote phase", () => {
  it("lets the player vote for another participant (not themselves)", () => {
    const onVote = vi.fn();
    renderPanel({ view: view("vote"), meId: "1", participantIds: ["1", "2"], onVote });

    // Only "2" is votable — the voter is excluded.
    fireEvent.click(screen.getByTestId("impostor-vote-2"));
    expect(onVote).toHaveBeenCalledWith("2");
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
      role: { type: "gameRole", gameId: "g1", role: "impostor", hint: "yellow fruit" } as GameRole,
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
      role: { type: "gameRole", gameId: "g1", role: "crewmate", secretWord: "banana" } as GameRole,
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
});